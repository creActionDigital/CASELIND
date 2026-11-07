-- Lot 6B: KYC tiers (manual admin review), payment PIN, signed merchant QR codes. Sandbox only (ADR-017).

-- New media purpose: identity documents. Readable by the owner and admins only (src/media/access.ts).
ALTER TABLE media_assets DROP CONSTRAINT media_assets_purpose_check;
ALTER TABLE media_assets ADD CONSTRAINT media_assets_purpose_check
  CHECK (purpose IN ('avatar', 'post', 'message', 'story', 'org_logo', 'org_banner', 'product', 'document', 'kyc_document'));

-- Current KYC tier of a user (absent row = tier 0).
CREATE TABLE kyc_profiles (
  user_id     uuid PRIMARY KEY REFERENCES users (id),
  level       smallint NOT NULL DEFAULT 0 CHECK (level BETWEEN 0 AND 2),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE kyc_submissions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users (id),
  level            smallint NOT NULL CHECK (level IN (1, 2)),
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  -- Declared identity (level 1 only). The document number is AES-256-GCM encrypted; only its last 4 characters are readable.
  legal_name       text,
  birth_date       date,
  id_type          text CHECK (id_type IN ('national_id', 'passport', 'driver_license', 'voter_card')),
  id_number_enc    text,
  id_number_last4  text,
  city             text,
  -- Media ids (purpose kyc_document). Level 1: [identity document, selfie]. Level 2: [proof of address].
  document_ids     uuid[] NOT NULL,
  decided_by       uuid REFERENCES users (id),
  decided_at       timestamptz,
  decision_reason  text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'pending') = (decided_at IS NULL))
);
-- One pending request per user.
CREATE UNIQUE INDEX kyc_submissions_one_pending ON kyc_submissions (user_id) WHERE status = 'pending';
CREATE INDEX kyc_submissions_user_idx ON kyc_submissions (user_id, created_at DESC);
CREATE INDEX kyc_submissions_status_idx ON kyc_submissions (status, created_at, id);

-- Payment PIN (Argon2id) with its brute-force counter.
CREATE TABLE payment_pins (
  user_id       uuid PRIMARY KEY REFERENCES users (id),
  pin_hash      text NOT NULL,
  failed_count  integer NOT NULL DEFAULT 0,
  locked_until  timestamptz,
  set_at        timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Merchant payment QR codes. The payload is signed (HMAC); this row holds the revocable state.
CREATE TABLE payment_qr_codes (
  id                    uuid PRIMARY KEY,
  org_id                uuid NOT NULL REFERENCES organizations (id),
  created_by            uuid NOT NULL REFERENCES users (id),
  amount_minor          bigint CHECK (amount_minor > 0),
  currency              text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  label                 text,
  expires_at            timestamptz,
  single_use            boolean NOT NULL DEFAULT false,
  revoked_at            timestamptz,
  consumed_at           timestamptz,
  consumed_by           uuid,
  consumed_client_id    uuid,
  consumed_transfer_id  uuid,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT single_use OR amount_minor IS NOT NULL)
);
CREATE INDEX payment_qr_codes_org_idx ON payment_qr_codes (org_id, created_at DESC, id);
