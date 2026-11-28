# Record of processing

Hello Fresh Trash is an invite-only app. This record lists what personal data it processes, why, where it goes and how long it is kept, in the spirit of GDPR Article 30. It is an engineering record, not legal advice.

- **Controllers:** Chris and David, joint maintainers
- **Contact:** chris@aps75.com (primary), trashmanss@gmail.com (backup)
- **Data requests:** see [data-requests.md](data-requests.md)
- **Last reviewed:** 2026-11-28

Rows marked **Planned** belong to the AH weekly shop feature and apply once it ships.

## Processing activities

| Activity | Data subjects | Personal data | Purpose | Lawful basis | Retention |
|---|---|---|---|---|---|
| Sign-in and access control | Invited users | Name, email, profile picture URL (from Google), allowlist entry | Identify users, restrict access to invitees | Contract (providing the app) | While the account is active; deleted within 30 days of a deletion request |
| Recipe catalogue | Invited users | Uploader name shown on recipes, uploaded PDFs; links to recipe pages and their stored cover photos | Shared recipe catalogue with attribution | Contract | While the account is active; failed uploads deleted after 48 hours |
| Shopping list and display preferences | Invited users | Recipe selections, adjusted quantities, unit preferences | Build a shopping list from chosen recipes | Contract | While the account is active |
| Invites, friends and recipe shares | Invited people (before and after they sign in); users | Invitee email, who invited them, created / expiry / used / revoked dates; friend requests and friendships (two user IDs and a date); shared recipe, sender, recipient, optional note (280 characters), seen date, the group it was shared in (if any) | Let users invite people and recommend recipes to friends (docs/adr/0008) | Contract (users); legitimate interest (the invitee's email, so the person who knows them can let them in) | Unused invites deleted once expired (30 days) or revoked; the rest while both accounts exist |
| Social groups | Users | Group name, who made it and when; members (user IDs, date added, date they saw they were added). Members see each other's names and pictures | Let users group friends to share recipes and talk about them together (docs/adr/0011) | Contract | While the group exists; a member is removed when they leave, are removed or delete their account; deleting the group or the creator's account deletes it |
| Group comments on recipes | Users | Comment text (up to 500 characters), author, group, recipe, date | Let group members talk about recipes together (docs/adr/0011) | Contract | While the group exists; deleted by the author or the group's creator, or with the group, the recipe or the author's account |
| Food photos (food map) | Users; friends and group members who view | Shrunk photo and thumbnail with no file metadata; place (nearest city by default, or an exact spot the owner chose) with its coordinates; date taken (no time); visibility (friends, a group, only me); owner. For the city lookup: the location rounded to 1 decimal, and any place-search text typed | Show users' food photos to the friends or group they choose, on a map (docs/adr/0012, DPIA docs/privacy/dpia-food-map.md) | Consent (optional feature; each photo added by the user) | Until the user deletes the photo or their account (300 photos per person). Cities found for rounded locations: 30 days, with no user. Search text: not stored. Hourly lookup counts: 1 day |
| Households | Household members | Household name, membership, role; the household's recipe picks and list adjustments | Share shopping data within a household | Contract | While the household exists |
| Albert Heijn link | The member who links AH | Envelope-encrypted AH refresh token, link status, linked and last-used dates, who linked. No AH member ID, no access tokens, no password | Write shopping list lines to the household's AH account | Consent (explicit opt-in on the Automated ordering tab, revocable by unlinking) | Until unlinked; deleted immediately on unlink and with the household |
| This week's preview | Household members | The household's current AH shopping list (items, quantities, ticked or not, including items added in the AH app), read through the link when a member asks for the preview | Show what the weekly shop would change before anything is sent | Consent (part of the AH link) | Not stored: shown in the member's browser and discarded. Products seen in staple searches go to the product cache, which holds no personal data |
| Staples | Household members | Staple name, pinned AH product or search term, quantity, how often, stock-up settings, skip/pause, last added and stocked-until dates, who added it | Build the weekly AH list | Consent (part of the AH link) | While the household exists; deleted when removed or with the household |
| Ingredient mappings | Household members | Per recipe ingredient: the AH product the household buys for it, or that it is always at home; who added it | Build the weekly AH list | Consent (part of the AH link) | While the household exists; deleted when removed or with the household |
| Sends to AH (weekly runs) | Household members | Per send: week, who sent it, when, status; per line: product or free-text item, action, quantities, where it came from, outcome and error code (no AH error text) | Apply the weekly list to the household's AH account and show what happened | Consent (part of the AH link); sending only by the household owner after confirming | 12 weeks (nightly purge, see below); deleted with the household |
| **Planned:** Push notifications | Users who allow them | Push endpoint and keys per device | Weekly prompt, list ready, re-link alerts | Consent (browser permission) | Until revoked or the endpoint returns 410 |
| Audit log | Household members | Actor, action, time (no shopping contents) | Security and accountability | Legitimate interest | 12 months; actor removed when a member is erased |
| Data-request log | Requesters | Request type, dates, outcome (no request contents) | Show requests were handled on time | Legal obligation | 3 years |

Retention is enforced by a nightly job (`private.run_retention`, scheduled with pg_cron, migration 20261121000004) for weekly runs (12 weeks), the audit log (12 months), the data-request log (3 years) and unused invites; each run logs only counts. A second nightly job (`private.purge_place_search`, migration 20261127000002) deletes cached cities after 30 days and lookup counts after a day.

Shopping data can reveal sensitive traits by inference (diet, religion, health, pregnancy). It is treated as potentially sensitive: kept minimal, never shared, never analysed for profiling. Past AH orders and receipts are out of scope until a data protection impact assessment has been done.

## Processors and recipients

| Party | Role | Data | Location |
|---|---|---|---|
| Supabase | Processor: database, auth, storage, Edge Functions | All app data | EU: West EU (Ireland), both production and preview |
| Vercel | Processor: frontend hosting | Request metadata (IP, user agent) | Global edge network |
| Google | Sign-in provider | Name, email, picture at sign-in | Global |
| Google (Gemini API) | Processor: recipe PDF and web-page parsing (page text, or the link via url_context); suggesting protein swaps (recipe content only); translating staple product searches into Dutch; finding AH's product name for an ingredient with Google Search grounding (Suggest AH products) | Uploaded recipe PDFs; staple search words and ingredient names (no user data) | Global |
| Apple, Google, Mozilla push services | Deliver push messages (**planned**) | Encrypted push payload with no item names | Global |
| Geoapify | Processor: place search for food photos, through our server (since 28 Nov 2026; replaced OpenStreetMap's Nominatim, which blocked Supabase's servers) | A location rounded to 1 decimal (~11 km), or the place-search text typed; our server's IP. No user ID, photo or exact location | EU data centres |
| Albert Heijn | Recipient at the user's request | Shopping list lines written to the user's own AH account | Netherlands |
| Albert Heijn image server (static.ah.nl) | Third party the browser contacts directly | Request metadata (IP address, user agent) when a product photo is shown; no referrer, no app data | Netherlands / AH's CDN |

**To check:** transfer mechanisms (EU-US Data Privacy Framework or Standard Contractual Clauses) for Vercel, Google and the push services. Geoapify: accept its data processing agreement (DPA) for the account. (The OpenStreetMap Foundation is no longer used; the EU adequacy decision for the UK was confirmed in force on 27 Nov 2026.)

## Security measures

- TLS for all traffic; Supabase encryption at rest.
- Row Level Security on every table; household data checked through one membership function ([ADR 0001](../adr/0001-household-ownership.md)).
- Credentials and audit data in a `private` schema the API does not expose ([ADR 0002](../adr/0002-private-schema.md)).
- Retailer refresh tokens envelope-encrypted, never logged or sent to the browser ([ADR 0003](../adr/0003-retailer-token-handling.md)).
- Preview environment never holds real retailer tokens ([ADR 0004](../adr/0004-retailer-adapter.md)).
- Service role key only in Edge Functions; production credentials only in Vercel and Supabase.
