# 0011. Social groups

- Status: Accepted
- Date: 2026-11-26
- Deciders: Chris (David reviews the PR)

## Context

Social v1 (ADR 0008) has friends and one-to-one recipe shares on a shared catalogue. Chris wants groups (family, a group of friends) to share a recipe with several people at once, filter the Recipes tab by a group, see a group feed, and leave comments on recipes that only the group sees.

## Decision

1. **Groups are made of friends.** Only the creator's friends can be added, so no new way to reach strangers. Someone who later stops being the creator's friend stays until removed.
2. **The creator manages the group.** Only the creator renames it, adds or removes people, and deletes it; anyone else can leave. The creator can't leave (they delete the group instead).
3. **Members see each other.** Everyone in a group sees its name and every member's name and picture (profiles, email hidden, migration 20261121000003), including members who are not their friends. A member is told when they were added ("Ann added you to Family") and can leave.
4. **Limits, enforced in the database:** names 1–40 characters (spaces squeezed); 10 groups made per person; 30 people per group, creator included.
5. **Built in steps**, each its own PR: G1 groups and members (this ADR, migration 20261126000001); G2 share a recipe with a group; G3 a group filter on the Recipes tab; G4 a group feed on Social; G5 comments on recipes, visible to the group only (its own migration, retention rule and privacy policy update).
6. **Same pattern as Social v1:** RLS on both tables (members read their groups' rows; a SECURITY DEFINER membership check keeps the members policy from querying itself), every change through SECURITY DEFINER functions that raise short error codes, nothing for `anon`, CASCADE on user deletion.

## Consequences

- A member's name and picture are shown to the other members of a group even if they are not friends. The privacy policy and record of processing say so.
- Deleting a group removes its memberships (and, from G5, its comments); recipes shared through it stay, since each share is a row per recipient.
- No group invites: people join only by being added by a friend who made the group.

## Alternatives considered

- **Anyone can be added, with an invitation to accept.** More flexible, but adds a new way to contact people you aren't friends with; not needed for family and friend groups.
- **Any member can add their own friends.** Groups would grow beyond what the creator agreed to; rejected for v1.
- **Private lists only the creator sees.** Simpler, but no feed or comments are possible without members seeing each other.
