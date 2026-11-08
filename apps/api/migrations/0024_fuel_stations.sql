-- Maps (owner request, 2026-11-08): fuel stations are a place kind of their own, next to shops,
-- restaurants and pharmacies, so drivers can find the nearest one.
-- The 0005 CHECK was unnamed: PostgreSQL named it organizations_kind_check.
ALTER TABLE organizations DROP CONSTRAINT organizations_kind_check;
ALTER TABLE organizations ADD CONSTRAINT organizations_kind_check
  CHECK (kind IN ('shop', 'restaurant', 'hotel', 'pharmacy', 'fuel_station', 'school',
                  'hospital', 'services', 'warehouse', 'other'));
