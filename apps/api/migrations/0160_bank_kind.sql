-- Maps: banks and cash machines become a place kind of their own (owner request, 2026-11-21).
ALTER TABLE organizations DROP CONSTRAINT organizations_kind_check;
ALTER TABLE organizations ADD CONSTRAINT organizations_kind_check
  CHECK (kind IN ('shop', 'restaurant', 'hotel', 'pharmacy', 'fuel_station', 'school',
                  'hospital', 'services', 'warehouse', 'bank', 'other'));
