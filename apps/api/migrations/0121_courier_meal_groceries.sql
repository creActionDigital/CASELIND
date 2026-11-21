-- 0121_courier_meal_groceries: le coursier livre aussi un repas ou des courses (sans taille, comme un document). Forward-only.
ALTER TABLE courier_requests DROP CONSTRAINT courier_requests_kind_check;
ALTER TABLE courier_requests ADD CONSTRAINT courier_requests_kind_check CHECK (kind IN ('parcel', 'document', 'meal', 'groceries'));
