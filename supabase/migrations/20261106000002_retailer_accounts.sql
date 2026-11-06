-- Rollout phase 3, step 1 (docs/adr/0005): where linked retailer accounts live.
--
-- One row per (household, retailer): docs/adr/0006 — a household links at most one
-- account per retailer. Only 'ah' is used until rollout phase 6 has run cleanly;
-- other retailer codes need no schema change, only a new adapter (docs/adr/0004).
--
-- The refresh token is stored only in envelope-encrypted form (docs/adr/0003,
-- supabase/functions/_shared/tokenCrypto.ts):
--   token_ciphertext / token_iv       refresh token, encrypted with the account's data key
--   wrapped_key / wrapped_key_iv      data key, encrypted with master key RETAILER_TOKEN_KEY_V<key_version>
-- The master key never touches the database, so a dump of this table opens nothing.
-- Access tokens are never stored: the adapter refreshes, uses the access token in
-- memory for that one request, and saves only the rotated refresh token.
--
-- Access: lives in the private schema, which the API does not expose (docs/adr/0002).
-- RLS on, no policies, no grants to anon/authenticated. Only the AH adapter Edge
-- Function reaches it, through a direct Postgres connection. A safe "is AH linked?"
-- function for the Settings screen comes with that screen.
--
-- Erasure: deleting the household deletes its rows (CASCADE), and with them the only
-- copy of each data key. Unlinking deletes the row the same way.
--
-- This migration stores nothing: rows are only written when a household links AH,
-- which needs the adapter, the Settings screen and the privacy policy section first.

CREATE TABLE private.retailer_accounts (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),  -- bound into the encryption as associated data
  household_id     uuid        NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  retailer         text        NOT NULL CHECK (retailer ~ '^[a-z][a-z0-9_]{1,19}$'),  -- e.g. 'ah'
  status           text        NOT NULL DEFAULT 'linked' CHECK (status IN ('linked', 'relink_needed')),
  token_ciphertext bytea       NOT NULL CHECK (octet_length(token_ciphertext) BETWEEN 17 AND 8192),  -- GCM tag is 16 bytes
  token_iv         bytea       NOT NULL CHECK (octet_length(token_iv) = 12),
  wrapped_key      bytea       NOT NULL CHECK (octet_length(wrapped_key) = 48),  -- 32-byte data key + 16-byte tag
  wrapped_key_iv   bytea       NOT NULL CHECK (octet_length(wrapped_key_iv) = 12),
  key_version      smallint    NOT NULL CHECK (key_version BETWEEN 1 AND 9),
  token_version    integer     NOT NULL DEFAULT 1 CHECK (token_version >= 1),  -- +1 on every refresh (ADR 0003 single-flight)
  linked_by        uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  linked_at        timestamptz NOT NULL DEFAULT now(),
  last_refresh_at  timestamptz,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT retailer_accounts_one_per_retailer UNIQUE (household_id, retailer)
);

ALTER TABLE private.retailer_accounts ENABLE ROW LEVEL SECURITY;
-- Belt and braces: the private schema's default privileges already exclude these roles.
REVOKE ALL ON private.retailer_accounts FROM PUBLIC, anon, authenticated;

-- Rollback (run manually, then `supabase migration repair --status reverted 20261106000002`).
-- Safe while no household has linked AH; afterwards it deletes every link:
-- DROP TABLE private.retailer_accounts;
