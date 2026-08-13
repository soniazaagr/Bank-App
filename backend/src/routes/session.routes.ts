import { randomUUID } from 'crypto'
import { Router } from 'express'
import jwt from 'jsonwebtoken'
import type { PoolClient } from 'pg'
import { pool } from '../config/database.js'
import {
  createRefreshToken,
  createRefreshTokenHash,
  createRefreshTokenLookupHash,
  isValidRefreshTokenFormat,
  verifyRefreshToken,
} from '../services/session.service.js'
import {
  clearRefreshTokenCookie,
  readRefreshTokenCookie,
  setRefreshTokenCookie,
} from '../services/refresh-cookie.service.js'

const router = Router()
const accessSecret = process.env.JWT_ACCESS_SECRET

if (!accessSecret) {
  throw new Error('JWT_ACCESS_SECRET is missing from .env')
}

const invalidRefreshResponse = {
  success: false,
  message: 'Invalid or expired refresh token',
}

router.post('/refresh', async (req, res) => {
  const refreshToken: unknown = readRefreshTokenCookie(req)

  if (!isValidRefreshTokenFormat(refreshToken)) {
    return res.status(401).json(invalidRefreshResponse)
  }

  let client: PoolClient | undefined

  try {
    client = await pool.connect()
    await client.query('BEGIN')

    const sessionResult = await client.query(
      `
      SELECT
        s.id,
        s.user_id,
        s.refresh_token_hash,
        s.expires_at,
        s.revoked_at,
        u.status,
        u.email_verified
      FROM sessions s
      LEFT JOIN users u ON u.id = s.user_id
      WHERE s.token_lookup_hash = $1
      LIMIT 1
      FOR UPDATE OF s
      `,
      [createRefreshTokenLookupHash(refreshToken)],
    )

    if (sessionResult.rows.length === 0) {
      await client.query('ROLLBACK')
      return res.status(401).json(invalidRefreshResponse)
    }

    const session = sessionResult.rows[0]
    const tokenMatches = await verifyRefreshToken(
      refreshToken,
      session.refresh_token_hash,
    )

    if (!tokenMatches || session.revoked_at) {
      await client.query('ROLLBACK')
      return res.status(401).json(invalidRefreshResponse)
    }

    if (new Date(session.expires_at).getTime() <= Date.now()) {
      await client.query(
        `UPDATE sessions SET revoked_at = NOW() WHERE id = $1`,
        [session.id],
      )
      await client.query('COMMIT')
      return res.status(401).json(invalidRefreshResponse)
    }

    if (
      !session.user_id ||
      session.status !== 'ACTIVE' ||
      !session.email_verified
    ) {
      await client.query(
        `UPDATE sessions SET revoked_at = NOW() WHERE id = $1`,
        [session.id],
      )
      await client.query('COMMIT')
      return res.status(401).json(invalidRefreshResponse)
    }

    const newRefreshToken = createRefreshToken()
    const newRefreshTokenHash = await createRefreshTokenHash(newRefreshToken)
    const newSessionId = randomUUID()
    const accessToken = jwt.sign(
      { sub: session.user_id, type: 'access' },
      accessSecret,
      { expiresIn: '15m' },
    )

    await client.query(
      `
      INSERT INTO sessions (
        id,
        user_id,
        refresh_token_hash,
        token_lookup_hash,
        expires_at
      )
      VALUES ($1, $2, $3, $4, $5)
      `,
      [
        newSessionId,
        session.user_id,
        newRefreshTokenHash,
        createRefreshTokenLookupHash(newRefreshToken),
        session.expires_at,
      ],
    )

    await client.query(
      `
      UPDATE sessions
      SET revoked_at = NOW(),
          rotated_at = NOW(),
          replaced_by_session_id = $2
      WHERE id = $1 AND revoked_at IS NULL
      `,
      [session.id, newSessionId],
    )

    await client.query('COMMIT')

    setRefreshTokenCookie(res, newRefreshToken)

    return res.json({
      success: true,
      accessToken,
    })
  } catch {
    if (client) {
      await client.query('ROLLBACK').catch(() => undefined)
    }
    console.error('Refresh operation failed')
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    })
  } finally {
    client?.release()
  }
})

router.post('/logout', async (req, res) => {
  const refreshToken: unknown = readRefreshTokenCookie(req)
  clearRefreshTokenCookie(res)

  if (!isValidRefreshTokenFormat(refreshToken)) {
    return res.status(401).json(invalidRefreshResponse)
  }

  let client: PoolClient | undefined

  try {
    client = await pool.connect()
    await client.query('BEGIN')

    const sessionResult = await client.query(
      `
      SELECT id, refresh_token_hash
      FROM sessions
      WHERE token_lookup_hash = $1
      LIMIT 1
      FOR UPDATE
      `,
      [createRefreshTokenLookupHash(refreshToken)],
    )

    if (sessionResult.rows.length === 0) {
      await client.query('ROLLBACK')
      return res.status(401).json(invalidRefreshResponse)
    }

    const session = sessionResult.rows[0]
    const tokenMatches = await verifyRefreshToken(
      refreshToken,
      session.refresh_token_hash,
    )

    if (!tokenMatches) {
      await client.query('ROLLBACK')
      return res.status(401).json(invalidRefreshResponse)
    }

    await client.query(
      `
      UPDATE sessions
      SET revoked_at = COALESCE(revoked_at, NOW())
      WHERE id = $1
      `,
      [session.id],
    )
    await client.query('COMMIT')
    return res.json({
      success: true,
      message: 'Logout successful',
    })
  } catch {
    if (client) {
      await client.query('ROLLBACK').catch(() => undefined)
    }
    console.error('Logout operation failed')
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    })
  } finally {
    client?.release()
  }
})

export default router
