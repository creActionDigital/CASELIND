-- 0151_voice_duration: durée (secondes) d'un message vocal. Forward-only.
ALTER TABLE media_assets ADD COLUMN duration_sec integer CONSTRAINT media_assets_duration_check CHECK (duration_sec IS NULL OR duration_sec BETWEEN 1 AND 300);
