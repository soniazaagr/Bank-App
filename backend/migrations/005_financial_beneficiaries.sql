BEGIN;

CREATE TABLE IF NOT EXISTS financial_beneficiaries (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('FUNDING_SOURCE', 'WITHDRAWAL_DESTINATION')),
  provider TEXT NOT NULL DEFAULT 'DEVELOPMENT_TEST',
  label TEXT NOT NULL,
  masked_identifier TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deactivated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS financial_beneficiaries_user_kind_active_idx
  ON financial_beneficiaries (user_id, kind, created_at DESC)
  WHERE status = 'ACTIVE';

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS beneficiary_id UUID REFERENCES financial_beneficiaries(id);

COMMIT;
