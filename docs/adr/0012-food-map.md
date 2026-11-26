# 0012. Food map: friends' food photos on a map, dishes recognised, recipes found

- Status: Proposed (Chris; David reviews with the DPIA)
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
6. **Dish recognition with Gemini.** A thumbnail (not the full photo) goes to Gemini, which returns the dish name, cuisine, country of origin and a confidence. The person confirms or corrects it. A Google-grounded search adds a link to the dish's TasteAtlas page when one exists. Links only: nothing is copied from TasteAtlas.
7. **Recipes are suggested, never added automatically.** Gemini with Google Search suggests up to 3 recipe pages for the confirmed dish; the person picks one, and it goes through the existing link import (ADR 0009), with its normal duplicate check. The recipe records which food photo it came from (shown only to people who can see the photo).
8. **Map:** MapLibre GL in the browser with **Protomaps** vector tiles (hosted API, free for non-commercial use, key restricted to our sites by CORS; we can self-host the tiles later without changing the app). Pins cluster by area; tapping shows thumbnails. Map tiles reveal to Protomaps which areas a viewer looks at, not whose photos are there.
9. **Storage:** a private `food-photos` bucket; files served through short-lived signed URLs. A database table holds the photo, its owner, visibility, pin (city or exact), date taken, dish and link. Deleting a photo deletes its files; deleting an account deletes everything.
10. **Built in phases**, each its own PRs: F1 photos (upload, read, pin, visibility, list); F2 the map; F3 dish recognition; F4 recipe suggestions. F1 does not start until this ADR and the DPIA are signed off.

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
