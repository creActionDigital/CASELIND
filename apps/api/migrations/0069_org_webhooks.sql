-- 0069_org_webhooks: webhooks sortants des organisations (evenements de commandes, caisse, questions) et journal borne des envois. Forward-only.
-- Le secret de signature est chiffre (AES-256-GCM, cle derivee d'un secret d'environnement) : il doit etre relu pour signer, jamais renvoye.
CREATE TABLE org_webhooks (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  url              text NOT NULL CONSTRAINT org_webhooks_url_check CHECK (char_length(url) BETWEEN 8 AND 500),
  secret_enc       text NOT NULL,
  events           text[] NOT NULL CONSTRAINT org_webhooks_events_check CHECK (
    cardinality(events) BETWEEN 1 AND 10
    AND events <@ ARRAY['order.created', 'order.status_changed', 'pos.sale_created', 'pos.sale_voided', 'org.question_asked']::text[]),
  active           boolean NOT NULL DEFAULT true,
  failure_count    integer NOT NULL DEFAULT 0 CONSTRAINT org_webhooks_failures_check CHECK (failure_count >= 0),
  last_status      integer,
  last_delivery_at timestamptz,
  disabled_at      timestamptz,
  created_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX org_webhooks_org_idx ON org_webhooks (org_id);

-- payload : le corps JSON exact (identifiants, statut, montants, devise ; jamais de donnee de client), rejoue tel quel a chaque tentative.
-- L'API ne le renvoie jamais. Seuls les 100 derniers envois par abonnement sont gardes (maintenance).
CREATE TABLE org_webhook_deliveries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id      uuid NOT NULL REFERENCES org_webhooks(id) ON DELETE CASCADE,
  event           text NOT NULL,
  payload         text NOT NULL,
  payload_digest  text NOT NULL,
  status          text NOT NULL DEFAULT 'pending' CONSTRAINT org_webhook_deliveries_status_check CHECK (status IN ('pending', 'delivered', 'failed')),
  http_status     integer,
  error_code      text,
  attempt         integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  next_attempt_at timestamptz
);
CREATE INDEX org_webhook_deliveries_hook_idx ON org_webhook_deliveries (webhook_id, created_at DESC, id DESC);
CREATE INDEX org_webhook_deliveries_due_idx ON org_webhook_deliveries (next_attempt_at) WHERE status = 'pending';
