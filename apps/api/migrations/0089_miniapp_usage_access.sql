-- 0089_miniapp_usage_access: statistiques d'usage par application et jour (compteurs, aucune donnee utilisateur) et journal
-- des lectures de donnees par les mini-applications (qui, quel scope, quelle ressource, quand ; jamais le contenu). Forward-only.

CREATE TABLE miniapp_usage_daily (
  miniapp_id         uuid NOT NULL REFERENCES miniapps(id) ON DELETE CASCADE,
  day                date NOT NULL,
  authorizations     integer NOT NULL DEFAULT 0,
  active_users       integer NOT NULL DEFAULT 0,
  api_calls          integer NOT NULL DEFAULT 0,
  payment_requests   integer NOT NULL DEFAULT 0,
  payments_confirmed integer NOT NULL DEFAULT 0,
  errors             integer NOT NULL DEFAULT 0,
  PRIMARY KEY (miniapp_id, day)
);
CREATE INDEX miniapp_usage_daily_day_idx ON miniapp_usage_daily (day);

CREATE TABLE miniapp_access_log (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  miniapp_id uuid NOT NULL REFERENCES miniapps(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope      text NOT NULL,
  resource   text NOT NULL CONSTRAINT miniapp_access_log_resource_check CHECK (resource IN ('profile', 'orders', 'payment')),
  at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX miniapp_access_log_user_idx ON miniapp_access_log (user_id, miniapp_id, at DESC, id DESC);
CREATE INDEX miniapp_access_log_at_idx ON miniapp_access_log (at);
