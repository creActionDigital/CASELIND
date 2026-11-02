-- 0010_stories_moderation: lot 4B stories (24 h), reports and moderation.
-- Forward-only. Never edit an applied migration: add a new one.

CREATE TABLE stories (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id  uuid NOT NULL,
  -- A media belongs to a single story; deleting the media removes the story.
  media_id   uuid NOT NULL UNIQUE REFERENCES media_assets(id) ON DELETE CASCADE,
  caption    text CONSTRAINT stories_caption_check CHECK (caption IS NULL OR char_length(caption) <= 500),
  visibility text NOT NULL DEFAULT 'followers'
               CONSTRAINT stories_visibility_check CHECK (visibility IN ('followers', 'friends')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  -- Set by moderation: hidden for everyone except the author.
  hidden_at  timestamptz,
  CONSTRAINT stories_expiry_check CHECK (expires_at > created_at),
  CONSTRAINT stories_author_client_unique UNIQUE (author_id, client_id)
);
CREATE INDEX stories_author_active_idx ON stories (author_id, expires_at DESC, created_at DESC);
CREATE INDEX stories_expires_idx ON stories (expires_at);

CREATE TABLE story_views (
  story_id  uuid NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  viewer_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  viewed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (story_id, viewer_id)
);
CREATE INDEX story_views_story_idx ON story_views (story_id, viewed_at DESC, viewer_id DESC);
CREATE INDEX story_views_viewer_idx ON story_views (viewer_id);

CREATE TABLE reports (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Null once the reporter's account is purged (the report is kept, anonymised).
  reporter_id uuid REFERENCES users(id) ON DELETE SET NULL,
  target_type text NOT NULL
                CONSTRAINT reports_target_type_check CHECK (target_type IN ('user', 'post', 'comment', 'story', 'message')),
  target_id   uuid NOT NULL,
  reason      text NOT NULL
                CONSTRAINT reports_reason_check CHECK (reason IN ('spam', 'harassment', 'hate', 'violence', 'nudity', 'scam', 'illegal', 'other')),
  details     text CONSTRAINT reports_details_check CHECK (details IS NULL OR char_length(details) <= 1000),
  status      text NOT NULL DEFAULT 'open' CONSTRAINT reports_status_check CHECK (status IN ('open', 'resolved')),
  resolution  text CONSTRAINT reports_resolution_check CHECK (resolution IS NULL OR resolution IN ('hide', 'restore', 'dismiss')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT reports_resolved_check CHECK ((status = 'open') = (resolved_at IS NULL))
);
-- One open report per (reporter, target).
CREATE UNIQUE INDEX reports_open_unique ON reports (reporter_id, target_type, target_id) WHERE status = 'open';
CREATE INDEX reports_target_idx ON reports (target_type, target_id, status);
CREATE INDEX reports_status_created_idx ON reports (status, created_at DESC);
CREATE INDEX reports_reporter_idx ON reports (reporter_id, created_at DESC);
