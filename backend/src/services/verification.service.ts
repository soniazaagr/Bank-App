import bcrypt from 'bcrypt'
import { randomInt, randomUUID } from 'crypto'
import { pool } from '../config/database.js'
import type { Pool, PoolClient } from 'pg'

type VerificationChannel = 'EMAIL'

export async function createVerificationCode(
  userId: string,
  channel: VerificationChannel,
  db: Pool | PoolClient = pool,
) {
  // Generate a 6-digit OTP
  const code = randomInt(100000, 1000000).toString()

  // Never store the actual OTP in PostgreSQL
  const codeHash = await bcrypt.hash(code, 12)

  // OTP will expire after 10 minutes
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000)

  const id = randomUUID()

  await db.query(
    `
    INSERT INTO verification_codes (
      id,
      user_id,
      channel,
      code_hash,
      expires_at,
      attempts
    )
    VALUES ($1, $2, $3, $4, $5, 0)
    `,
    [id, userId, channel, codeHash, expiresAt],
  )

  // Temporary development return.
  // Later this code will be sent through the real
  // email/SMS provider and will NOT be returned by the API.
  return {
    id,
    code,
    channel,
    expiresAt,
  }
}
