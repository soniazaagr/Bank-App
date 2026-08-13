import { randomUUID } from 'crypto'
import { Router } from 'express'
import type { Response } from 'express'
import type { PoolClient } from 'pg'
import { pool } from '../config/database.js'
import { authenticateToken, type AuthenticatedRequest } from '../middleware/auth.middleware.js'

const router = Router()
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const AMOUNT_PATTERN = /^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/
const MAX_DESCRIPTION_LENGTH = 500
class WithdrawalError extends Error { constructor(public readonly statusCode: number, message: string) { super(message) } }
function canonicalAmount(value: string) { const [whole, fraction = ''] = value.split('.'); const trimmed = fraction.replace(/0+$/, ''); return trimmed ? `${whole}.${trimmed}` : whole }
function transactionResponse(transaction: Record<string, unknown>, wallet: Record<string, unknown>) { return { id: transaction.id, reference: transaction.reference, type: transaction.type, status: transaction.status, amount: transaction.amount, currency: wallet.currency, senderWalletId: transaction.sender_wallet_id, completedAt: transaction.completed_at } }

router.post('/', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  const { walletId, beneficiaryId, amount: rawAmount, description, idempotencyKey } = req.body ?? {}
  if (!req.userId) return res.status(401).json({ success: false, message: 'User authentication required' })
  if (typeof walletId !== 'string' || !UUID_PATTERN.test(walletId)) return res.status(400).json({ success: false, message: 'A valid walletId is required' })
  if (typeof beneficiaryId !== 'string' || !UUID_PATTERN.test(beneficiaryId)) return res.status(400).json({ success: false, message: 'A valid withdrawal beneficiary is required' })
  if (typeof rawAmount !== 'string' || !AMOUNT_PATTERN.test(rawAmount.trim()) || !/[1-9]/.test(rawAmount)) return res.status(400).json({ success: false, message: 'Amount must be a positive decimal with at most 16 whole digits and 2 decimal places' })
  if (typeof idempotencyKey !== 'string' || !UUID_PATTERN.test(idempotencyKey)) return res.status(400).json({ success: false, message: 'A valid idempotency key is required' })
  if (description !== undefined && (typeof description !== 'string' || description.length > MAX_DESCRIPTION_LENGTH)) return res.status(400).json({ success: false, message: `Description must be a string no longer than ${MAX_DESCRIPTION_LENGTH} characters` })
  const amount = rawAmount.trim()
  let client: PoolClient | undefined; let started = false
  try {
    client = await pool.connect(); await client.query('BEGIN'); started = true
    const walletResult = await client.query(`SELECT id, user_id, currency, balance, status FROM wallets WHERE id = $1 FOR UPDATE`, [walletId])
    const wallet = walletResult.rows[0]
    if (!wallet) throw new WithdrawalError(404, 'Wallet not found')
    if (wallet.user_id !== req.userId) throw new WithdrawalError(403, 'Wallet does not belong to you')
    if (wallet.status !== 'ACTIVE') throw new WithdrawalError(403, 'Wallet must be active')
    const beneficiaryResult = await client.query(`SELECT id, label, masked_identifier FROM financial_beneficiaries WHERE id = $1 AND user_id = $2 AND kind = 'WITHDRAWAL_DESTINATION' AND status = 'ACTIVE' FOR SHARE`, [beneficiaryId, req.userId])
    const beneficiary = beneficiaryResult.rows[0]
    if (!beneficiary) throw new WithdrawalError(403, 'Withdrawal beneficiary is unavailable or does not belong to you')
    const existing = await client.query(`SELECT id, reference, type, status, amount, sender_wallet_id, completed_at FROM transactions WHERE idempotency_key = $1 FOR UPDATE`, [idempotencyKey])
    if (existing.rows[0]) {
      if (existing.rows[0].sender_wallet_id !== walletId || canonicalAmount(existing.rows[0].amount) !== canonicalAmount(amount)) throw new WithdrawalError(409, 'This withdrawal request has already been used with different details')
      await client.query('COMMIT'); started = false
      return res.status(200).json({ success: true, message: 'Withdrawal already completed', wallet: { id: wallet.id, currency: wallet.currency, balance: wallet.balance }, transaction: transactionResponse(existing.rows[0], wallet) })
    }
    if (Number(wallet.balance) < Number(amount)) throw new WithdrawalError(422, 'Insufficient wallet balance')
    const transactionId = randomUUID(); const reference = `WDR-${randomUUID()}`
    const fullDescription = [ `Withdrawal destination: ${beneficiary.label} (${beneficiary.masked_identifier})`, description?.trim() ].filter(Boolean).join(' — ')
    await client.query(`INSERT INTO transactions (id, sender_wallet_id, receiver_wallet_id, amount, type, status, reference, description, idempotency_key, beneficiary_id) VALUES ($1, $2, NULL, $3, 'WITHDRAWAL', 'PENDING', $4, $5, $6, $7)`, [transactionId, walletId, amount, reference, fullDescription, idempotencyKey, beneficiaryId])
    const update = await client.query(`UPDATE wallets SET balance = balance - $1::numeric, updated_at = NOW() WHERE id = $2 RETURNING balance`, [amount, walletId])
    const complete = await client.query(`UPDATE transactions SET status = 'COMPLETED', completed_at = NOW() WHERE id = $1 RETURNING id, reference, type, status, amount, sender_wallet_id, completed_at`, [transactionId])
    await client.query('COMMIT'); started = false
    return res.status(201).json({ success: true, message: 'Withdrawal completed successfully', wallet: { id: wallet.id, currency: wallet.currency, balance: update.rows[0].balance }, transaction: transactionResponse(complete.rows[0], wallet) })
  } catch (error) {
    if (client && started) await client.query('ROLLBACK').catch(() => undefined)
    if (error instanceof WithdrawalError) return res.status(error.statusCode).json({ success: false, message: error.message })
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') return res.status(409).json({ success: false, message: 'Duplicate withdrawal submission detected' })
    console.error('Withdrawal error:', error); return res.status(500).json({ success: false, message: 'Unable to complete withdrawal' })
  } finally { client?.release() }
})
export default router
