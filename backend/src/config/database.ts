import { Pool } from 'pg'
import dotenv from 'dotenv'

dotenv.config()

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not configured')
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
})

export async function testDatabaseConnection() {
  const result = await pool.query('SELECT NOW() AS current_time')
  console.log('PostgreSQL connected:', result.rows[0])
}