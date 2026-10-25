# 0003. Retailer tokens: single-flight refresh and envelope encryption

- Status: Accepted
- Date: 2026-10-24 (storage revised 2026-10-25 after review)
- Deciders: Chris, David

## Context

The AH API spike showed:

- Access tokens last 7 days.
- **The refresh token rotates on every refresh.** The old one stops working.

Two refreshes running at the same time (the weekly run plus a manual "send now") would leave one process holding a dead token and lock the household out until someone re-links by hand.

A refresh token opens a real AH account: address, purchase history and shopping list. It is the most sensitive data in the system. Anything stored only as database data, including Supabase Vault secrets, can be read by whoever holds a database dump or the service role key.

## Decision

### Single-flight refresh

1. Lock the account row (`SELECT … FOR UPDATE` on `private.retailer_accounts`).
2. If the access token is still valid for more than 10 minutes, use it and release.
3. Otherwise refresh, write the new encrypted refresh token and increment `token_version` **before** using the new access token, then commit.
4. On refresh failure, set `status = 'relink_needed'`, write an audit event and send a re-link push.

### Envelope encryption

Two layers of keys:

- **Data key:** 32 random bytes, one per retailer account, generated when the account is linked. It encrypts that account's refresh token.
- **Master key:** one per Supabase project (preview and production differ). It encrypts ("wraps") every data key. It never touches the database.

Stored in `private.retailer_accounts` (bytea columns):

| Column | Contents |
|---|---|
| `token_ciphertext`, `token_iv` | Refresh token encrypted with the data key |
| `wrapped_key`, `wrapped_key_iv` | Data key encrypted with the master key |
| `key_version` | Which master key wrapped the data key |

Details:

- AES-256-GCM for both layers via Web Crypto (`crypto.subtle`), built into Deno. No extra library.
- A fresh random 12-byte IV for every encryption.
- The account id is passed as GCM associated data, so an encrypted token copied into another row fails to decrypt.
- Plain tokens, data keys and the master key exist only in Edge Function memory, for one request.
- The encrypt and decrypt helpers are pure functions with tests written first: round trip, wrong master key fails, wrong account id fails, tampered ciphertext fails.
- Unlinking deletes the account row, which deletes the only copy of the data key.

### Where the master key lives

- **Supabase Edge Function secrets**, as `RETAILER_TOKEN_KEY_V<n>` (base64, 32 bytes), set per project with `supabase secrets set`. Preview and production use different keys.
- **Not GitHub secrets.** CI builds and deploys code and never needs this key. A copy in GitHub could be printed to a log by anyone able to edit a workflow, and GitHub secrets cannot be read back, so they are no use as a backup.
- **Backup:** one copy of each key in a password manager vault shared by Chris and David.

### Rotation

1. Add `RETAILER_TOKEN_KEY_V2` next to V1.
2. Run the re-wrap function: decrypt each data key with V1, re-encrypt it with V2, set `key_version = 2`. Tokens are not touched.
3. When no row has `key_version = 1`, remove V1.

### Environments

Preview and local never hold real retailer tokens (see 0004).

## Consequences

**Protected against**
- A leaked database dump or backup.
- A leaked service role key used to read tables.
- Copying an encrypted token from one account row to another.

**Not protected against**
- Someone who can deploy Edge Functions, or who takes over the Supabase account. Function secrets are shared by every function in a project, so every function gets the same review care. Supabase organisation access must therefore be limited to Chris and David, both with two-factor sign-in (to check and record before phase 3).

**Other effects**
- Concurrent runs are safe.
- Losing the master key means every household re-links AH. No other data is lost.
- A refresh at least every 7 days keeps the link alive. The weekly run does this; a mid-week refresh can be added if unused tokens turn out to expire.

## Alternatives considered

- **Supabase Vault.** Rejected: Vault's key is held by Supabase and readable through the database, so it protects less than a key kept outside the database, and adding it on top of envelope encryption adds complexity for little gain.
- **One master key encrypting tokens directly, no data keys.** Rejected: rotation would mean re-encrypting every token, and one key would protect every row directly.
- **Master key in GitHub secrets.** Rejected: CI never needs it, and it adds a copy that is easy to leak and impossible to read back.
- **Store the user's AH password and log in each time.** Rejected: far more sensitive, and AH's login uses a captcha.
