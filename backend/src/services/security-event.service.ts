import { randomUUID } from 'crypto'
import type { PoolClient } from 'pg'

export async function recordSuccessfulLogin(client: PoolClient, userId: string) {
  await client.query(
    `
    INSERT INTO security_events (id, user_id, event_type, auth_method)
    VALUES ($1, $2, 'LOGIN_SUCCESS', 'EMAIL_OTP')
    `,
    [randomUUID(), userId],
  )
}
