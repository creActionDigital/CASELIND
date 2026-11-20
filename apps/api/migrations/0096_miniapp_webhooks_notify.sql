-- 0096_miniapp_webhooks_notify: evenements sortants vers les mini-applications (un webhook par application, secret chiffre,
-- journal borne) et compteur des notifications envoyees par une application a un utilisateur. Forward-only.

CREATE TABLE miniapp_webhooks (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  miniapp_id       uuid NOT NULL UNIQUE REFERENCES miniapps(id) ON DELETE CASCADE,
  url              text NOT NULL CONSTRAINT miniapp_webhooks_url_check CHECK (url ~ '^https://' AND char_length(url) <= 500),
  secret_enc       text NOT NULL,
  events           text[] NOT NULL CONSTRAINT miniapp_webhooks_events_check
                     CHECK (cardinality(events) BETWEEN 1 AND 5
                            AND events <@ ARRAY['authorization.granted', 'authorization.revoked', 'payment.confirmed', 'payment.declined', 'user.data_deletion_requested']),
  active           boolean NOT NULL DEFAULT true,
  failure_count    integer NOT NULL DEFAULT 0,
  last_status      integer,
  last_delivery_at timestamptz,
  disabled_at      timestamptz,
  created_by       uuid REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE miniapp_webhook_deliveries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id      uuid NOT NULL REFERENCES miniapp_webhooks(id) ON DELETE CASCADE,
  event           text NOT NULL,
  payload         text NOT NULL,
  payload_digest  text NOT NULL,
  status          text NOT NULL DEFAULT 'pending' CONSTRAINT miniapp_webhook_deliveries_status_check CHECK (status IN ('pending', 'delivered', 'failed')),
  http_status     integer,
  error_code      text,
  attempt         integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  next_attempt_at timestamptz
);
CREATE INDEX miniapp_webhook_deliveries_hook_idx ON miniapp_webhook_deliveries (webhook_id, created_at DESC, id DESC);
CREATE INDEX miniapp_webhook_deliveries_due_idx ON miniapp_webhook_deliveries (next_attempt_at) WHERE status = 'pending';

-- Notifications envoyees par une application : compteur par application, utilisateur et jour (aucun contenu).
CREATE TABLE miniapp_notify_daily (
  miniapp_id uuid NOT NULL REFERENCES miniapps(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day        date NOT NULL,
  n          integer NOT NULL DEFAULT 0,
  PRIMARY KEY (miniapp_id, user_id, day)
);
CREATE INDEX miniapp_notify_daily_day_idx ON miniapp_notify_daily (day);
