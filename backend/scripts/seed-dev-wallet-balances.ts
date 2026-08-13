/**
 * Development-only wallet balance seeder.
 *
 * Usage (explicit wallet IDs only):
 *   NODE_ENV=development npx tsx scripts/seed-dev-wallet-balances.ts \
 *     <wallet-uuid>:100000 <wallet-uuid>:50000
 *
 * This utility never creates users, wallets, or transactions. It only sets the
 * current balance of the named existing wallets, so it must never be used in a
 * production environment.
 */
import dotenv from 'dotenv'
import { Pool } from 'pg'

dotenv.config()

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const amountPattern = /^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/

if (process.env.NODE_ENV !== 'development') {
  throw new Error('Refusing to seed balances: NODE_ENV must be exactly development.')
}

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not configured.')
}

const requestedBalances = process.argv.slice(2).map(value => {
  const separator = value.lastIndexOf(':')
  const walletId = value.slice(0, separator)
  const balance = value.slice(separator + 1)
  if (separator <= 0 || !uuidPattern.test(walletId) || !amountPattern.test(balance)) {
    throw new Error(`Invalid entry "${value}". Use <wallet-uuid>:<non-negative-amount>.`)
  }
  return { walletId, balance }
})

if (requestedBalances.length < 2) {
  throw new Error('Provide at least two existing development wallet IDs and balances.')
}

if (new Set(requestedBalances.map(item => item.walletId)).size !== requestedBalances.length) {
  throw new Error('Each wallet ID may be supplied only once.')
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

try {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const updated = []
    for (const { walletId, balance } of requestedBalances) {
      const result = await client.query(
        `
        UPDATE wallets
        SET balance = $1::numeric,
            updated_at = NOW()
        WHERE id = $2
          AND status = 'ACTIVE'
        RETURNING id, currency, balance, status
        `,
        [balance, walletId],
      )
      if (result.rows.length !== 1) {
        throw new Error(`Active wallet not found: ${walletId}`)
      }
      updated.push(result.rows[0])
    }
    await client.query('COMMIT')
    console.log('Development balances seeded and verified:', updated)
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
} finally {
  await pool.end()
}
