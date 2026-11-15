-- 0029_freelance: lot 16b freelance missions, proposals, contracts with milestones, reviews, disputes (CDC §14). Forward-only.
-- No payment is processed here: contracts carry payment_mode 'external' until an escrow exists (CDC §34, no false integration).

INSERT INTO feature_flags (key, description, enabled, regulated) VALUES
  ('freelance', 'Freelance : missions, propositions, contrats à jalons, litiges', true, false);

ALTER TABLE reports DROP CONSTRAINT reports_target_type_check;
ALTER TABLE reports ADD CONSTRAINT reports_target_type_check
  CHECK (target_type IN ('user', 'post', 'comment', 'story', 'message', 'product', 'review', 'service', 'service_review', 'ride', 'listing', 'job', 'mission'));

CREATE TABLE missions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title         text NOT NULL CONSTRAINT missions_title_check CHECK (length(title) BETWEEN 3 AND 120),
  description   text NOT NULL DEFAULT '' CONSTRAINT missions_description_check CHECK (length(description) <= 4000),
  budget_minor  bigint NOT NULL CONSTRAINT missions_budget_check CHECK (budget_minor > 0),
  currency      char(3) NOT NULL CONSTRAINT missions_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
  deadline      date,
  status        text NOT NULL DEFAULT 'open' CONSTRAINT missions_status_check CHECK (status IN ('open', 'awarded', 'closed')),
  hidden        boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX missions_feed_idx ON missions (created_at DESC, id DESC) WHERE status = 'open' AND NOT hidden;
CREATE INDEX missions_client_idx ON missions (client_id, created_at DESC);

CREATE TABLE mission_proposals (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id     uuid NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  freelancer_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_minor   bigint NOT NULL CONSTRAINT mission_proposals_amount_check CHECK (amount_minor > 0),
  delivery_days  integer NOT NULL CONSTRAINT mission_proposals_days_check CHECK (delivery_days BETWEEN 1 AND 365),
  message        text NOT NULL DEFAULT '' CONSTRAINT mission_proposals_message_check CHECK (length(message) <= 2000),
  status         text NOT NULL DEFAULT 'proposed' CONSTRAINT mission_proposals_status_check CHECK (status IN ('proposed', 'accepted', 'rejected', 'withdrawn')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mission_proposals_unique UNIQUE (mission_id, freelancer_id)
);
CREATE INDEX mission_proposals_freelancer_idx ON mission_proposals (freelancer_id, created_at DESC);

CREATE TABLE freelance_contracts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id     uuid NOT NULL UNIQUE REFERENCES missions(id) ON DELETE CASCADE,
  client_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  freelancer_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_minor   bigint NOT NULL CONSTRAINT freelance_contracts_amount_check CHECK (amount_minor > 0),
  currency       char(3) NOT NULL,
  payment_mode   text NOT NULL DEFAULT 'external' CONSTRAINT freelance_contracts_payment_check CHECK (payment_mode IN ('external')),
  status         text NOT NULL DEFAULT 'active' CONSTRAINT freelance_contracts_status_check CHECK (status IN ('active', 'completed', 'cancelled', 'disputed')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT freelance_contracts_parties_check CHECK (client_id <> freelancer_id)
);
CREATE INDEX freelance_contracts_client_idx ON freelance_contracts (client_id, created_at DESC);
CREATE INDEX freelance_contracts_freelancer_idx ON freelance_contracts (freelancer_id, created_at DESC);

CREATE TABLE contract_milestones (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id    uuid NOT NULL REFERENCES freelance_contracts(id) ON DELETE CASCADE,
  position       integer NOT NULL CONSTRAINT contract_milestones_position_check CHECK (position >= 0),
  title          text NOT NULL CONSTRAINT contract_milestones_title_check CHECK (length(title) BETWEEN 1 AND 120),
  amount_minor   bigint NOT NULL CONSTRAINT contract_milestones_amount_check CHECK (amount_minor > 0),
  status         text NOT NULL DEFAULT 'pending' CONSTRAINT contract_milestones_status_check CHECK (status IN ('pending', 'delivered', 'revision', 'approved')),
  note           text NOT NULL DEFAULT '' CONSTRAINT contract_milestones_note_check CHECK (length(note) <= 2000),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contract_id, position)
);

CREATE TABLE freelance_reviews (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id  uuid NOT NULL REFERENCES freelance_contracts(id) ON DELETE CASCADE,
  reviewer_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reviewee_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating       smallint NOT NULL CONSTRAINT freelance_reviews_rating_check CHECK (rating BETWEEN 1 AND 5),
  body         text NOT NULL DEFAULT '' CONSTRAINT freelance_reviews_body_check CHECK (length(body) <= 1000),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contract_id, reviewer_id)
);

CREATE TABLE contract_disputes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id  uuid NOT NULL REFERENCES freelance_contracts(id) ON DELETE CASCADE,
  opened_by    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason       text NOT NULL CONSTRAINT contract_disputes_reason_check CHECK (length(reason) BETWEEN 5 AND 2000),
  status       text NOT NULL DEFAULT 'open' CONSTRAINT contract_disputes_status_check CHECK (status IN ('open', 'resolved')),
  outcome      text CONSTRAINT contract_disputes_outcome_check CHECK (outcome IS NULL OR outcome IN ('resume', 'cancel')),
  resolution   text NOT NULL DEFAULT '' CONSTRAINT contract_disputes_resolution_check CHECK (length(resolution) <= 2000),
  resolved_by  uuid REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  resolved_at  timestamptz
);
-- One open dispute per contract.
CREATE UNIQUE INDEX contract_disputes_open_unique ON contract_disputes (contract_id) WHERE status = 'open';
