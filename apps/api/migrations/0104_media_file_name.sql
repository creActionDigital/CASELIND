-- 0104_media_file_name: nom d'origine nettoye des documents envoyes en messagerie. Forward-only.
ALTER TABLE media_assets ADD COLUMN file_name text;
