-- 0037_documents_reissue: a cancelled invoice must not block a new invoice from the same quote (found in code review). Forward-only.
DROP INDEX business_documents_source_unique;
CREATE UNIQUE INDEX business_documents_source_unique ON business_documents (source_quote_id) WHERE source_quote_id IS NOT NULL AND status <> 'cancelled';
