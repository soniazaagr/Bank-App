import { Router } from 'express'
import { pool } from '../config/database.js'
import { authenticateToken, type AuthenticatedRequest } from '../middleware/auth.middleware.js'

const router = Router()

router.get('/security', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await pool.query(
      `
      SELECT id, event_type, auth_method, created_at
      FROM security_events
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 50
      `,
      [req.userId],
    )

    return res.json({
      securityNotifications: result.rows.map(row => ({
        id: row.id,
        type: row.event_type,
        title: 'New sign-in detected',
        message: 'Your account was recently signed in.',
        authMethod: row.auth_method === 'EMAIL_OTP' ? 'Email OTP' : 'Verified authentication',
        createdAt: row.created_at,
      })),
    })
  } catch {
    console.error('Security notification retrieval failed')
    return res.status(500).json({ success: false, message: 'Unable to load notifications' })
  }
})

export default router
