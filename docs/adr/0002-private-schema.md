# 0002. Integration data lives in a private schema

- Status: Accepted
- Date: 2026-10-24
- Deciders: Chris, David

## Context

Supabase exposes the `public` schema to the browser through its REST API. Row Level Security is then the only barrier between a signed-in user and every row. Some new data should never reach a browser at all: retailer account links (which point to encrypted tokens), the audit log, the data-request log and run internals.

## Decision

- Create a `private` schema. It is not listed in the API's exposed schemas, and `anon` and `authenticated` get no `USAGE` on it.
- These tables live in `private`: `retailer_accounts`, `audit_events`, `data_requests`, and run internals.
- RLS is still enabled on every `private` table (no policies, so deny all), as defence in depth.
- Only Edge Functions using the service role, and `SECURITY DEFINER` functions with a fixed `search_path`, touch `private`.
- The browser gets what it needs through narrow RPC functions, for example "is my household linked to AH?" returns a status, never a row.

## Consequences

- A mistake in an RLS policy on a `public` table cannot expose tokens or audit data.
- The repo's standard migration pattern (`CREATE TABLE public.…` with RLS) gets a second variant for `private` tables, documented in the migration file header.
- `SECURITY DEFINER` functions need review: fixed `search_path`, minimal inputs, and `EXECUTE` revoked from `public` (the repo already does this for trigger functions).

## Alternatives considered

- **Everything in `public` with RLS.** Rejected: one policy mistake exposes credentials.
- **A separate Supabase project for integrations.** Rejected for now: double the operations cost for a small app. Can be revisited.
