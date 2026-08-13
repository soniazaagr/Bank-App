import bcrypt from 'bcrypt'
import { Router } from 'express'
import jwt from 'jsonwebtoken'
import type { PoolClient } from 'pg'
import { pool } from '../config/database.js'
import { sendLoginVerificationEmail } from '../services/email.service.js'
import { clearRateLimit, consumeRateLimit, requestIdentifier } from '../services/rate-limit.service.js'
import { setRefreshTokenCookie } from '../services/refresh-cookie.service.js'
import { createAuthenticatedSession } from '../services/session.service.js'
import { recordSuccessfulLogin } from '../services/security-event.service.js'
import { createVerificationCode } from '../services/verification.service.js'

const router = Router()
const accessSecret = process.env.JWT_ACCESS_SECRET

if (!accessSecret) {
  throw new Error('JWT_ACCESS_SECRET is missing from .env')
}

function createLoginChallengeToken(verificationId: string) {
  return jwt.sign(
    { verificationId, type: 'login_otp' },
    accessSecret!,
    { expiresIn: '10m' },
  )
}

function readLoginChallengeToken(value: unknown) {
  if (typeof value !== 'string') return null
  try {
    const payload = jwt.verify(value, accessSecret!)
    if (
      typeof payload !== 'object' ||
      payload.type !== 'login_otp' ||
      typeof payload.verificationId !== 'string'
    ) return null
    return payload.verificationId
  } catch {
    return null
  }
}

function maskedEmail(value: string) {
  const [local, domain] = value.split('@')
  return `${(local ?? '').slice(0, 2)}***@${domain ?? ''}`
}

function logSafeError(operation: string, error: unknown) {
  const details = error && typeof error === 'object'
    ? error as { message?: unknown; code?: unknown; stack?: unknown }
    : undefined
  console.error(operation, {
    message: typeof details?.message === 'string' ? details.message : 'Unknown error',
    code: typeof details?.code === 'string' ? details.code : undefined,
    ...(process.env.NODE_ENV !== 'production' && typeof details?.stack === 'string'
      ? { stack: details.stack }
      : {}),
  })
}

router.post('/login', async (req, res) => {
  try {
    const { email, phone, password } = req.body
    const identifier = email || phone || ''
    const loginKey = requestIdentifier(req.ip, identifier)
    const loginLimit = await consumeRateLimit('login', loginKey, 5, 15 * 60 * 1000, 15 * 60 * 1000)
    const loginIpLimit = await consumeRateLimit('login_ip', req.ip ?? 'unknown', 30, 15 * 60 * 1000, 15 * 60 * 1000)

    if (!loginLimit.allowed || !loginIpLimit.allowed) {
      return res.status(429).json({ success: false, message: 'Too many login attempts' })
    }
    if ((!email && !phone) || (email && phone) || !password) {
      return res.status(400).json({
        success: false,
        message: 'Exactly one of email or phone, plus password, is required',
      })
    }

    const result = await pool.query(
      `
      SELECT id, email, phone, password_hash, email_verified, status
      FROM users
      WHERE email = $1 OR phone = $1
      LIMIT 1
      `,
      [identifier],
    )
    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' })
    }

    const user = result.rows[0]
    if (user.status !== 'ACTIVE' || !user.email_verified) {
      return res.status(403).json({ success: false, message: 'Account verification is required' })
    }
    if (!(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' })
    }

    await pool.query(
      `UPDATE verification_codes SET verified_at = NOW() WHERE user_id = $1 AND channel = 'EMAIL' AND verified_at IS NULL`,
      [user.id],
    )
    const verification = await createVerificationCode(user.id, 'EMAIL')
    await sendLoginVerificationEmail(user.email, verification.code)
    await clearRateLimit('login', loginKey)

    return res.json({
      success: true,
      message: 'Login verification code sent by email',
      challengeId: createLoginChallengeToken(verification.id),
      destination: maskedEmail(user.email),
    })
  } catch {
    console.error('Login operation failed')
    return res.status(500).json({ success: false, message: 'Internal server error' })
  }
})

router.post('/login/verify-otp', async (req, res) => {
  const { challengeId, code } = req.body
  if (!challengeId || !code) {
    return res.status(400).json({ success: false, message: 'challengeId and code are required' })
  }
  const verificationId = readLoginChallengeToken(challengeId)
  if (!verificationId) {
    return res.status(400).json({ success: false, message: 'Login challenge is invalid or expired' })
  }

  const limit = await consumeRateLimit(
    'login_otp_verification',
    requestIdentifier(req.ip, challengeId),
    10,
    10 * 60 * 1000,
  )
  if (!limit.allowed) {
    return res.status(429).json({ success: false, message: 'Too many verification attempts' })
  }

  let client: PoolClient | undefined
  try {
    client = await pool.connect()
    await client.query('BEGIN')
    const result = await client.query(
      `
      SELECT v.id, v.user_id, v.code_hash, v.expires_at, v.attempts,
             u.email, u.phone, u.status, u.email_verified
      FROM verification_codes v
      JOIN users u ON u.id = v.user_id
      WHERE v.id = $1 AND v.verified_at IS NULL
      LIMIT 1
      FOR UPDATE OF v
      `,
      [verificationId],
    )
    if (result.rows.length === 0) {
      await client.query('ROLLBACK')
      return res.status(400).json({ success: false, message: 'Invalid verification code' })
    }

    const verification = result.rows[0]
    if (verification.status !== 'ACTIVE' || !verification.email_verified) {
      await client.query('ROLLBACK')
      return res.status(403).json({ success: false, message: 'Account verification is required' })
    }
    if (new Date(verification.expires_at).getTime() <= Date.now()) {
      await client.query('ROLLBACK')
      return res.status(400).json({ success: false, message: 'Verification code has expired' })
    }
    if (verification.attempts >= 5) {
      await client.query('ROLLBACK')
      return res.status(429).json({ success: false, message: 'Too many verification attempts' })
    }

    if (!(await bcrypt.compare(String(code), verification.code_hash))) {
      const updated = await client.query(
        `UPDATE verification_codes SET attempts = attempts + 1 WHERE id = $1 AND attempts < 5 RETURNING attempts`,
        [verificationId],
      )
      await client.query('COMMIT')
      if (updated.rows.length === 0 || Number(updated.rows[0].attempts) >= 5) {
        return res.status(429).json({ success: false, message: 'Too many verification attempts' })
      }
      return res.status(400).json({ success: false, message: 'Invalid verification code' })
    }

    const consumed = await client.query(
      `UPDATE verification_codes SET verified_at = NOW() WHERE id = $1 AND verified_at IS NULL AND expires_at > NOW() RETURNING id`,
      [verificationId],
    )
    if (consumed.rows.length === 0) {
      await client.query('ROLLBACK')
      return res.status(400).json({ success: false, message: 'Invalid verification code' })
    }

    const session = await createAuthenticatedSession(client, verification.user_id)
    await client.query('COMMIT')
    setRefreshTokenCookie(res, session.refreshToken)
    await clearRateLimit('login_otp_verification', requestIdentifier(req.ip, challengeId))

    try {
      await recordSuccessfulLogin(client, verification.user_id)
    } catch (error) {
      logSafeError('Login security notification recording failed', error)
    }

    return res.json({
      success: true,
      message: 'Login successful',
      accessToken: session.accessToken,
      user: {
        id: verification.user_id,
        email: verification.email,
        phone: verification.phone,
        status: verification.status,
      },
    })
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => undefined)
    logSafeError('Login OTP verification operation failed', error)
    return res.status(500).json({ success: false, message: 'Internal server error' })
  } finally {
    client?.release()
  }
})

router.post('/login/resend-otp', async (req, res) => {
  const { challengeId } = req.body
  if (!challengeId) {
    return res.status(400).json({ success: false, message: 'challengeId is required' })
  }
  const verificationId = readLoginChallengeToken(challengeId)
  if (!verificationId) {
    return res.status(400).json({ success: false, message: 'Login challenge is invalid or expired' })
  }

  const limit = await consumeRateLimit(
    'login_otp_resend',
    requestIdentifier(req.ip, challengeId),
    3,
    10 * 60 * 1000,
  )
  if (!limit.allowed) {
    return res.status(429).json({ success: false, message: 'Too many requests' })
  }

  try {
    const result = await pool.query(
      `
      SELECT v.user_id, v.created_at, u.email
      FROM verification_codes v
      JOIN users u ON u.id = v.user_id
      WHERE v.id = $1 AND v.verified_at IS NULL AND u.status = 'ACTIVE'
      LIMIT 1
      `,
      [verificationId],
    )
    if (result.rows.length === 0) {
      return res.status(400).json({ success: false, message: 'Login challenge is no longer valid' })
    }
    const current = result.rows[0]
    if (Date.now() - new Date(current.created_at).getTime() < 60 * 1000) {
      return res.status(429).json({ success: false, message: 'Please wait before requesting another code' })
    }

    await pool.query(`UPDATE verification_codes SET verified_at = NOW() WHERE id = $1`, [verificationId])
    const verification = await createVerificationCode(current.user_id, 'EMAIL')
    await sendLoginVerificationEmail(current.email, verification.code)

    return res.json({
      success: true,
      message: 'A new code was sent by email',
      challengeId: createLoginChallengeToken(verification.id),
      destination: maskedEmail(current.email),
    })
  } catch {
    console.error('Login OTP resend operation failed')
    return res.status(500).json({ success: false, message: 'Internal server error' })
  }
})

export default router
