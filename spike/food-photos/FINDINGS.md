# Food photos spike — findings (26 Nov 2026)

Question: do food photos from Google Photos or a phone still carry where they were taken, so the app can place them on a food map? Run by Chris with `check.mjs` on his own photos; nothing was uploaded.

## Results

| Route | With GPS in the photo | Location only in a Takeout .json | No location |
|---|---|---|---|
| Google Takeout ZIP of a "Food" album (90 photos) | 59 | 0 | 31 |
| The same album via Google Photos "Download all" (87 photos) | 56 | 0 | 31 |
| Photos copied straight off the phone (14) | 9 | 0 | 5 |

- **The album's normal "Download all" keeps GPS as well as Takeout does.** The few-photo difference is likely videos or duplicates. The simple route is enough.
- **Takeout's .json metadata files added nothing**: every location was already in the photo itself (EXIF). The app doesn't need to read them.
- **About a third of food photos have no location at all.** Google Photos' own Info panel shows none for them either, so it is not a reading problem: location was off, or the photo was shared, a screenshot, or from another camera.

## Other facts behind the design

- Since 31 March 2025 the Google Photos Library API only reaches photos the app itself created; picking from a library goes through the Picker API, and its downloads keep "all the Exif metadata except the location metadata". So a Google Photos link can't fill the map; files have to be downloaded and uploaded.
- Android's photo picker strips location by default unless the person chooses "Include location" (newer Android); iPhone sharing can also drop it. New photos should be checked the same way when uploading from each phone.

## Recommendation for the app

1. **Past photos:** in Google Photos, search "food", add the photos to a "Food" album, choose **Download all**, and upload the ZIP (or the photos) to the app.
2. The app reads each photo's GPS **in the browser**, shrinks the photo and removes all its metadata before uploading; only the location the person approves is stored.
3. **Photos without a location:** a "Pin on the map" step (search a city or place) or skip; skipped photos still appear in the person's photo list, not on the map.
4. **New photos:** uploaded from the phone while travelling, same reading and pinning.
