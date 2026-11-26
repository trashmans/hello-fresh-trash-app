# Data protection impact assessment: Food map

- Feature: docs/adr/0012-food-map.md
- Prepared: 2026-11-26 (Chris, drafted with Claude)
- To review and sign off: Chris and David, before phase F1 is built
- Not legal advice. Done in the spirit of GDPR Article 35 because the feature processes location data on a large scale relative to this app, and location can reveal sensitive patterns.

## 1. What the processing is

Friends upload food photos. The app reads where each photo was taken, shows the photos on a map to the people the owner chooses, recognises the dish with Gemini, and suggests recipes.

| Data | From | Stored? | Who sees it |
|---|---|---|---|
| Photo (shrunk, metadata removed) and thumbnail | Owner's upload | Yes, private bucket | Owner + chosen audience |
| Location: nearest city (default) or exact spot (if chosen) | Photo EXIF, or the owner's pin | Yes | Owner + chosen audience |
| Exact GPS from the file when city-level is chosen | Photo EXIF | **No** (read in the browser only) | Nobody |
| Date taken | Photo EXIF | Yes (date only, no time) | Owner + chosen audience |
| Dish: the uploader's choice from Gemini's top 3 (or their own name), cuisine, country, TasteAtlas link | Gemini + uploader's choice | Yes (the chosen one; the 3 suggestions are kept until a choice is made) | Owner + chosen audience |
| Thumbnail sent for recognition | Upload | Sent to Gemini, not stored there by us | Google (processor) |
| Place-search text ("Bangkok") | Owner | Sent to Nominatim via our server, not stored | OSM Foundation |
| Map area viewed | Viewer's browser | Tile requests to Protomaps | Protomaps/Cloudflare (no photo data) |

Data subjects: users who upload; friends and group members who view. Possibly people who appear in photos (see risk 5).

## 2. Necessity and proportionality

- The map is the feature; a location per photo is necessary. City level is enough for "food around the world", so it is the default; exact spots only by choice.
- Exact GPS is not kept when it isn't needed (read in the browser, discarded).
- Only a thumbnail goes to Gemini; only the dish is asked for.
- Lawful basis: contract (providing the feature the user turns on and uses). Each photo is added deliberately; nothing is collected in the background.
- Retention: until the owner deletes the photo or their account. No copies in logs.

## 3. Risks and measures

| # | Risk | Likelihood / impact before | Measures | After |
|---|---|---|---|---|
| 1 | **Home or workplace revealed** by pins of meals eaten at home or near work | Likely / high | City-level default; exact spot only when chosen per photo, with a warning; photos taken within a chosen "home area" can be flagged in the browser before upload (F1 option); owner sees their map exactly as others do | Unlikely / medium |
| 2 | **Travel patterns and routines** (where someone is, when) | Possible / medium | Date only, no time; visibility per photo; "Only me" option; no live location, nothing automatic | Unlikely / low |
| 3 | **Photos seen by the wrong people** | Possible / high | RLS on table and storage; private bucket with short-lived signed URLs; visibility checked in the database, not the app; tests on a scratch Postgres for every policy (as for Social) | Unlikely / medium |
| 4 | **Metadata leaking** (GPS, camera, phone model) in stored files | Likely / medium | Browser re-encodes images, which drops all EXIF/XMP; a check in F1 refuses a stored file that still has GPS | Unlikely / low |
| 5 | **Other people in photos** (faces at the table) | Possible / medium | App asks for food photos only; Gemini instructed to describe only food; no face detection, no tagging; owner can delete any photo; anyone shown can ask the owner or us to remove it | Possible / low |
| 6 | **Processors** see data (Gemini, Nominatim, Protomaps) | Certain / low | Minimum sent: thumbnail, a search phrase, map areas; named in the privacy policy; Gemini already a processor with billing (no training on paid API data per Google's terms, to confirm) | Certain / low |
| 7 | **Storage limits / cost** lead to deletions or overruns | Possible / low | Per-person cap (300 photos to start); shrunk files; monitoring before F1 | Unlikely / low |
| 8 | **Account takeover** exposes someone's map | Unlikely / high | Google sign-in only; invite-only app; visibility limits what any account sees | Unlikely / medium |

## 4. Rights

- Access/export: a person's photos and pins are included in the data export (rollout phase 8; until then on request).
- Erasure: delete per photo in the app; account deletion removes all photos and files (CASCADE + storage cleanup).
- Objection: anyone appearing in a photo can ask for removal through the data-request procedure.

## 5. Outcome

Residual risk is acceptable **if** the measures above are built into F1–F2, the privacy policy and record of processing are updated before F1 ships, and the per-photo visibility and city-level defaults are kept. Re-assess before opening the feature beyond the two deciders' households and friends, or if exact GPS by default is ever considered.

| Reviewer | Decision | Date |
|---|---|---|
| Chris | | |
| David | | |
