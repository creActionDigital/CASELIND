-- 0036_business_documents: lot 16c quotes (devis) and invoices (factures) of an organisation (CDC §14). Forward-only.
-- A record for the seller and the customer: no payment is taken here. Totals are computed on the server.
CREATE TABLE business_documents (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  kind             text NOT NULL CONSTRAINT business_documents_kind_check CHECK (kind IN ('quote', 'invoice')),
  number           text NOT NULL,
  customer_name    text NOT NULL CONSTRAINT business_documents_customer_check CHECK (length(customer_name) BETWEEN 1 AND 120),
  customer_contact text NOT NULL DEFAULT '' CONSTRAINT business_documents_contact_check CHECK (length(customer_contact) <= 120),
  currency         char(3) NOT NULL,
  lines            jsonb NOT NULL CONSTRAINT business_documents_lines_check CHECK (jsonb_typeof(lines) = 'array' AND jsonb_array_length(lines) BETWEEN 1 AND 50),
  total_minor      bigint NOT NULL CONSTRAINT business_documents_total_check CHECK (total_minor >= 0),
  status           text NOT NULL DEFAULT 'draft' CONSTRAINT business_documents_status_check CHECK (status IN ('draft', 'sent', 'accepted', 'paid', 'cancelled')),
  source_quote_id  uuid REFERENCES business_documents(id),
  created_by       uuid NOT NULL REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT business_documents_number_unique UNIQUE (org_id, number)
);
CREATE INDEX business_documents_org_idx ON business_documents (org_id, created_at DESC, id DESC);
-- A quote becomes at most one invoice.
CREATE UNIQUE INDEX business_documents_source_unique ON business_documents (source_quote_id) WHERE source_quote_id IS NOT NULL;
CREATE TRIGGER business_documents_set_updated_at BEFORE UPDATE ON business_documents FOR EACH ROW EXECUTE FUNCTION set_updated_at();
