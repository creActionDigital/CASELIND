-- 0005_organizations: lot 2a businesses / establishments, their members and per-org roles.
-- Forward-only. Never edit an applied migration: add a new one.

-- One row per business or establishment (shop, restaurant, hotel, school...). `kind` only
-- picks defaults and wording on clients: nothing server-side is hard-coded to one kind (CDC §8).
-- logo_url / banner_url are set through the media module, never directly by a PATCH.
CREATE TABLE organizations (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Public URL segment (caselind.com/@slug, slug.caselind.com). citext: unique regardless of
  -- case; the CHECK casts to text so the pattern itself stays case-sensitive (lowercase only).
  slug                 citext NOT NULL UNIQUE
                         CHECK (slug::text ~ '^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$'),
  name                 text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  kind                 text NOT NULL CHECK (kind IN ('shop', 'restaurant', 'hotel', 'pharmacy', 'school',
                                                     'hospital', 'services', 'warehouse', 'other')),
  description          text CHECK (char_length(description) <= 2000),
  logo_url             text,
  banner_url           text,
  country              char(2) CHECK (country ~ '^[A-Z]{2}$'),
  city                 text CHECK (char_length(city) <= 120),
  address              text CHECK (char_length(address) <= 300),
  phone                text CHECK (phone ~ '^\+[1-9][0-9]{6,14}$'),
  email                citext CHECK (char_length(email) <= 254),
  website              text CHECK (website ~ '^https://' AND char_length(website) <= 500),
  -- Shape validated by the API contract (openingHoursSchema): {mon..sun: [{open, close}]}.
  opening_hours        jsonb CHECK (opening_hours IS NULL OR jsonb_typeof(opening_hours) = 'object'),
  -- private: no storefront page; the org exists only for its members.
  visibility           text NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'private')),
  -- suspended: set by platform moderation; the storefront disappears and members are read-only.
  status               text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  verification_status  text NOT NULL DEFAULT 'unverified'
                         CHECK (verification_status IN ('unverified', 'pending', 'verified')),
  created_by           uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER organizations_set_updated_at
  BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Membership with a per-org role. 'invited' rows are pending invitations: they grant nothing
-- until the invitee accepts. The "at least one active owner" rule is enforced by the API in a
-- transaction that locks the organizations row (OrgMembersService), not by a constraint.
CREATE TABLE org_members (
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        text NOT NULL CHECK (role IN ('owner', 'admin', 'manager', 'finance', 'stock', 'sales',
                                            'hr', 'support', 'delivery', 'employee')),
  status      text NOT NULL CHECK (status IN ('invited', 'active')),
  invited_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  joined_at   timestamptz,
  PRIMARY KEY (org_id, user_id),
  CONSTRAINT org_members_joined_iff_active CHECK ((status = 'active') = (joined_at IS NOT NULL))
);
-- GET /me/orgs and the per-user owner quota.
CREATE INDEX org_members_user_idx ON org_members (user_id, created_at DESC);
-- Members list keyset pagination (created_at, user_id).
CREATE INDEX org_members_org_page_idx ON org_members (org_id, created_at, user_id);
-- Last-owner checks count these rows.
CREATE INDEX org_members_active_owners_idx ON org_members (org_id) WHERE role = 'owner' AND status = 'active';
