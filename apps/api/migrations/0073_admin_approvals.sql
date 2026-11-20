-- 0073_admin_approvals: double validation des operations sensibles (CDC §17 et §26). Forward-only.
-- Une demande ne porte que des identifiants et des valeurs de reglage (payload minimal), jamais de contenu personnel.
-- L'auteur ne peut pas decider sa propre demande (decided_by <> requested_by), la demande expire apres 24 h.
CREATE TABLE admin_approvals (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          text NOT NULL CONSTRAINT admin_approvals_kind_check
                  CHECK (kind IN ('flag.regulated.change', 'user.platform_role.grant', 'ledger.account.freeze', 'user.suspend.staff')),
  subject_id    text,
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb CONSTRAINT admin_approvals_payload_check CHECK (jsonb_typeof(payload) = 'object'),
  reason        text CONSTRAINT admin_approvals_reason_check CHECK (reason IS NULL OR char_length(reason) <= 300),
  requested_by  uuid NOT NULL REFERENCES users(id),
  status        text NOT NULL DEFAULT 'pending' CONSTRAINT admin_approvals_status_check
                  CHECK (status IN ('pending', 'approved', 'rejected', 'expired', 'executed', 'cancelled')),
  decided_by    uuid REFERENCES users(id),
  decided_at    timestamptz,
  executed_at   timestamptz,
  expires_at    timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_approvals_four_eyes_check CHECK (decided_by IS NULL OR decided_by <> requested_by),
  CONSTRAINT admin_approvals_decided_check CHECK ((status IN ('approved', 'rejected', 'executed')) = (decided_by IS NOT NULL))
);
CREATE INDEX admin_approvals_status_idx ON admin_approvals (status, created_at DESC, id DESC);
CREATE INDEX admin_approvals_pending_subject_idx ON admin_approvals (kind, subject_id, requested_by) WHERE status = 'pending';
