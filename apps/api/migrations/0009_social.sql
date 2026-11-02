-- 0009_social: lot 4A follows, posts, reactions and comments.
-- Forward-only. Never edit an applied migration: add a new one.

INSERT INTO feature_flags (key, description, enabled, regulated) VALUES
  ('social', 'Réseau social : abonnements, publications, fil, réactions, commentaires', true, false);

-- "Friends" are users who follow each other. No separate table.
CREATE TABLE follows (
  follower_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followee_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, followee_id),
  CONSTRAINT follows_not_self_check CHECK (follower_id <> followee_id)
);
-- "Who follows X" (newest first) and the reverse lookup used by feeds.
CREATE INDEX follows_followee_idx ON follows (followee_id, created_at DESC, follower_id DESC);
CREATE INDEX follows_follower_idx ON follows (follower_id, created_at DESC, followee_id DESC);

CREATE TABLE posts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id  uuid NOT NULL,
  kind       text NOT NULL CONSTRAINT posts_kind_check CHECK (kind IN ('text', 'media', 'video')),
  body       text CONSTRAINT posts_body_check CHECK (body IS NULL OR char_length(body) BETWEEN 1 AND 5000),
  visibility text NOT NULL
               CONSTRAINT posts_visibility_check CHECK (visibility IN ('public', 'followers', 'friends', 'private')),
  -- Hidden by moderation (reversible); deleted_at is the author's soft delete.
  hidden     boolean NOT NULL DEFAULT false,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT posts_author_client_unique UNIQUE (author_id, client_id),
  CONSTRAINT posts_content_check CHECK (kind <> 'text' OR body IS NOT NULL)
);
CREATE INDEX posts_author_created_idx ON posts (author_id, created_at DESC, id DESC) WHERE deleted_at IS NULL;
CREATE INDEX posts_videos_idx ON posts (created_at DESC, id DESC)
  WHERE kind = 'video' AND visibility = 'public' AND deleted_at IS NULL AND NOT hidden;

-- A media belongs to at most one post. Media rows of purged accounts cascade away.
CREATE TABLE post_media (
  post_id  uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  media_id uuid NOT NULL UNIQUE REFERENCES media_assets(id) ON DELETE CASCADE,
  position smallint NOT NULL CONSTRAINT post_media_position_check CHECK (position BETWEEN 0 AND 9),
  PRIMARY KEY (post_id, position)
);

CREATE TABLE post_reactions (
  post_id    uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       text NOT NULL
               CONSTRAINT post_reactions_type_check CHECK (type IN ('like', 'love', 'haha', 'wow', 'sad', 'angry')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);
CREATE INDEX post_reactions_user_idx ON post_reactions (user_id);

CREATE TABLE post_comments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id     uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  author_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reply_to_id uuid REFERENCES post_comments(id) ON DELETE CASCADE,
  body        text NOT NULL CONSTRAINT post_comments_body_check CHECK (char_length(body) BETWEEN 1 AND 2000),
  hidden      boolean NOT NULL DEFAULT false,
  deleted_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX post_comments_post_idx ON post_comments (post_id, created_at, id) WHERE deleted_at IS NULL;
CREATE INDEX post_comments_author_idx ON post_comments (author_id, created_at DESC);
