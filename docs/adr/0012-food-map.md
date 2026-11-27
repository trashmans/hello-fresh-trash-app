# 0012. Food map: friends' food photos on a map, dishes recognised, recipes found

- Status: Accepted (Chris and David, 26 Nov 2026; DPIA signed off the same day)
- Date: 2026-11-26
- Deciders: Chris, David
- Related: docs/privacy/dpia-food-map.md, spike/food-photos/FINDINGS.md, ADR 0008 (Social), 0009 (link import), 0011 (groups)

## Context

Chris wants a Social-tab feature where friends add photos of food they ate around the world; the photos appear on a large map at the places they were taken; the app recognises each dish; and it finds recipes for those dishes that can be added to the catalogue.

Facts that shape it:

- The Google Photos Library API only reaches photos an app created itself (since 31 March 2025). The Picker API lets a person pick photos, but its downloads keep all EXIF metadata *except* the location. A "linked Google Photos account" cannot fill a map.
- The spike (`spike/food-photos/FINDINGS.md`) found that downloading a Google Photos album ("Download all") or a Takeout export keeps GPS in the photo files: about two thirds of 90 food photos had it; the rest had no location anywhere, not even in Google Photos. Takeout's .json files added nothing.
- Photo locations are the most sensitive data this app would hold: they can reveal a home, a workplace, routines and travel. A DPIA is done first (docs/privacy/dpia-food-map.md).
- TasteAtlas has no public API; we don't scrape other sites (see the retailer terms review, ADR 0004 amendment 2026-11-26).

## Decision

1. **Photos come in as uploads.** Past photos: in Google Photos, search "food", collect the photos in an album, choose **Download all**, and upload the ZIP or the photos. New photos: upload from the phone. The app shows these steps, and warns that phones can strip the location when sharing.
2. **Read in the browser, store only what's needed.** The browser opens the ZIP, reads each photo's GPS (EXIF) and date taken, shrinks the photo (longest side 1600 px, plus a 400 px thumbnail), and re-encodes it, which drops all metadata. The original file and its exact GPS never leave the device unless the person chooses the exact spot (point 4).
3. **No location, no pin.** Photos without GPS go through **Pin on the map**: search a city or place (OpenStreetMap Nominatim, through our server) or skip. Skipped photos stay in the person's own list, off the map.
4. **City-level by default.** By default a pin is stored as the nearest city (its name and the city's coordinates), not the photo's coordinates. Per photo, the person can choose **Exact spot** (for example a restaurant). Exact coordinates are only ever stored when chosen that way.
5. **Visibility per photo**, chosen when adding and changeable later: **All friends** (default), **a group**, or **Only me**. RLS enforces it; nobody else, admins included through the app, sees another person's photos.
6. **Dish recognition: top 3, uploader decides.** A thumbnail (not the full photo) goes to Gemini **without search grounding** (image recognition only), which returns the **3 most likely dishes**, each with name, cuisine, country of origin and a confidence. The uploader picks one, or overrides with their own dish name. Nothing is labelled until the uploader chooses; the choice can be changed later. Each dish shows a **Look up on TasteAtlas** link that the app builds itself (a TasteAtlas search for the dish name); nothing is fetched, copied or stored from TasteAtlas or from Google Search.
7. **Recipes: top 3, uploader decides, never added automatically.** For the chosen dish, Gemini with Google Search grounding finds up to **3 recipe pages**, shown to the uploader as Google returns them, with Google's Search Suggestions, and **not stored**. The uploader opens one and adds it by pasting its link (or pastes a recipe link of their own), or skips. The import starts from the uploader's own pasted link through the existing link import (ADR 0009), with its normal duplicate check (an existing recipe is linked instead of imported twice); the app never takes a grounding link and fetches it by itself. The recipe records which food photo it came from (shown only to people who can see the photo).
8. **Map:** MapLibre GL in the browser with **Protomaps** vector tiles (hosted API, free for non-commercial use, key restricted to our sites by CORS; we can self-host the tiles later without changing the app). Pins cluster by area; tapping shows thumbnails. Map tiles reveal to Protomaps which areas a viewer looks at, not whose photos are there.
9. **Storage:** a private `food-photos` bucket; files served through short-lived signed URLs. A database table holds the photo, its owner, visibility, pin (city or exact), date taken, dish and link. Deleting a photo deletes its files; deleting an account deletes everything.
10. **Built in phases**, each its own PRs: F1 photos (upload, read, pin, visibility, list); F2 the map; F3 dish recognition; F4 recipe suggestions. F1 does not start until this ADR and the DPIA are signed off.

Why points 6 and 7 work this way: the Gemini API terms (effective 23 Mar 2026) restrict storing the Links and Search Suggestions that Google Search grounding returns, require Grounded Results to be shown with their Search Suggestions to the person who asked, and prohibit using Links "to identify destination pages for crawling or scraping". So grounding is used only to show recipe options; dish recognition doesn't use grounding, and the TasteAtlas link is an app-built search link.

## Consequences

- The privacy policy and record of processing gain a food-photo section and three processors (Protomaps/Cloudflare for tiles, OpenStreetMap Foundation for place search, Google Gemini for dish recognition, already a processor).
- Supabase storage: about 400–600 kB per photo after shrinking; 1,000 photos ≈ 0.5 GB. Free tier is 1 GB in total, so a per-person limit (start: 300 photos) and a storage check before F1 ships.
- Photos with people in them may be uploaded; the app asks to share only food photos, and Gemini is told to describe only the food. Faces are not detected or stored.
- About one in three past photos will need pinning by hand.

## Alternatives considered

- **Google Photos Picker as the main route:** no locations, so every photo would need pinning. Kept as a possible later convenience.
- **Takeout as the main route:** same result as Download all, more steps.
- **Storing exact GPS for every photo and coarsening on display:** simpler, but keeps sensitive data we don't need.
- **Scraping TasteAtlas** for dish data: against our approach to other sites' terms; Gemini recognises dishes itself.
- **MapTiler / Stadia Maps:** smaller free allowances and no self-host route; Protomaps preferred.

## Notes

- **27 Nov 2026 (F1b):** storage and access rules in `supabase/migrations/20261127000001_food_photos.sql`. `food_photos` holds only the shrunk files' paths, the chosen place (city or exact), the date taken and the visibility. Who can read follows point 5: owner always, friends for friends photos, members for group photos; files in the private `food-photos` bucket are readable exactly when the row is. The 300-photo limit is enforced in the database (`add_food_photo`). When a group is deleted its photos become only_me rather than visible to friends. Files: the upload screen (F1d) deletes a photo's two files with its row; deleting an account deletes the rows (CASCADE), and its files are left for the account-deletion clean-up (Phase 8) to remove, as for recipe files.
- **27 Nov 2026 (F1c):** place search in the `place-search` Edge Function (`supabase/functions/_shared/places.ts`, migration 20261127000002), within the Nominatim usage policy (https://operations.osmfoundation.org/policies/nominatim/): one call a second for the whole app, the app's own User-Agent, cities cached 30 days per rounded cell (search text not cached), searches only when the person presses Search (no autocomplete), 300 lookups per person an hour, results shown with "© OpenStreetMap contributors". The server rounds every location to 1 decimal itself. If Nominatim withdraws access or the app outgrows it, the fallback is a paid geocoder behind the same function.
- **27 Nov 2026 (F1d):** Chris's choices: food photos are a card on the Social tab; who sees new photos is a setting (Friends by default, or Only me), not a choice on every upload, with an offer to change existing photos when it changes; a single photo can still be changed later (F1e, with place and exact spot); photos without a place are added anyway and stay off the map until they get one. Search results are city level for towns, regions and countries and an exact spot for anything smaller. Fixed a gap from F1b: leaving a group, or being removed, turns your photos in that group to only_me (migration 20261127000003).
