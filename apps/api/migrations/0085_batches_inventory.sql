-- 0085_batches_inventory: lots et peremption (complement d'information, ne change ni le stock ni la reservation) et inventaire physique. Forward-only.
CREATE TABLE stock_batches (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  variant_id         uuid NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  batch_code         text NOT NULL CONSTRAINT stock_batches_code_check CHECK (char_length(batch_code) BETWEEN 1 AND 40),
  expires_on         date,
  quantity_received  integer NOT NULL CONSTRAINT stock_batches_received_check CHECK (quantity_received BETWEEN 1 AND 1000000),
  quantity_remaining integer NOT NULL CONSTRAINT stock_batches_remaining_check CHECK (quantity_remaining >= 0),
  received_on        date NOT NULL DEFAULT current_date,
  note               text CONSTRAINT stock_batches_note_check CHECK (char_length(note) BETWEEN 1 AND 100),
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stock_batches_remaining_max_check CHECK (quantity_remaining <= quantity_received),
  CONSTRAINT stock_batches_variant_code_unique UNIQUE (variant_id, batch_code)
);
CREATE INDEX stock_batches_org_expiry_idx ON stock_batches (org_id, expires_on) WHERE quantity_remaining > 0 AND expires_on IS NOT NULL;
CREATE INDEX stock_batches_variant_idx ON stock_batches (variant_id, expires_on);

-- Une alerte de peremption par lot et par seuil ('soon' : dans 7 jours, 'expired').
CREATE TABLE stock_batch_alerts (
  batch_id uuid NOT NULL REFERENCES stock_batches(id) ON DELETE CASCADE,
  threshold text NOT NULL CONSTRAINT stock_batch_alerts_threshold_check CHECK (threshold IN ('soon', 'expired')),
  sent_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (batch_id, threshold)
);

CREATE TABLE inventory_counts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  status     text NOT NULL DEFAULT 'open' CONSTRAINT inventory_counts_status_check CHECK (status IN ('open', 'closed', 'cancelled')),
  opened_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  note       text CONSTRAINT inventory_counts_note_check CHECK (char_length(note) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at  timestamptz,
  applied    boolean NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX inventory_counts_one_open ON inventory_counts (org_id) WHERE status = 'open';
CREATE INDEX inventory_counts_org_idx ON inventory_counts (org_id, created_at DESC, id DESC);

CREATE TABLE inventory_count_lines (
  count_id         uuid NOT NULL REFERENCES inventory_counts(id) ON DELETE CASCADE,
  variant_id       uuid NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  counted_quantity integer NOT NULL CONSTRAINT inventory_count_lines_counted_check CHECK (counted_quantity >= 0),
  system_quantity  integer NOT NULL CONSTRAINT inventory_count_lines_system_check CHECK (system_quantity >= 0),
  counted_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (count_id, variant_id)
);
