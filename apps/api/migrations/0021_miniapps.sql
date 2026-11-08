-- 0021_miniapps: lot 10 mini-app platform (developer apps, OAuth 2.0 code + PKCE, grants, sandbox payment requests). Forward-only.
-- Tokens, codes and the client secret are only ever stored as SHA-256 hashes (they are high-entropy random values).

INSERT INTO feature_flags (key, description, enabled, regulated) VALUES
  ('miniapps', 'Plateforme de mini-applications : applications développeur, OAuth 2.0 PKCE, autorisations', true, false);

CREATE TABLE miniapps (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL REFERENCES organizations(id),
  created_by         uuid REFERENCES users(id),
  name               text NOT NULL CONSTRAINT miniapps_name_check CHECK (char_length(name) BETWEEN 2 AND 60),
  description        text CONSTRAINT miniapps_description_check CHECK (description IS NULL OR char_length(description) <= 500),
  icon_media_id      uuid REFERENCES media_assets(id) ON DELETE SET NULL,
  launch_url         text NOT NULL CONSTRAINT miniapps_launch_url_check CHECK (launch_url ~ '^https://'),
  redirect_uris      text[] NOT NULL CONSTRAINT miniapps_redirects_check CHECK (cardinality(redirect_uris) BETWEEN 1 AND 10),
  scopes             text[] NOT NULL DEFAULT '{}'
                       CONSTRAINT miniapps_scopes_check CHECK (scopes <@ ARRAY['profile.basic', 'profile.phone', 'profile.email', 'orders.read', 'wallet.pay']),
  confidential       boolean NOT NULL DEFAULT true,
  client_id          text NOT NULL CONSTRAINT miniapps_client_id_unique UNIQUE,
  client_secret_hash text,
  status             text NOT NULL DEFAULT 'draft'
                       CONSTRAINT miniapps_status_check CHECK (status IN ('draft', 'in_review', 'published', 'rejected', 'suspended')),
  review_note        text,
  reviewed_by        uuid REFERENCES users(id),
  reviewed_at        timestamptz,
  published_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT miniapps_secret_check CHECK (confidential = (client_secret_hash IS NOT NULL))
);
CREATE INDEX miniapps_org_idx ON miniapps (org_id, created_at DESC, id DESC);
CREATE INDEX miniapps_status_idx ON miniapps (status, created_at DESC, id DESC);
CREATE TRIGGER miniapps_set_updated_at BEFORE UPDATE ON miniapps FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- What the user agreed to, per app. Revoking sets revoked_at (and kills the tokens); consenting again clears it.
CREATE TABLE miniapp_grants (
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  app_id     uuid NOT NULL REFERENCES miniapps(id) ON DELETE CASCADE,
  scopes     text[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  PRIMARY KEY (user_id, app_id)
);

-- Authorization codes: 60 s, single use, bound to user, app, redirect and PKCE challenge.
CREATE TABLE miniapp_auth_codes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash      text NOT NULL CONSTRAINT miniapp_auth_codes_hash_unique UNIQUE,
  app_id         uuid NOT NULL REFERENCES miniapps(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  redirect_uri   text NOT NULL,
  scopes         text[] NOT NULL,
  code_challenge text NOT NULL,
  expires_at     timestamptz NOT NULL,
  used_at        timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX miniapp_auth_codes_expiry_idx ON miniapp_auth_codes (expires_at);

-- One row per access/refresh pair. `family_id` is the code the chain started from: replaying the code or a used refresh revokes the family.
CREATE TABLE miniapp_tokens (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id          uuid NOT NULL REFERENCES miniapp_auth_codes(id) ON DELETE CASCADE,
  app_id             uuid NOT NULL REFERENCES miniapps(id) ON DELETE CASCADE,
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scopes             text[] NOT NULL,
  access_hash        text NOT NULL CONSTRAINT miniapp_tokens_access_unique UNIQUE,
  access_expires_at  timestamptz NOT NULL,
  refresh_hash       text NOT NULL CONSTRAINT miniapp_tokens_refresh_unique UNIQUE,
  refresh_expires_at timestamptz NOT NULL,
  refresh_used_at    timestamptz,
  revoked_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX miniapp_tokens_user_app_idx ON miniapp_tokens (user_id, app_id);
CREATE INDEX miniapp_tokens_family_idx ON miniapp_tokens (family_id);

-- Sandbox payment requests opened by an app; only the user's PIN confirmation moves money (ADR-021).
CREATE TABLE miniapp_payment_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id        uuid NOT NULL REFERENCES miniapps(id),
  org_id        uuid NOT NULL REFERENCES organizations(id),
  user_id       uuid NOT NULL REFERENCES users(id),
  client_ref    text NOT NULL CONSTRAINT miniapp_payment_requests_ref_check CHECK (char_length(client_ref) BETWEEN 1 AND 64),
  amount_minor  bigint NOT NULL CONSTRAINT miniapp_payment_requests_amount_check CHECK (amount_minor > 0),
  currency      char(3) NOT NULL,
  description   text CONSTRAINT miniapp_payment_requests_desc_check CHECK (description IS NULL OR char_length(description) <= 200),
  status        text NOT NULL DEFAULT 'pending'
                  CONSTRAINT miniapp_payment_requests_status_check CHECK (status IN ('pending', 'paid', 'declined', 'cancelled', 'expired')),
  expires_at    timestamptz NOT NULL,
  transfer_id   uuid,
  decided_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT miniapp_payment_requests_ref_unique UNIQUE (app_id, client_ref)
);
CREATE INDEX miniapp_payment_requests_user_idx ON miniapp_payment_requests (user_id, created_at DESC, id DESC);
