BEGIN;

CREATE TABLE IF NOT EXISTS auth_rate_limits (
  action text NOT NULL,
  identifier_hash text NOT NULL,
  window_started_at timestamptz NOT NULL DEFAULT NOW(),
  attempt_count integer NOT NULL DEFAULT 0,
  blocked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (action, identifier_hash)
);

CREATE INDEX IF NOT EXISTS auth_rate_limits_blocked_until_idx
  ON auth_rate_limits (blocked_until)
  WHERE blocked_until IS NOT NULL;

CREATE INDEX IF NOT EXISTS verification_codes_lookup_idx
  ON verification_codes (user_id, channel, created_at DESC)
  WHERE verified_at IS NULL;

COMMIT;
