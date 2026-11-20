-- 0072: a returned item put back on the shelf gets its own stock movement label.
ALTER TABLE stock_movements DROP CONSTRAINT stock_movements_reason_check;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_reason_check
  CHECK (reason IN ('initial', 'restock', 'adjustment', 'damage', 'order_reserved', 'order_released', 'pos_sale', 'pos_void', 'return_restocked'));
