# 0003. Retailer tokens: single-flight refresh and envelope encryption

- Status: Accepted
- Date: 2026-10-24
- Deciders: Chris, David

## Context

The AH API spike showed:

- Access tokens last 7 days.
- **The refresh token rotates on every refresh.** The old one stops working.

Two refreshes running at the same time (the weekly run plus a manual "send now") would leave one process holding a dead token and lock the household out until someone re-links by hand.

A refresh token opens a real AH account: address, purchase history and shopping list. It is the most sensitive data in the system. Supabase Vault encrypts secrets, but anyone with the service role key or a full database dump can decrypt them.

## Decision

**Single-flight refresh**
1. Lock the account row (`SELECT … FOR UPDATE` on `private.retailer_accounts`).
2. If the access token is still valid for more than 10 minutes, use it and release.
3. Otherwise refresh, write the new refresh token and increment `token_version` **before** using the new access token, then commit.
4. On refresh failure, set `status = 'relink_needed'`, write an audit event and send a re-link push.

**Storage**
- Refresh tokens are encrypted by the adapter with AES-GCM using a key held only in the adapter function's secrets (`RETAILER_TOKEN_KEY`), then stored in Vault. A database dump alone cannot decrypt them.
- Access tokens are never stored; they live in memory for one run.
- Tokens are never logged, never returned to the browser, and never included in error messages.
- Unlinking deletes the Vault secret and the account row.

**Environments**
- Preview and local never hold real retailer tokens (see 0004).

## Consequences

- Concurrent runs are safe.
- Rotating `RETAILER_TOKEN_KEY` needs a small re-encryption script. Document it before the first rotation.
- Losing `RETAILER_TOKEN_KEY` means every household must re-link. That is acceptable: no other data is lost.
- A refresh at least every 7 days keeps the link alive. The weekly run does this; a mid-week refresh can be added if unused tokens turn out to expire.

## Alternatives considered

- **Vault alone.** Rejected: a database dump or leaked service role key would expose every token.
- **Store the user's AH password and log in each time.** Rejected: far more sensitive, and AH's login uses a captcha.
