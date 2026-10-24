# Record of processing

Hello Fresh Trash is an invite-only app. This record lists what personal data it processes, why, where it goes and how long it is kept, in the spirit of GDPR Article 30. It is an engineering record, not legal advice.

- **Controllers:** Chris and David, joint maintainers
- **Contact:** chris@aps75.com (primary), trashmanss@gmail.com (backup)
- **Data requests:** see [data-requests.md](data-requests.md)
- **Last reviewed:** 2026-10-24

Rows marked **Planned** belong to the AH weekly shop feature and apply once it ships.

## Processing activities

| Activity | Data subjects | Personal data | Purpose | Lawful basis | Retention |
|---|---|---|---|---|---|
| Sign-in and access control | Invited users | Name, email, profile picture URL (from Google), allowlist entry | Identify users, restrict access to invitees | Contract (providing the app) | While the account is active; deleted within 30 days of a deletion request |
| Recipe catalogue | Invited users | Uploader name shown on recipes, uploaded PDFs | Shared recipe catalogue with attribution | Contract | While the account is active; failed uploads deleted after 48 hours |
| Shopping list and display preferences | Invited users | Recipe selections, adjusted quantities, unit preferences | Build a shopping list from chosen recipes | Contract | While the account is active |
| **Planned:** Households | Household members | Household name, membership, role | Share shopping data within a household | Contract | While the household exists |
| **Planned:** Albert Heijn link | The member who links AH | AH member ID, encrypted refresh token | Write the weekly list to the household's AH account | Consent (explicit opt-in, revocable in Settings) | Until unlinked; token deleted immediately on unlink |
| **Planned:** Staples, mappings, weekly runs | Household members | Staples, ingredient mappings, what each run added | Build and apply the weekly list | Consent (part of the AH link) | Runs: 12 weeks. Staples and mappings: while the household exists |
| **Planned:** Push notifications | Users who allow them | Push endpoint and keys per device | Weekly prompt, list ready, re-link alerts | Consent (browser permission) | Until revoked or the endpoint returns 410 |
| **Planned:** Audit log | Household members | Actor, action, time (no shopping contents) | Security and accountability | Legitimate interest | 12 months; actor removed when a member is erased |
| **Planned:** Data-request log | Requesters | Request type, dates, outcome (no request contents) | Show requests were handled on time | Legal obligation | 3 years |

Shopping data can reveal sensitive traits by inference (diet, religion, health, pregnancy). It is treated as potentially sensitive: kept minimal, never shared, never analysed for profiling. Past AH orders and receipts are out of scope until a data protection impact assessment has been done.

## Processors and recipients

| Party | Role | Data | Location |
|---|---|---|---|
| Supabase | Processor: database, auth, storage, Edge Functions | All app data | EU region |
| Vercel | Processor: frontend hosting | Request metadata (IP, user agent) | Global edge network |
| Google | Sign-in provider | Name, email, picture at sign-in | Global |
| Google (Gemini API) | Processor: recipe PDF parsing | Uploaded recipe PDFs | Global |
| Apple, Google, Mozilla push services | Deliver push messages (**planned**) | Encrypted push payload with no item names | Global |
| Albert Heijn | Recipient at the user's request (**planned**) | Shopping list lines written to the user's own AH account | Netherlands |

**To check:** transfer mechanisms (EU-US Data Privacy Framework or Standard Contractual Clauses) for Vercel, Google and the push services.

## Security measures

- TLS for all traffic; Supabase encryption at rest.
- Row Level Security on every table; household data checked through one membership function ([ADR 0001](../adr/0001-household-ownership.md)).
- Credentials and audit data in a `private` schema the API does not expose ([ADR 0002](../adr/0002-private-schema.md)).
- Retailer refresh tokens envelope-encrypted, never logged or sent to the browser ([ADR 0003](../adr/0003-retailer-token-handling.md)).
- Preview environment never holds real retailer tokens ([ADR 0004](../adr/0004-retailer-adapter.md)).
- Service role key only in Edge Functions; production credentials only in Vercel and Supabase.
