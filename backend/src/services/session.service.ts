import bcrypt from 'bcrypt'
import { createHash, randomBytes, randomUUID } from 'crypto'
import jwt from 'jsonwebtoken'
import type { PoolClient } from 'pg'

const REFRESH_TOKEN_BYTES = 64
const REFRESH_TOKEN_PATTERN = /^[a-f0-9]{128}$/

export function isValidRefreshTokenFormat(value: unknown): value is string {
  return typeof value === 'string' && REFRESH_TOKEN_PATTERN.test(value)
}

export function createRefreshToken() {
  return randomBytes(REFRESH_TOKEN_BYTES).toString('hex')
}

export function createRefreshTokenLookupHash(refreshToken: string) {
  return createHash('sha256').update(refreshToken, 'utf8').digest('hex')
}

export function createRefreshTokenHash(refreshToken: string) {
  return bcrypt.hash(refreshToken, 12)
}

export function verifyRefreshToken(
  refreshToken: string,
  refreshTokenHash: string,
) {
  return bcrypt.compare(refreshToken, refreshTokenHash)
}

export async function createAuthenticatedSession(client: PoolClient, userId: string) {
  const accessSecret = process.env.JWT_ACCESS_SECRET
  if (!accessSecret) throw new Error('JWT_ACCESS_SECRET is missing from .env')

  const accessToken = jwt.sign({ sub: userId, type: 'access' }, accessSecret, {
    expiresIn: '15m',
  })
  const refreshToken = createRefreshToken()
  const refreshTokenHash = await createRefreshTokenHash(refreshToken)

  await client.query(
    `
    INSERT INTO sessions (id, user_id, refresh_token_hash, token_lookup_hash, expires_at)
    VALUES ($1, $2, $3, $4, $5)
    `,
    [
      randomUUID(),
      userId,
      refreshTokenHash,
      createRefreshTokenLookupHash(refreshToken),
      new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    ],
  )

  return { accessToken, refreshToken }
}
