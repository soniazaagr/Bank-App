import { randomUUID } from 'crypto'
import { Router } from 'express'
import type { Response } from 'express'
import type { PoolClient } from 'pg'
import { pool } from '../config/database.js'
import { authenticateToken, type AuthenticatedRequest } from '../middleware/auth.middleware.js'

const router = Router()
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const AMOUNT_PATTERN = /^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/

class DepositError extends Error {
  constructor(public readonly statusCode: number, message: string) { super(message) }
}

function canonicalAmount(value: string) {
  const [whole, fraction = ''] = value.split('.')
  const normalizedFraction = fraction.replace(/0+$/, '')
  return normalizedFraction ? `${whole}.${normalizedFraction}` : whole
}

router.post('/', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  const { walletId, beneficiaryId, amount: rawAmount, idempotencyKey } = req.body ?? {}
  if (!req.userId) return res.status(401).json({ success: false, message: 'User authentication required' })
  if (typeof walletId !== 'string' || !UUID_PATTERN.test(walletId)) return res.status(400).json({ success: false, message: 'A valid walletId is required' })
  if (typeof beneficiaryId !== 'string' || !UUID_PATTERN.test(beneficiaryId)) return res.status(400).json({ success: false, message: 'A valid funding source is required' })
  if (typeof rawAmount !== 'string' || !AMOUNT_PATTERN.test(rawAmount.trim()) || !/[1-9]/.test(rawAmount)) return res.status(400).json({ success: false, message: 'Amount must be a positive decimal with at most 16 whole digits and 2 decimal places' })
  if (typeof idempotencyKey !== 'string' || !UUID_PATTERN.test(idempotencyKey)) return res.status(400).json({ success: false, message: 'A valid idempotency key is required' })
  const amount = rawAmount.trim()
  let client: PoolClient | undefined
  let transactionStarted = false
  try {
    client = await pool.connect()
    await client.query('BEGIN')
    transactionStarted = true
    const walletResult = await client.query(`SELECT id, user_id, currency, status FROM wallets WHERE id = $1 FOR UPDATE`, [walletId])
    const wallet = walletResult.rows[0]
    if (!wallet) throw new DepositError(404, 'Wallet not found')
    if (wallet.user_id !== req.userId) throw new DepositError(403, 'Wallet does not belong to you')
    if (wallet.status !== 'ACTIVE') throw new DepositError(403, 'Wallet must be active')

    const beneficiaryResult = await client.query(`SELECT id, label, masked_identifier FROM financial_beneficiaries WHERE id = $1 AND user_id = $2 AND kind = 'FUNDING_SOURCE' AND status = 'ACTIVE' FOR SHARE`, [beneficiaryId, req.userId])
    const beneficiary = beneficiaryResult.rows[0]
    if (!beneficiary) throw new DepositError(403, 'Funding source is unavailable or does not belong to you')

    const existingDeposit = await client.query(
      `SELECT id, reference, type, status, amount, receiver_wallet_id, completed_at
       FROM transactions
       WHERE idempotency_key = $1
       FOR UPDATE`,
      [idempotencyKey],
    )
    const existingTransaction = existingDeposit.rows[0]
    if (existingTransaction) {
      if (existingTransaction.receiver_wallet_id !== walletId || canonicalAmount(existingTransaction.amount) !== canonicalAmount(amount)) {
        throw new DepositError(409, 'This deposit request has already been used with different details')
      }
      const currentWallet = await client.query('SELECT balance FROM wallets WHERE id = $1', [walletId])
      await client.query('COMMIT')
      transactionStarted = false
      return res.status(200).json({
        success: true,
        message: 'Deposit already completed',
        wallet: { id: wallet.id, currency: wallet.currency, balance: currentWallet.rows[0].balance },
        transaction: { id: existingTransaction.id, reference: existingTransaction.reference, type: existingTransaction.type, status: existingTransaction.status, amount: existingTransaction.amount, currency: wallet.currency, receiverWalletId: existingTransaction.receiver_wallet_id, completedAt: existingTransaction.completed_at },
      })
    }

    const transactionId = randomUUID()
    const reference = `DPT-${randomUUID()}`
    await client.query(`INSERT INTO transactions (id, sender_wallet_id, receiver_wallet_id, amount, type, status, reference, description, idempotency_key, beneficiary_id) VALUES ($1, NULL, $2, $3, 'DEPOSIT', 'PENDING', $4, $5, $6, $7)`, [transactionId, walletId, amount, reference, `Development test funding source: ${beneficiary.label} (${beneficiary.masked_identifier})`, idempotencyKey, beneficiaryId])
    const updatedWallet = await client.query(`UPDATE wallets SET balance = balance + $1::numeric, updated_at = NOW() WHERE id = $2 RETURNING balance`, [amount, walletId])
    const completedTransaction = await client.query(`UPDATE transactions SET status = 'COMPLETED', completed_at = NOW() WHERE id = $1 RETURNING id, reference, type, status, amount, receiver_wallet_id, completed_at`, [transactionId])
    await client.query('COMMIT')
    transactionStarted = false
    const transaction = completedTransaction.rows[0]
    return res.status(201).json({ success: true, message: 'Deposit completed successfully', wallet: { id: wallet.id, currency: wallet.currency, balance: updatedWallet.rows[0].balance }, transaction: { id: transaction.id, reference: transaction.reference, type: transaction.type, status: transaction.status, amount: transaction.amount, currency: wallet.currency, receiverWalletId: transaction.receiver_wallet_id, completedAt: transaction.completed_at } })
  } catch (error) {
    if (client && transactionStarted) await client.query('ROLLBACK')
    if (error instanceof DepositError) return res.status(error.statusCode).json({ success: false, message: error.message })
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') return res.status(409).json({ success: false, message: 'Duplicate deposit submission detected' })
    console.error('Deposit error:', error)
    return res.status(500).json({ success: false, message: 'Unable to complete deposit' })
  } finally { client?.release() }
})

export default router
