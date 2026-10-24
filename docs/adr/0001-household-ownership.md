# 0001. Households own shopping data, not individual users

- Status: Accepted
- Date: 2026-10-24
- Deciders: Chris, David

## Context

The AH weekly shop feature stores staples, ingredient-to-product mappings, a retailer account link, recipe picks and weekly run history. People who share a home share one shopping list and usually one Albert Heijn account. Existing tables (`shopping_lists`, `profiles`) are keyed by `user_id`.

Keying the new tables by `user_id` would work for one person, but moving to shared ownership later means re-keying live tables and rewriting every RLS policy.

## Decision

- A new `households` table owns all shopping data: staples, equivalence groups, ingredient mappings, recipe picks, retailer account and weekly runs.
- Users join a household through `household_members` (`household_id`, `user_id`, `role` = `owner` | `member`).
- One retailer account per household.
- Recipe picks move from per-user `shopping_lists` to a household-owned table.
- Every household-owned table uses the same RLS check: one `SECURITY DEFINER` function, `private.is_household_member(household_id)`, called from each policy.
- Foreign keys to `households` use `ON DELETE CASCADE`.

## Consequences

- Sharing works from day one; a single person is a household of one.
- RLS policies are uniform and reviewable in one place.
- Erasing a household is one delete. Erasing one member leaves shared household data in place (see `docs/privacy/data-requests.md`).
- `shopping_lists` needs a migration path for existing recipe picks. The current shopping list drawer keeps working until it is moved over.
- The app needs a small "create or join household" step after sign-in.

## Alternatives considered

- **Per-user tables, add sharing later.** Rejected: the most expensive change to retrofit.
- **Share by copying rows between users.** Rejected: data drifts apart and erasure gets harder.
