import { randomUUID } from 'crypto'
import { Router } from 'express'
import type { Response } from 'express'
import { pool } from '../config/database.js'
import {
  authenticateToken,
  type AuthenticatedRequest,
} from '../middleware/auth.middleware.js'

const router = Router()

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const AMOUNT_PATTERN = /^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/
const MAX_DESCRIPTION_LENGTH = 500
const DEFAULT_PAGE_SIZE = 20
const MAX_PAGE_SIZE = 100
const MAX_PAGE_NUMBER = 100_000

class TransferError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message)
    this.name = 'TransferError'
  }
}

function normalizeAmount(value: unknown): string | null {
  if (typeof value === 'string') {
    return value.trim()
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value.toString()
  }

  return null
}

function parsePaginationParameter(
  value: unknown,
  defaultValue: number,
  maximum: number,
): number | null {
  if (value === undefined) {
    return defaultValue
  }

  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    return null
  }

  const parsed = Number(value)

  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    return null
  }

  return parsed
}

router.get(
  '/',
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response) => {
    if (!req.userId) {
      return res.status(401).json({
        success: false,
        message: 'User authentication required',
      })
    }

    const page = parsePaginationParameter(
      req.query.page,
      1,
      MAX_PAGE_NUMBER,
    )
    const limit = parsePaginationParameter(
      req.query.limit,
      DEFAULT_PAGE_SIZE,
      MAX_PAGE_SIZE,
    )

    if (!page || !limit) {
      return res.status(400).json({
        success: false,
        message: `page must be between 1 and ${MAX_PAGE_NUMBER}, and limit must be between 1 and ${MAX_PAGE_SIZE}`,
      })
    }

    try {
      const result = await pool.query(
        `
        SELECT
          transactions.id,
          transactions.reference,
          transactions.type,
          transactions.status,
          transactions.amount,
          COALESCE(sender_wallet.currency, receiver_wallet.currency) AS currency,
          transactions.sender_wallet_id,
          transactions.receiver_wallet_id,
          transactions.description,
          transactions.created_at,
          transactions.completed_at
        FROM transactions
        LEFT JOIN wallets AS sender_wallet
          ON sender_wallet.id = transactions.sender_wallet_id
        LEFT JOIN wallets AS receiver_wallet
          ON receiver_wallet.id = transactions.receiver_wallet_id
        WHERE EXISTS (
          SELECT 1
          FROM wallets AS owned_wallet
          WHERE owned_wallet.user_id = $1
            AND owned_wallet.id IN (
              transactions.sender_wallet_id,
              transactions.receiver_wallet_id
            )
        )
        ORDER BY transactions.created_at DESC, transactions.id DESC
        LIMIT $2
        OFFSET $3
        `,
        [req.userId, limit + 1, (page - 1) * limit],
      )

      const hasMore = result.rows.length > limit
      const transactions = result.rows.slice(0, limit).map((transaction) => ({
        id: transaction.id,
        reference: transaction.reference,
        type: transaction.type,
        status: transaction.status,
        amount: transaction.amount,
        currency: transaction.currency,
        senderWalletId: transaction.sender_wallet_id,
        receiverWalletId: transaction.receiver_wallet_id,
        description: transaction.description,
        createdAt: transaction.created_at,
        completedAt: transaction.completed_at,
      }))

      return res.json({
        success: true,
        transactions,
        pagination: {
          page,
          limit,
          hasMore,
        },
      })
    } catch (error) {
      console.error('Transaction history error:', error)

      return res.status(500).json({
        success: false,
        message: 'Unable to fetch transaction history',
      })
    }
  },
)

router.get(
  '/:id',
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response) => {
    if (!req.userId) {
      return res.status(401).json({
        success: false,
        message: 'User authentication required',
      })
    }

    const transactionId = req.params.id

    if (
      typeof transactionId !== 'string' ||
      !UUID_PATTERN.test(transactionId)
    ) {
      return res.status(400).json({
        success: false,
        message: 'A valid transaction id is required',
      })
    }

    try {
      const result = await pool.query(
        `
        SELECT
          transactions.id,
          transactions.reference,
          transactions.type,
          transactions.status,
          transactions.amount,
          COALESCE(sender_wallet.currency, receiver_wallet.currency) AS currency,
          transactions.sender_wallet_id,
          transactions.receiver_wallet_id,
          transactions.description,
          transactions.created_at,
          transactions.completed_at
        FROM transactions
        LEFT JOIN wallets AS sender_wallet
          ON sender_wallet.id = transactions.sender_wallet_id
        LEFT JOIN wallets AS receiver_wallet
          ON receiver_wallet.id = transactions.receiver_wallet_id
        WHERE transactions.id = $1
          AND (
            sender_wallet.user_id = $2
            OR receiver_wallet.user_id = $2
          )
        LIMIT 1
        `,
        [transactionId, req.userId],
      )

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Transaction not found',
        })
      }

      const transaction = result.rows[0]

      return res.json({
        success: true,
        transaction: {
          id: transaction.id,
          reference: transaction.reference,
          type: transaction.type,
          status: transaction.status,
          amount: transaction.amount,
          currency: transaction.currency,
          senderWalletId: transaction.sender_wallet_id,
          receiverWalletId: transaction.receiver_wallet_id,
          description: transaction.description,
          createdAt: transaction.created_at,
          completedAt: transaction.completed_at,
        },
      })
    } catch (error) {
      console.error('Transaction details error:', error)

      return res.status(500).json({
        success: false,
        message: 'Unable to fetch transaction details',
      })
    }
  },
)

router.post(
  '/transfer',
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response) => {
    const {
      senderWalletId,
      receiverWalletId,
      amount: rawAmount,
      description,
    } = req.body

    if (!req.userId) {
      return res.status(401).json({
        success: false,
        message: 'User authentication required',
      })
    }

    if (
      typeof senderWalletId !== 'string' ||
      !UUID_PATTERN.test(senderWalletId)
    ) {
      return res.status(400).json({
        success: false,
        message: 'A valid senderWalletId is required',
      })
    }

    if (
      typeof receiverWalletId !== 'string' ||
      !UUID_PATTERN.test(receiverWalletId)
    ) {
      return res.status(400).json({
        success: false,
        message: 'A valid receiverWalletId is required',
      })
    }

    if (senderWalletId === receiverWalletId) {
      return res.status(400).json({
        success: false,
        message: 'Sender and receiver wallets must be different',
      })
    }

    const amount = normalizeAmount(rawAmount)

    if (!amount || !AMOUNT_PATTERN.test(amount) || !/[1-9]/.test(amount)) {
      return res.status(400).json({
        success: false,
        message:
          'Amount must be a positive decimal with at most 16 whole digits and 2 decimal places',
      })
    }

    if (
      description !== undefined &&
      (typeof description !== 'string' ||
        description.length > MAX_DESCRIPTION_LENGTH)
    ) {
      return res.status(400).json({
        success: false,
        message: `Description must be a string no longer than ${MAX_DESCRIPTION_LENGTH} characters`,
      })
    }

    const client = await pool.connect()

    try {
      await client.query('BEGIN')

      const [firstWalletId, secondWalletId] =
        senderWalletId < receiverWalletId
          ? [senderWalletId, receiverWalletId]
          : [receiverWalletId, senderWalletId]

      const firstWalletResult = await client.query(
        `
        SELECT id, user_id, currency, balance, status
        FROM wallets
        WHERE id = $1
        FOR UPDATE
        `,
        [firstWalletId],
      )

      const secondWalletResult = await client.query(
        `
        SELECT id, user_id, currency, balance, status
        FROM wallets
        WHERE id = $1
        FOR UPDATE
        `,
        [secondWalletId],
      )

      const wallets = [
        firstWalletResult.rows[0],
        secondWalletResult.rows[0],
      ]
      const senderWallet = wallets.find(
        (wallet) => wallet?.id === senderWalletId,
      )
      const receiverWallet = wallets.find(
        (wallet) => wallet?.id === receiverWalletId,
      )

      if (!senderWallet) {
        throw new TransferError(404, 'Sender wallet not found')
      }

      if (!receiverWallet) {
        throw new TransferError(404, 'Receiver wallet not found')
      }

      if (senderWallet.user_id !== req.userId) {
        throw new TransferError(403, 'Sender wallet does not belong to you')
      }

      if (senderWallet.status !== 'ACTIVE' || receiverWallet.status !== 'ACTIVE') {
        throw new TransferError(403, 'Both wallets must be active')
      }

      if (senderWallet.currency !== receiverWallet.currency) {
        throw new TransferError(400, 'Wallet currencies must match')
      }

      const balanceCheck = await client.query(
        `
        SELECT balance >= $1::numeric AS sufficient
        FROM wallets
        WHERE id = $2
        `,
        [amount, senderWalletId],
      )

      if (!balanceCheck.rows[0]?.sufficient) {
        throw new TransferError(422, 'Insufficient wallet balance')
      }

      const transactionId = randomUUID()
      const reference = `TRF-${randomUUID()}`

      await client.query(
        `
        INSERT INTO transactions (
          id,
          sender_wallet_id,
          receiver_wallet_id,
          amount,
          type,
          status,
          reference,
          description
        )
        VALUES ($1, $2, $3, $4, 'TRANSFER', 'PENDING', $5, $6)
        `,
        [
          transactionId,
          senderWalletId,
          receiverWalletId,
          amount,
          reference,
          description ?? null,
        ],
      )

      await client.query(
        `
        UPDATE wallets
        SET balance = balance - $1,
            updated_at = NOW()
        WHERE id = $2
        `,
        [amount, senderWalletId],
      )

      await client.query(
        `
        UPDATE wallets
        SET balance = balance + $1,
            updated_at = NOW()
        WHERE id = $2
        `,
        [amount, receiverWalletId],
      )

      const completedTransaction = await client.query(
        `
        UPDATE transactions
        SET status = 'COMPLETED',
            completed_at = NOW()
        WHERE id = $1
        RETURNING
          id,
          reference,
          type,
          status,
          amount,
          sender_wallet_id,
          receiver_wallet_id,
          completed_at
        `,
        [transactionId],
      )

      await client.query('COMMIT')

      const transaction = completedTransaction.rows[0]

      return res.status(201).json({
        success: true,
        message: 'Transfer completed successfully',
        transaction: {
          id: transaction.id,
          reference: transaction.reference,
          type: transaction.type,
          status: transaction.status,
          amount: transaction.amount,
          senderWalletId: transaction.sender_wallet_id,
          receiverWalletId: transaction.receiver_wallet_id,
          completedAt: transaction.completed_at,
        },
      })
    } catch (error) {
      await client.query('ROLLBACK')

      if (error instanceof TransferError) {
        return res.status(error.statusCode).json({
          success: false,
          message: error.message,
        })
      }

      console.error('Transfer error:', error)

      return res.status(500).json({
        success: false,
        message: 'Unable to complete transfer',
      })
    } finally {
      client.release()
    }
  },
)

export default router
