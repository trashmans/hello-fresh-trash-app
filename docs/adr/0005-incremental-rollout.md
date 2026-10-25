# 0005. Roll out the AH weekly shop in small, reversible steps

- Status: Accepted
- Date: 2026-10-25
- Deciders: Chris, David

## Context

The AH weekly shop touches almost every layer: new schema, a shared shopping list, a third-party integration that holds credentials, a scheduler, push notifications and new screens. Shipping it as one change would be hard to review, hard to test and hard to back out. The AH API is unofficial and can change without notice.

## Decision

1. **Add first, remove later.** New tables and columns are added while the old ones keep working. Old ones are removed in a separate, later PR, once nothing reads them. Every migration includes rollback SQL and loses no data when rolled back.
2. **Per-household switch.** `households.ah_enabled` (default off, set by an admin) hides every AH screen and stops every AH call for that household. Only one household turns it on until manual sending has run cleanly for at least two weeks.
3. **Dry run before writing.** The app shows what it would send to AH for at least two weeks before it is allowed to change a real list.
4. **Small PRs.** One concern per PR, aiming for under about 400 changed lines.
5. **Privacy first.** The privacy policy section for AH ships in the same release that first stores an AH token.

Phase order:

| Phase | Ships | Visible to |
|---|---|---|
| 0 | Decision records, privacy docs, planner logic in `src/lib/` | Nobody |
| 1 | Private schema, households, members, audit and data-request logs; a household for every existing user; secret scanning in CI | Nobody |
| 2 | Shared household shopping list: write both tables, backfill, switch reads, drop the old table later | Household members |
| 3 | Retailer adapter with envelope encryption (0003), fake adapter (0004), link and unlink in Settings, privacy policy update | Switched-on households |
| 4 | Product and promotion cache, staples, ingredient mapping | Switched-on households |
| 5 | Dry run: preview the week's changes | Switched-on households |
| 6 | Manual "Send to AH list" | Switched-on households |
| 7 | Scheduled weekly run, Sunday prompt, Monday push (separate `automation_enabled` opt-in) | Households that opt in |
| 8 | Data export, retention purge jobs | Requesters |

## Consequences

- Each PR can be reviewed in one sitting and reverted on its own.
- The switch and the AH kill switch (0004) give two independent ways to stop AH traffic without a deploy.
- Some temporary duplication during phase 2 (writing two tables), removed in its contract step.
- The feature reaches other households later than a single big release would.

## Alternatives considered

- **One large feature branch merged at the end.** Rejected: unreviewable, and conflicts grow the longer it lives.
- **Environment-wide feature flag instead of per household.** Rejected: cannot try the feature on one household in production without exposing it to everyone.
