-- 0098_sanctions_appeals: sanctions graduees et recours (CDC §26). Forward-only.
-- Une sanction ne porte que son type, sa duree et un motif court ; le contenu signale n'est jamais copie ici.
CREATE TABLE user_sanctions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind            text NOT NULL CONSTRAINT user_sanctions_kind_check CHECK (kind IN ('warning', 'mute_posting', 'suspension_temp', 'ban')),
  reason          text NOT NULL CONSTRAINT user_sanctions_reason_check CHECK (char_length(reason) BETWEEN 3 AND 300),
  report_id       uuid REFERENCES reports(id) ON DELETE SET NULL,
  issued_by       uuid NOT NULL REFERENCES users(id),
  starts_at       timestamptz NOT NULL DEFAULT now(),
  ends_at         timestamptz,
  status          text NOT NULL DEFAULT 'active' CONSTRAINT user_sanctions_status_check CHECK (status IN ('active', 'lifted', 'expired', 'appealed')),
  -- Vrai quand CETTE sanction a fait passer le compte de active a suspended : seule celle-ci le reactive en fin de sanction.
  suspended_user  boolean NOT NULL DEFAULT false,
  lifted_by       uuid REFERENCES users(id),
  lifted_at       timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_sanctions_duration_check CHECK ((kind IN ('mute_posting', 'suspension_temp')) = (ends_at IS NOT NULL))
);
CREATE INDEX user_sanctions_user_idx ON user_sanctions (user_id, created_at DESC, id DESC);
CREATE INDEX user_sanctions_status_idx ON user_sanctions (status, created_at DESC, id DESC);
CREATE INDEX user_sanctions_effect_idx ON user_sanctions (user_id, kind) WHERE status IN ('active', 'appealed');
CREATE INDEX user_sanctions_due_idx ON user_sanctions (ends_at) WHERE status IN ('active', 'appealed') AND ends_at IS NOT NULL;

CREATE TABLE sanction_appeals (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Un seul recours par sanction.
  sanction_id   uuid NOT NULL UNIQUE REFERENCES user_sanctions(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message       text NOT NULL CONSTRAINT sanction_appeals_message_check CHECK (char_length(message) BETWEEN 1 AND 1000),
  status        text NOT NULL DEFAULT 'pending' CONSTRAINT sanction_appeals_status_check CHECK (status IN ('pending', 'accepted', 'rejected')),
  decided_by    uuid REFERENCES users(id),
  decision_note text CONSTRAINT sanction_appeals_note_check CHECK (decision_note IS NULL OR char_length(decision_note) <= 300),
  decided_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sanction_appeals_decided_check CHECK ((status = 'pending') = (decided_by IS NULL))
);
CREATE INDEX sanction_appeals_status_idx ON sanction_appeals (status, created_at DESC, id DESC);
CREATE INDEX sanction_appeals_user_idx ON sanction_appeals (user_id);

-- Nouveaux types de demandes de double validation : sanction lourde visant le personnel ou un administrateur, reglage sensible.
ALTER TABLE admin_approvals DROP CONSTRAINT admin_approvals_kind_check;
ALTER TABLE admin_approvals ADD CONSTRAINT admin_approvals_kind_check
  CHECK (kind IN ('flag.regulated.change', 'user.platform_role.grant', 'ledger.account.freeze', 'user.suspend.staff', 'sanction.issue', 'setting.sensitive'));
