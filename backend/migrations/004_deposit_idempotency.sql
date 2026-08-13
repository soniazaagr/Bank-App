-- Makes a client retry safe without creating a new financial table.
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS idempotency_key UUID;

CREATE UNIQUE INDEX IF NOT EXISTS transactions_deposit_idempotency_key_unique
  ON transactions (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
