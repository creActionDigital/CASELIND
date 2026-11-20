-- 0082_purchasing_expenses: gestion d'entreprise (CDC section 8) : fournisseurs, bons de commande d'achat, depenses.
-- Enregistrements de gestion : aucun argent ne transite. Forward-only.
CREATE TABLE suppliers (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name         text NOT NULL CONSTRAINT suppliers_name_check CHECK (char_length(name) BETWEEN 1 AND 120),
  contact_name text CONSTRAINT suppliers_contact_check CHECK (char_length(contact_name) <= 120),
  phone        text CONSTRAINT suppliers_phone_check CHECK (phone ~ '^\+[1-9][0-9]{6,14}$'),
  email        text CONSTRAINT suppliers_email_check CHECK (char_length(email) <= 254),
  address      text CONSTRAINT suppliers_address_check CHECK (char_length(address) <= 300),
  notes        text CONSTRAINT suppliers_notes_check CHECK (char_length(notes) <= 500),
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX suppliers_org_name_unique ON suppliers (org_id, lower(name));
CREATE INDEX suppliers_org_idx ON suppliers (org_id, created_at DESC, id DESC);

CREATE TABLE purchase_orders (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  supplier_id  uuid NOT NULL REFERENCES suppliers(id),
  number       integer NOT NULL CONSTRAINT purchase_orders_number_check CHECK (number > 0),
  status       text NOT NULL DEFAULT 'draft' CONSTRAINT purchase_orders_status_check
               CHECK (status IN ('draft', 'ordered', 'partially_received', 'received', 'cancelled')),
  currency     char(3) NOT NULL CONSTRAINT purchase_orders_currency_check CHECK (currency IN ('USD', 'CDF')),
  expected_on  date,
  note         text CONSTRAINT purchase_orders_note_check CHECK (char_length(note) <= 500),
  total_minor  bigint NOT NULL DEFAULT 0 CONSTRAINT purchase_orders_total_check CHECK (total_minor >= 0),
  created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT purchase_orders_org_number_unique UNIQUE (org_id, number)
);
CREATE INDEX purchase_orders_org_idx ON purchase_orders (org_id, created_at DESC, id DESC);
CREATE INDEX purchase_orders_supplier_idx ON purchase_orders (supplier_id);

CREATE TABLE purchase_order_lines (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id             uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  position          integer NOT NULL,
  variant_id        uuid REFERENCES product_variants(id) ON DELETE SET NULL,
  description       text NOT NULL CONSTRAINT purchase_order_lines_description_check CHECK (char_length(description) BETWEEN 1 AND 120),
  quantity_ordered  integer NOT NULL CONSTRAINT purchase_order_lines_ordered_check CHECK (quantity_ordered BETWEEN 1 AND 1000000),
  quantity_received integer NOT NULL DEFAULT 0,
  unit_cost_minor   bigint NOT NULL CONSTRAINT purchase_order_lines_cost_check CHECK (unit_cost_minor BETWEEN 0 AND 1000000000000),
  CONSTRAINT purchase_order_lines_received_check CHECK (quantity_received BETWEEN 0 AND quantity_ordered)
);
CREATE INDEX purchase_order_lines_po_idx ON purchase_order_lines (po_id, position);
CREATE INDEX purchase_order_lines_variant_idx ON purchase_order_lines (variant_id) WHERE variant_id IS NOT NULL;

CREATE TABLE expenses (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  category    text NOT NULL CONSTRAINT expenses_category_check
              CHECK (category IN ('rent', 'salaries', 'transport', 'utilities', 'marketing', 'supplies', 'taxes', 'other')),
  amount_minor bigint NOT NULL CONSTRAINT expenses_amount_check CHECK (amount_minor > 0 AND amount_minor <= 1000000000000),
  currency    char(3) NOT NULL CONSTRAINT expenses_currency_check CHECK (currency IN ('USD', 'CDF')),
  spent_on    date NOT NULL,
  supplier_id uuid REFERENCES suppliers(id),
  note        text CONSTRAINT expenses_note_check CHECK (char_length(note) <= 200),
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX expenses_org_idx ON expenses (org_id, spent_on DESC, id DESC);
CREATE INDEX expenses_supplier_idx ON expenses (supplier_id) WHERE supplier_id IS NOT NULL;
