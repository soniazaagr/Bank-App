import { createHash } from 'crypto'
import type { PoolClient } from 'pg'
import { pool } from '../config/database.js'

export type RateLimitDecision = {
  allowed: boolean
  retryAfterSeconds: number
}

function identifierHash(identifier: string) {
  return createHash('sha256').update(identifier, 'utf8').digest('hex')
}

export async function consumeRateLimit(
  action: string,
  identifier: string,
  maxAttempts: number,
  windowMs: number,
  blockMs = windowMs,
): Promise<RateLimitDecision> {
  let client: PoolClient | undefined
  try {
    client = await pool.connect()
    await client.query('BEGIN')
    const key = identifierHash(identifier)
    const result = await client.query(
      `
      SELECT window_started_at, attempt_count, blocked_until
      FROM auth_rate_limits
      WHERE action = $1 AND identifier_hash = $2
      FOR UPDATE
      `,
      [action, key],
    )
    const now = Date.now()
    let count = 1
    let windowStartedAt = new Date(now)
    let blockedUntil: Date | null = null

    if (result.rows.length > 0) {
      const row = result.rows[0]
      const existingWindow = new Date(row.window_started_at).getTime()
      const existingBlocked = row.blocked_until
        ? new Date(row.blocked_until).getTime()
        : 0

      if (existingBlocked > now) {
        await client.query('COMMIT')
        return {
          allowed: false,
          retryAfterSeconds: Math.ceil((existingBlocked - now) / 1000),
        }
      }

      if (now - existingWindow < windowMs) {
        count = Number(row.attempt_count) + 1
        windowStartedAt = new Date(existingWindow)
      }

      if (count > maxAttempts) {
        blockedUntil = new Date(now + blockMs)
      }
    }

    await client.query(
      `
      INSERT INTO auth_rate_limits (
        action, identifier_hash, window_started_at, attempt_count, blocked_until
      )
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (action, identifier_hash) DO UPDATE SET
        window_started_at = EXCLUDED.window_started_at,
        attempt_count = EXCLUDED.attempt_count,
        blocked_until = EXCLUDED.blocked_until,
        updated_at = NOW()
      `,
      [action, key, windowStartedAt, count, blockedUntil],
    )
    await client.query('COMMIT')

    return {
      allowed: !blockedUntil,
      retryAfterSeconds: blockedUntil
        ? Math.ceil((blockedUntil.getTime() - now) / 1000)
        : 0,
    }
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client?.release()
  }
}

export async function clearRateLimit(action: string, identifier: string) {
  await pool.query(
    `DELETE FROM auth_rate_limits WHERE action = $1 AND identifier_hash = $2`,
    [action, identifierHash(identifier)],
  )
}

export function requestIdentifier(ip: string | undefined, value: string) {
  return `${ip ?? 'unknown'}:${value.trim().toLowerCase()}`
}
