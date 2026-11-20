-- 0080_message_translations: cache des traductions automatiques de messages (CDC section 6). Forward-only.
-- Une traduction par (message, langue), partagee entre les membres qui y ont droit ; supprimee avec le message
-- (cascade) et explicitement quand le message est rappele, expire ou que son auteur supprime son compte.
CREATE TABLE message_translations (
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  locale     text NOT NULL CONSTRAINT message_translations_locale_check CHECK (locale IN ('fr', 'en', 'sw')),
  text       text NOT NULL CONSTRAINT message_translations_text_check CHECK (char_length(text) BETWEEN 1 AND 8000),
  provider   text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, locale)
);
