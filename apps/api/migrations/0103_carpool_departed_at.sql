-- 0103_carpool_departed_at: instant ou le conducteur a marque le depart (delai minimal avant de terminer le trajet). Forward-only.
ALTER TABLE carpool_trips ADD COLUMN departed_at timestamptz;
