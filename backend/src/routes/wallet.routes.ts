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

function maskEmail(value: string) {
  const [local, domain] = value.split('@')
  return `${(local ?? '').slice(0, 2)}***@${domain ?? ''}`
}

router.get(
  '/recipient/:walletId',
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response) => {
    const walletId = req.params.walletId
    if (!req.userId) {
      return res.status(401).json({ success: false, message: 'User authentication required' })
    }
    if (typeof walletId !== 'string' || !UUID_PATTERN.test(walletId)) {
      return res.status(400).json({ success: false, message: 'Enter a valid recipient wallet ID' })
    }

    try {
      const result = await pool.query(
        `
        SELECT wallets.id, wallets.user_id, wallets.currency, wallets.status, users.email
        FROM wallets
        JOIN users ON users.id = wallets.user_id
        WHERE wallets.id = $1
        LIMIT 1
        `,
        [walletId],
      )
      if (result.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Recipient wallet not found' })
      }

      const wallet = result.rows[0]
      if (wallet.user_id === req.userId) {
        return res.status(400).json({ success: false, message: 'You cannot send money to your own wallet' })
      }

      return res.json({
        success: true,
        recipient: {
          walletId: wallet.id,
          identifier: maskEmail(wallet.email),
          currency: wallet.currency,
          status: wallet.status,
        },
      })
    } catch (error) {
      console.error('Recipient lookup error:', error)
      return res.status(500).json({ success: false, message: 'Unable to find recipient' })
    }
  },
)

router.get(
  '/balance',
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!req.userId) {
        return res.status(401).json({
          success: false,
          message: 'User authentication required',
        })
      }

      const result = await pool.query(
        `
        SELECT
          id,
          currency,
          balance,
          status
        FROM wallets
        WHERE user_id = $1
        ORDER BY currency
        `,
        [req.userId],
      )

      return res.json({
        success: true,
        wallets: result.rows,
      })
    } catch (error) {
      console.error('Wallet balance error:', error)

      return res.status(500).json({
        success: false,
        message: 'Unable to fetch wallet balance',
      })
    }
  },
)

export default router
