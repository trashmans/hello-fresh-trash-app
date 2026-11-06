# 0007. Retailer access tokens are never stored

- Status: Accepted
- Date: 2026-11-06
- Deciders: Chris
- Refines: step 2 of "Single-flight refresh" in [0003](0003-retailer-token-handling.md). The rest of 0003 stands.

## Context

ADR 0003's refresh steps say "if the access token is still valid for more than 10 minutes, use it", which assumes the access token is kept between runs. HLD v2 says access tokens stay in memory only. When `private.retailer_accounts` was designed, the two had to be reconciled. An AH access token lasts 7 days and opens the account just like the refresh token does, so storing it would add a second live credential to the table.

## Decision

- `private.retailer_accounts` stores only the envelope-encrypted refresh token. There is no access-token column.
- Every adapter run does the single-flight refresh from 0003: lock the row, refresh, save the rotated refresh token (re-encrypted with `resealToken()`), increment `token_version`, commit, and only then use the new access token, in memory, for that one run.
- Step 2 of 0003 ("use the stored access token if still valid") does not apply.

## Consequences

- One less secret at rest; a database dump still opens nothing (0003).
- Every run refreshes: the weekly run, a manual "send now", and a Settings "test link" each cost one refresh. That is a handful per week, well within what the spike saw, and the row lock keeps concurrent runs safe.
- A refresh happens at least weekly anyway, which also keeps the 7-day token chain alive (0003, "Other effects").
- If AH ever rate-limits refreshes, revisit with an encrypted access-token column and a new ADR.

## Alternatives considered

- **Store the access token encrypted, like the refresh token.** Rejected for now: fewer refreshes, but a second live credential in the table for little gain at our volume.
