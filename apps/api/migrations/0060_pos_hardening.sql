-- 0060_pos_hardening: caisse (revue du lot 16c). Mouvement de stock 'pos_sale' et empreinte de la requete pour l'idempotence. Forward-only.
ALTER TABLE stock_movements DROP CONSTRAINT stock_movements_reason_check;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_reason_check
  CHECK (reason IN ('initial', 'restock', 'adjustment', 'damage', 'order_reserved', 'order_released', 'pos_sale'));
ALTER TABLE pos_sales ADD COLUMN request_hash text;
