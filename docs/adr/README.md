# Architecture decision records

Short records of decisions that are expensive to reverse. One file per decision, numbered in order. A record is never edited after it is accepted; a later record supersedes it instead.

| # | Decision | Status |
|---|---|---|
| [0001](0001-household-ownership.md) | Households own shopping data, not individual users | Accepted (retailer-account rule superseded by 0006) |
| [0002](0002-private-schema.md) | Integration data lives in a `private` schema the API does not expose | Accepted |
| [0003](0003-retailer-token-handling.md) | Retailer tokens: single-flight refresh and envelope encryption | Accepted |
| [0004](0004-retailer-adapter.md) | All retailer calls go through one adapter | Accepted |
| [0005](0005-incremental-rollout.md) | Roll out the AH weekly shop in small, reversible steps | Accepted |
| [0006](0006-one-account-per-retailer.md) | One account per retailer per household | Accepted |
| [0007](0007-access-tokens-never-stored.md) | Retailer access tokens are never stored | Accepted |

Design context: the AH Weekly Shop high-level design and the API spike findings in `spike/ah-api/FINDINGS.md`.

## Template

```markdown
# NNNN. Title

- Status: Proposed | Accepted | Superseded by NNNN
- Date: YYYY-MM-DD
- Deciders: first names

## Context
What forces the decision.

## Decision
What we will do.

## Consequences
What gets easier, what gets harder, what we must now do.

## Alternatives considered
What we rejected and why.
```
