-- 0053_listing_offers: lot 15d guided price negotiation on classified ads. Forward-only. Indicative only (no sale, no payment). Deleted with the ad or the account.
CREATE TABLE listing_offers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id    uuid NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  buyer_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  offer_minor   bigint NOT NULL CONSTRAINT listing_offers_offer_check CHECK (offer_minor > 0),
  counter_minor bigint CONSTRAINT listing_offers_counter_check CHECK (counter_minor IS NULL OR counter_minor > offer_minor),
  currency      char(3) NOT NULL,
  message       text NOT NULL DEFAULT '' CONSTRAINT listing_offers_message_check CHECK (length(message) <= 300),
  status        text NOT NULL DEFAULT 'offered' CONSTRAINT listing_offers_status_check CHECK (status IN ('offered', 'countered', 'accepted', 'declined', 'cancelled')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
-- At most one open (offered or countered) negotiation per buyer and ad.
CREATE UNIQUE INDEX listing_offers_open_uniq ON listing_offers (listing_id, buyer_id) WHERE status IN ('offered', 'countered');
CREATE INDEX listing_offers_buyer_idx ON listing_offers (buyer_id, created_at DESC);
CREATE INDEX listing_offers_listing_idx ON listing_offers (listing_id, created_at DESC);
