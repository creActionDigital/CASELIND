-- 0025_communities: lot 14 public communities = a group conversation that its owner publishes.
-- Forward-only. A private group has no row here. Members, roles, messages stay in conversations.
CREATE TABLE communities (
  conversation_id uuid PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
  description     text NOT NULL DEFAULT '' CHECK (char_length(description) <= 500),
  tags            text[] NOT NULL DEFAULT '{}' CHECK (cardinality(tags) <= 5),
  published_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX communities_tags_idx ON communities USING gin (tags);

-- Someone removed by an owner or admin cannot rejoin through the public listing (a re-add by an
-- admin is still possible and clears the ban).
CREATE TABLE community_bans (
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);
