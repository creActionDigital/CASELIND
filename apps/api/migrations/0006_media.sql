-- 0006_media: lot 2b media uploads (CDC §6 attachments, §28 object storage, §29 dangerous uploads).
-- Forward-only. Never edit an applied migration: add a new one.

-- One row per uploaded (or announced) file. The bytes live in object storage under storage_key;
-- the database only holds metadata. `mime` is the type detected from the file's magic bytes, never
-- the one claimed by the client (declared_mime), and is NULL until the content has been received.
--   pending  : announced by POST /v1/media/uploads, content not received yet (purged after 24 h)
--   ready    : content received, type and size checked, stored
--   rejected : content refused (unsupported type, type mismatch, too large); nothing is stored
CREATE TABLE media_assets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose         text NOT NULL
                    CONSTRAINT media_assets_purpose_check
                    CHECK (purpose IN ('avatar', 'post', 'message', 'story', 'org_logo', 'org_banner', 'product', 'document')),
  declared_mime   text NOT NULL,
  mime            text,
  size_bytes      bigint NOT NULL CHECK (size_bytes >= 0),
  sha256          text CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  status          text NOT NULL DEFAULT 'pending'
                    CONSTRAINT media_assets_status_check
                    CHECK (status IN ('pending', 'ready', 'rejected')),
  storage_key     text NOT NULL UNIQUE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  uploaded_at     timestamptz,
  rejected_reason text,
  -- A ready asset always has its detected type, checksum and upload time.
  CONSTRAINT media_assets_ready_complete
    CHECK (status <> 'ready' OR (mime IS NOT NULL AND sha256 IS NOT NULL AND uploaded_at IS NOT NULL))
);

-- "My uploads, newest first" and the per-owner cascade on account deletion.
CREATE INDEX media_assets_owner_created_idx ON media_assets (owner_user_id, created_at);
-- Lets the hourly maintenance find stale unfinished uploads without scanning ready assets.
CREATE INDEX media_assets_unfinished_idx ON media_assets (created_at) WHERE status <> 'ready';
