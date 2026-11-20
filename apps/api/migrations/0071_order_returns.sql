-- 0071_order_returns: returns, refunds and disputes of an order (cahier 7 and 9; BACKLOG G2).
-- Forward-only. No money transits through CASELIND (cash on delivery only): a refund is a status and an
-- amount recorded here ("settled outside the platform"). refund_minor is computed by the server from the
-- frozen order prices, never typed by the client. A future online payment plugs in at the 'refunded' step.
CREATE TABLE order_returns (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id       uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  org_id         uuid NOT NULL REFERENCES organizations(id),
  requested_by   uuid NOT NULL REFERENCES users(id),
  reason         text NOT NULL CONSTRAINT order_returns_reason_check
                   CHECK (reason IN ('defective', 'wrong_item', 'not_as_described', 'changed_mind', 'other')),
  details        text CONSTRAINT order_returns_details_check CHECK (details IS NULL OR char_length(details) <= 500),
  status         text NOT NULL DEFAULT 'requested' CONSTRAINT order_returns_status_check
                   CHECK (status IN ('requested', 'approved', 'rejected', 'received', 'refunded', 'disputed', 'resolved', 'cancelled')),
  -- [{orderItemId, variantId, title, unitPriceMinor, quantity}]: frozen copy of the lines concerned.
  items          jsonb NOT NULL,
  refund_minor   bigint NOT NULL CONSTRAINT order_returns_refund_check CHECK (refund_minor >= 0),
  refunded_minor bigint CONSTRAINT order_returns_refunded_check CHECK (refunded_minor IS NULL OR refunded_minor >= 0),
  currency       char(3) NOT NULL,
  seller_note    text CONSTRAINT order_returns_seller_note_check CHECK (seller_note IS NULL OR char_length(seller_note) <= 300),
  resolution     text CONSTRAINT order_returns_resolution_check
                   CHECK (resolution IS NULL OR resolution IN ('refund_buyer', 'refund_partial', 'reject')),
  dispute_reason text CONSTRAINT order_returns_dispute_reason_check CHECK (dispute_reason IS NULL OR char_length(dispute_reason) <= 500),
  admin_note     text CONSTRAINT order_returns_admin_note_check CHECK (admin_note IS NULL OR char_length(admin_note) <= 300),
  resolved_by    uuid REFERENCES users(id),
  restock        boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
-- One live request per order; only a cancelled one frees the slot.
CREATE UNIQUE INDEX order_returns_one_live_idx ON order_returns (order_id) WHERE status <> 'cancelled';
CREATE INDEX order_returns_org_idx ON order_returns (org_id, status, created_at DESC, id DESC);
CREATE INDEX order_returns_buyer_idx ON order_returns (requested_by, created_at DESC, id DESC);
CREATE INDEX order_returns_status_idx ON order_returns (status, created_at DESC, id DESC);
CREATE TRIGGER order_returns_set_updated_at BEFORE UPDATE ON order_returns FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- History of a return: status, who (kind) and when. No free text.
CREATE TABLE order_return_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id     uuid NOT NULL REFERENCES order_returns(id) ON DELETE CASCADE,
  from_status   text,
  status        text NOT NULL,
  actor_kind    text NOT NULL CONSTRAINT order_return_events_actor_check CHECK (actor_kind IN ('buyer', 'org', 'admin')),
  actor_user_id uuid,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX order_return_events_return_idx ON order_return_events (return_id, created_at, id);
