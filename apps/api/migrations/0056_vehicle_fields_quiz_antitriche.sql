-- 0056: lot 15e structured vehicle fields on listings, lot 20c quiz anti-cheat flag. Forward-only.
ALTER TABLE listings
  ADD COLUMN make text CONSTRAINT listings_make_check CHECK (make IS NULL OR length(make) BETWEEN 1 AND 40),
  ADD COLUMN model text CONSTRAINT listings_model_check CHECK (model IS NULL OR length(model) BETWEEN 1 AND 40),
  ADD COLUMN year integer CONSTRAINT listings_year_check CHECK (year IS NULL OR year BETWEEN 1950 AND 2200),
  ADD COLUMN mileage_km integer CONSTRAINT listings_mileage_check CHECK (mileage_km IS NULL OR mileage_km BETWEEN 0 AND 2000000),
  ADD COLUMN fuel text CONSTRAINT listings_fuel_check CHECK (fuel IS NULL OR fuel IN ('petrol', 'diesel', 'hybrid', 'electric', 'other')),
  ADD COLUMN transmission text CONSTRAINT listings_transmission_check CHECK (transmission IS NULL OR transmission IN ('manual', 'automatic')),
  ADD CONSTRAINT listings_vehicle_only_check CHECK (kind = 'vehicle' OR (make IS NULL AND model IS NULL AND year IS NULL AND mileage_km IS NULL AND fuel IS NULL AND transmission IS NULL));

ALTER TABLE game_sessions ADD COLUMN suspicious boolean NOT NULL DEFAULT false;
CREATE INDEX game_sessions_suspicious_idx ON game_sessions (user_id, started_at) WHERE suspicious;
