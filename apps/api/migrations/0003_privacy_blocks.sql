-- 0003_privacy_blocks: lot 1b privacy settings on users and user-to-user blocks.
-- Forward-only. Never edit an applied migration: add a new one.

-- Privacy settings (cartography A-10, A-11). Discoverability is opt-in: nobody can find
-- a user by phone number or e-mail address unless they switched it on.
ALTER TABLE users
  ADD COLUMN discoverable_by_phone  boolean NOT NULL DEFAULT false,
  ADD COLUMN discoverable_by_email  boolean NOT NULL DEFAULT false,
  ADD COLUMN contact_requests_from  text NOT NULL DEFAULT 'everyone'
    CONSTRAINT users_contact_requests_from_check
    CHECK (contact_requests_from IN ('everyone', 'contacts_of_contacts', 'nobody')),
  ADD COLUMN read_receipts          boolean NOT NULL DEFAULT true;

-- A block is one-directional in storage but symmetric in effect: when either user blocked
-- the other, neither can see the other's profile (and, later, message them).
CREATE TABLE user_blocks (
  blocker_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CONSTRAINT user_blocks_not_self CHECK (blocker_id <> blocked_id)
);
-- The PK covers lookups by blocker; this one covers "who blocked me" (the reverse direction).
CREATE INDEX user_blocks_blocked_idx ON user_blocks (blocked_id);
