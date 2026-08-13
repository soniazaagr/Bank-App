BEGIN;

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS token_lookup_hash text,
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz,
  ADD COLUMN IF NOT EXISTS rotated_at timestamptz,
  ADD COLUMN IF NOT EXISTS replaced_by_session_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS sessions_token_lookup_hash_unique
  ON sessions (token_lookup_hash)
  WHERE token_lookup_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS sessions_user_id_active_idx
  ON sessions (user_id)
  WHERE revoked_at IS NULL;

COMMIT;
