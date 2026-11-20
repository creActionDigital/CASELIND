-- 0086_creator_tools: favoris de publications, hashtags et statistiques de portee (sans identite des spectateurs). Forward-only.

CREATE TABLE post_bookmarks (
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id    uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, post_id)
);
CREATE INDEX post_bookmarks_user_idx ON post_bookmarks (user_id, created_at DESC, post_id DESC);

CREATE TABLE post_hashtags (
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  tag     text NOT NULL CONSTRAINT post_hashtags_tag_check CHECK (char_length(tag) BETWEEN 1 AND 40 AND tag = lower(tag)),
  PRIMARY KEY (post_id, tag)
);
CREATE INDEX post_hashtags_tag_idx ON post_hashtags (tag, post_id);

-- Remplissage des publications existantes (lettres latines accentuees, chiffres, _ ; 10 tags au plus par publication).
INSERT INTO post_hashtags (post_id, tag)
SELECT post_id, tag FROM (
  SELECT post_id, tag, row_number() OVER (PARTITION BY post_id ORDER BY pos) AS rn FROM (
    SELECT p.id AS post_id, lower(m[1]) AS tag, min(ord) AS pos
    FROM posts p,
         LATERAL regexp_matches(p.body, '(?:^|[^a-zA-Z0-9_À-ɏ/&#])#([a-zA-Z0-9_À-ɏ]{1,40})(?![a-zA-Z0-9_À-ɏ#])', 'g') WITH ORDINALITY AS t(m, ord)
    WHERE p.body IS NOT NULL AND p.deleted_at IS NULL AND m[1] ~ '[a-zA-ZÀ-ɏ]'
    GROUP BY p.id, lower(m[1])
  ) d
) r WHERE rn <= 10
ON CONFLICT DO NOTHING;

-- Impressions agregees par publication et par jour (UTC). Aucune identite : les spectateurs ne sont comptes
-- que par un empreinte tronquee, par publication et par jour, conservee 8 jours.
CREATE TABLE post_impressions (
  post_id        uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  day            date NOT NULL,
  impressions    integer NOT NULL DEFAULT 0 CONSTRAINT post_impressions_n_check CHECK (impressions >= 0),
  unique_viewers integer NOT NULL DEFAULT 0 CONSTRAINT post_impressions_u_check CHECK (unique_viewers >= 0),
  PRIMARY KEY (post_id, day)
);
CREATE INDEX post_impressions_day_idx ON post_impressions (day);

CREATE TABLE post_impression_viewers (
  post_id     uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  day         date NOT NULL,
  viewer_hash bytea NOT NULL CONSTRAINT post_impression_viewers_hash_check CHECK (octet_length(viewer_hash) = 8),
  PRIMARY KEY (post_id, day, viewer_hash)
);
CREATE INDEX post_impression_viewers_day_idx ON post_impression_viewers (day);
