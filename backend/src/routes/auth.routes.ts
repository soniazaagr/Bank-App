import { Router, type Response } from 'express'
import bcrypt from 'bcrypt'
import { randomUUID } from 'crypto'
import { pool } from '../config/database.js'
import { createVerificationCode } from '../services/verification.service.js'
import { consumeRateLimit, requestIdentifier } from '../services/rate-limit.service.js'
import type { PoolClient } from 'pg'
import { queueVerificationEmail } from '../services/email.service.js'
import { createAuthenticatedSession } from '../services/session.service.js'
import { setRefreshTokenCookie } from '../services/refresh-cookie.service.js'

const router = Router()

type ExistingUser = {
  id: string
  email: string
  phone: string
  email_verified: boolean
  password_hash: string
  status: string
  email_matches: boolean
}

async function findExistingUser(email: string, phone: string) {
  return pool.query<ExistingUser>(
    `
    SELECT id, email, phone, password_hash, email_verified, status, email = $1 AS email_matches
    FROM users
    WHERE email = $1 OR phone = $2
    LIMIT 1
    `,
    [email, phone],
  )
}

async function existingRegistrationResponse(res: Response, user: ExistingUser, password: unknown) {
  if (
    user.email_matches &&
    !user.email_verified &&
    user.status === 'PENDING' &&
    typeof password === 'string' &&
    await bcrypt.compare(password, user.password_hash)
  ) {
    return res.status(409).json({
      success: false,
      code: 'EMAIL_VERIFICATION_REQUIRED',
      message: 'An account with this email already exists and needs email verification.',
      verificationUser: { id: user.id, email: user.email, phone: user.phone, status: user.status },
    })
  }
  return res.status(409).json({ success: false, message: 'Email or phone already registered' })
}

router.post('/register', async (req, res) => {
  try {
    const { email, phone, password } = req.body

    const registrationLimit = await consumeRateLimit(
      'registration',
      req.ip ?? 'unknown',
      5,
      15 * 60 * 1000,
    )
    if (!registrationLimit.allowed) {
      return res.status(429).json({ success: false, message: 'Too many requests' })
    }

    if (!email || !phone || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email, phone and password are required',
      })
    }

    const existingUser = await findExistingUser(email, phone)

    if (existingUser.rows.length > 0) {
      return await existingRegistrationResponse(res, existingUser.rows[0]!, password)
    }

    const passwordHash = await bcrypt.hash(password, 12)
    const client = await pool.connect()

    try {
      await client.query('BEGIN')

      const userId = randomUUID()
      const walletId = randomUUID()

      await client.query(
        `
        INSERT INTO users (
          id,
          email,
          phone,
          password_hash,
          email_verified,
          phone_verified,
          status
        )
        VALUES ($1, $2, $3, $4, false, false, 'PENDING')
        `,
        [userId, email, phone, passwordHash],
      )

      await client.query(
        `
        INSERT INTO wallets (
          id,
          user_id,
          currency,
          balance,
          status
        )
        VALUES ($1, $2, 'PKR', 0, 'ACTIVE')
        `,
        [walletId, userId],
      )
      const emailVerification = await createVerificationCode(userId, 'EMAIL', client)
      await client.query('COMMIT')
      queueVerificationEmail(email, emailVerification.code)

      return res.status(201).json({
        success: true,
        message: 'User registered successfully. Verification required.',
        user: {
          id: userId,
          email,
          phone,
          emailVerified: false,
          status: 'PENDING',
        },
        wallet: {
          id: walletId,
          currency: 'PKR',
          balance: 0,
          status: 'ACTIVE',
        },
      })
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
      const { email, phone, password } = req.body
      if (email && phone) {
        const existingUser = await findExistingUser(email, phone)
        if (existingUser.rows.length > 0) return await existingRegistrationResponse(res, existingUser.rows[0]!, password)
      }
    }
    const diagnostic = error && typeof error === 'object'
      ? error as {
        name?: unknown
        message?: unknown
        code?: unknown
        stack?: unknown
        constraint?: unknown
        detail?: unknown
        table?: unknown
        column?: unknown
      }
      : undefined
    console.error('REGISTRATION ERROR', {
      name: typeof diagnostic?.name === 'string' ? diagnostic.name : 'UnknownError',
      message: typeof diagnostic?.message === 'string' ? diagnostic.message : 'Unknown error',
      code: typeof diagnostic?.code === 'string' ? diagnostic.code : undefined,
      stack: typeof diagnostic?.stack === 'string' ? diagnostic.stack : undefined,
      constraint: typeof diagnostic?.constraint === 'string' ? diagnostic.constraint : undefined,
      detail: typeof diagnostic?.detail === 'string' ? '[redacted: may contain user data]' : undefined,
      table: typeof diagnostic?.table === 'string' ? diagnostic.table : undefined,
      column: typeof diagnostic?.column === 'string' ? diagnostic.column : undefined,
    })

    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    })
  }
})

router.post('/verify-otp', async (req, res) => {
  let client: PoolClient | undefined
  try {
    const { userId, channel, code } = req.body

    if (!userId || !channel || !code) {
      return res.status(400).json({
        success: false,
        message: 'userId, channel and code are required',
      })
    }

    if (channel !== 'EMAIL') {
      return res.status(400).json({
        success: false,
        message: 'Channel must be EMAIL',
      })
    }

    const verificationLimit = await consumeRateLimit(
      'otp_verification',
      requestIdentifier(req.ip, `${userId}:${channel}`),
      20,
      10 * 60 * 1000,
    )
    if (!verificationLimit.allowed) {
      return res.status(429).json({ success: false, message: 'Too many requests' })
    }

    client = await pool.connect()
    await client.query('BEGIN')

    const result = await client.query(
      `
      SELECT id, code_hash, expires_at, attempts
      FROM verification_codes
      WHERE user_id = $1
        AND channel = $2
        AND verified_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1
      FOR UPDATE
      `,
      [userId, channel],
    )

    if (result.rows.length === 0) {
      await client.query('ROLLBACK')
      return res.status(404).json({
        success: false,
        message: 'Verification code not found',
      })
    }

    const verification = result.rows[0]

    if (new Date(verification.expires_at) < new Date()) {
      await client.query('ROLLBACK')
      return res.status(400).json({
        success: false,
        message: 'Verification code has expired',
      })
    }

    if (verification.attempts >= 5) {
      await client.query('ROLLBACK')
      return res.status(429).json({
        success: false,
        message: 'Too many verification attempts',
      })
    }

    const isValid = await bcrypt.compare(
      code,
      verification.code_hash,
    )

    if (!isValid) {
      const updated = await client.query(
        `
        UPDATE verification_codes
        SET attempts = attempts + 1
        WHERE id = $1 AND verified_at IS NULL AND attempts < 5
        RETURNING attempts
        `,
        [verification.id],
      )

      await client.query('COMMIT')

      if (updated.rows.length === 0 || Number(updated.rows[0].attempts) >= 5) {
        return res.status(429).json({ success: false, message: 'Too many verification attempts' })
      }

      return res.status(400).json({
        success: false,
        message: 'Invalid verification code',
      })
    }

    const consumed = await client.query(
      `
      UPDATE verification_codes
      SET verified_at = NOW()
      WHERE id = $1 AND verified_at IS NULL AND expires_at > NOW()
      RETURNING id
      `,
      [verification.id],
    )

    if (consumed.rows.length === 0) {
      await client.query('ROLLBACK')
      return res.status(400).json({ success: false, message: 'Invalid verification code' })
    }

    await client.query(
        `
        UPDATE users
        SET email_verified = true,
            status = 'ACTIVE',
            updated_at = NOW()
        WHERE id = $1
        `,
        [userId],
      )

    const userResult = await client.query(
      `SELECT id, email, phone, status FROM users WHERE id = $1 LIMIT 1`,
      [userId],
    )
    const session = await createAuthenticatedSession(client, userId)

    await client.query('COMMIT')
    setRefreshTokenCookie(res, session.refreshToken)

    return res.json({
      success: true,
      message: 'Email verified successfully',
      accessToken: session.accessToken,
      user: userResult.rows[0],
    })
  } catch {
    if (client) await client.query('ROLLBACK').catch(() => undefined)
    console.error('OTP verification operation failed')

    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    })
  }
  finally {
    client?.release()
  }
})

router.post('/resend-otp', async (req, res) => {
  const { userId, channel } = req.body
  const safeResponse = {
    success: true,
    message: 'If the verification request is valid, a new code has been issued.',
  }

  if (!userId || channel !== 'EMAIL') {
    return res.json(safeResponse)
  }

  try {
    let emailDelivery: { recipient: string, code: string } | undefined
    const ipLimit = await consumeRateLimit(
      'otp_resend_ip',
      req.ip ?? 'unknown',
      10,
      10 * 60 * 1000,
    )
    const accountLimit = await consumeRateLimit(
      'otp_resend_account',
      requestIdentifier(req.ip, `${userId}:${channel}`),
      3,
      10 * 60 * 1000,
    )
    if (!ipLimit.allowed || !accountLimit.allowed) {
      return res.status(429).json({ success: false, message: 'Too many requests' })
    }

    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const user = await client.query(
        `SELECT id, email FROM users WHERE id = $1 AND status = 'PENDING' LIMIT 1`,
        [userId],
      )
      if (user.rows.length > 0) {
        const recent = await client.query(
          `
          SELECT id FROM verification_codes
          WHERE user_id = $1 AND channel = $2 AND created_at > NOW() - INTERVAL '60 seconds'
            AND verified_at IS NULL
          LIMIT 1
          `,
          [userId, channel],
        )
        if (recent.rows.length === 0) {
          await client.query(
            `UPDATE verification_codes SET verified_at = NOW() WHERE user_id = $1 AND channel = $2 AND verified_at IS NULL`,
            [userId, channel],
          )
          const newVerification = await createVerificationCode(userId, channel, client)
          emailDelivery = { recipient: user.rows[0].email, code: newVerification.code }
        }
      }
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
    if (emailDelivery) queueVerificationEmail(emailDelivery.recipient, emailDelivery.code)
    return res.json(safeResponse)
  } catch {
    console.error('OTP resend operation failed')
    return res.json(safeResponse)
  }
})

export default router
