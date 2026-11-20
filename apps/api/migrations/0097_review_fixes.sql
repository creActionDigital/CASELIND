-- 0097_review_fixes: constats de la relecture de correction (lots 0071-0087). Forward-only.
-- Le webhook « order.return_requested » existait dans le contrat mais la contrainte de 0069 le refusait (500 a la souscription).
ALTER TABLE org_webhooks DROP CONSTRAINT org_webhooks_events_check;
ALTER TABLE org_webhooks ADD CONSTRAINT org_webhooks_events_check CHECK (
  cardinality(events) BETWEEN 1 AND 10
  AND events <@ ARRAY['order.created', 'order.status_changed', 'pos.sale_created', 'pos.sale_voided', 'org.question_asked', 'order.return_requested']::text[]);
-- Index manquants : expiration des actions IA, retours par commande, alertes de peremption (toutes organisations), suggestions de hashtags (prefixe).
CREATE INDEX ai_actions_user_expiry_idx ON ai_actions (user_id, expires_at) WHERE status = 'proposed';
CREATE INDEX order_returns_order_idx ON order_returns (order_id);
CREATE INDEX stock_batches_expiry_idx ON stock_batches (expires_on) WHERE quantity_remaining > 0 AND expires_on IS NOT NULL;
CREATE INDEX post_hashtags_tag_prefix_idx ON post_hashtags (tag text_pattern_ops);
