# 0008. Social is built on the shared recipe catalogue

- Status: Accepted
- Date: 2026-11-21
- Deciders: Chris (David reviews the PR)

## Context

The Social tab was planned as "share recipes with friends and groups". The design mock-up assumed recipes are private ("only the people you pick can see it"). In the app as built, the catalogue is shared: every signed-in user can read every ready recipe (RLS policy "authenticated users can read all recipes"), and duplicate uploads are rejected across all users. Access to the app itself is an email allowlist that admins edit with SQL.

## Decision

1. **The catalogue stays shared.** Everyone who can sign in sees all recipes. Social adds relationships on top, not visibility rules.
2. **Invites open the app.** Any signed-in user can invite an email (5 per 24 hours). A valid invite (30 days, not revoked) lets that email sign in. On first sign-in the invite is used, the email joins `allowed_emails`, and inviter and invitee become friends. Unused invites are deleted once expired or revoked.
3. **Friends** are added by invite, or by email for existing users with a request the other person accepts. A friendship is one row each way.
4. **Sharing is a recommendation.** A share points a friend at a recipe with an optional note (280 characters). It shares only the recipe and its PDF, never shopping lists, staples or AH data. "Friends' recipes" on the Recipes tab shows recipes uploaded by friends.
5. **All changes go through SECURITY DEFINER functions** that check these rules; tables have RLS so people read only rows they are part of.
6. **Groups come later**, as their own change.

## Consequences

- No change to existing recipes, their access rules or the duplicate check.
- Inviting no longer needs an admin; the invite limit and expiry keep that in check. Admins can read all invites.
- An invite stores someone's email before they have agreed to anything; the privacy policy and record of processing say so, and unused invites are deleted.
- "Add friend" and "invite" reveal whether an email already has an account (they answer differently). Acceptable for an invite-only app of people who know each other; the invite limit slows guessing.
- If recipes ever become private, sharing would also have to grant access; that would be a new decision.

## Alternatives considered

- **Private recipes, visible to the uploader's household and the people they share with** (as in the mock-up). Rejected for now: it changes every recipe's access rules, breaks the cross-user duplicate check, and needs a migration for all existing recipes, for little gain in a small invite-only app.
- **Admin-only invites.** Rejected: the people using the app are the ones who know who to invite.
