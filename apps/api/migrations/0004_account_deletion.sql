-- 0004_account_deletion: lot 1b account deletion with a grace period, then anonymisation.
-- Forward-only. Never edit an applied migration: add a new one.

-- Set by POST /v1/me/deletion-request; cleared by a successful login during the grace period
-- (ACCOUNT_DELETION_GRACE_DAYS). Once the grace period is over, maintenance anonymises the row.
ALTER TABLE users ADD COLUMN deletion_requested_at timestamptz;

-- An anonymised (deleted) account keeps its row for referential and audit purposes but no
-- longer holds an e-mail or phone number. A constraint cannot be altered in place: drop + add.
ALTER TABLE users DROP CONSTRAINT users_identifier_required;
ALTER TABLE users ADD CONSTRAINT users_identifier_required
  CHECK (status = 'deleted' OR email IS NOT NULL OR phone IS NOT NULL);

-- Lets the hourly purge find due deletions without scanning every user.
CREATE INDEX users_deletion_due_idx ON users (deletion_requested_at)
  WHERE deletion_requested_at IS NOT NULL AND status <> 'deleted';
