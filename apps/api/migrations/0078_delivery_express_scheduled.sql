-- 0078_delivery_express_scheduled: express and scheduled delivery of orders (cahier 9).
-- Forward-only. Nothing changes for existing rows: 'standard', no slot, express not offered.
-- The express supplement is priced by the seller zone, per currency like `fees` (null = express not offered
-- in this zone), computed by the server at checkout and frozen in orders.delivery_fee_minor.
ALTER TABLE deliveries ADD COLUMN speed text NOT NULL DEFAULT 'standard'
  CONSTRAINT deliveries_speed_check CHECK (speed IN ('standard', 'express'));
-- Slot asked by the buyer (2 hours to 7 days ahead at checkout); the courier sees it 60 minutes before.
ALTER TABLE deliveries ADD COLUMN scheduled_for timestamptz;
ALTER TABLE delivery_zones ADD COLUMN express_fees jsonb
  CONSTRAINT delivery_zones_express_fees_check CHECK (express_fees IS NULL OR (jsonb_typeof(express_fees) = 'object' AND express_fees <> '{}'::jsonb));
