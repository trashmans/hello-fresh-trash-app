# Food photos spike (phase F0)

Throwaway check for one question: **do food photos from Google Photos or a phone still carry where they were taken?** Needed for the planned food map on the Social tab. Nothing here is part of the app.

The Google Photos API strips locations from photos it hands to apps, so the plan is: people collect food photos in a Google Photos album, export it with Google Takeout (or download it), and upload the result to the app, which reads the location in the browser.

## Run

Node 18+ only, no `npm install`. Nothing is uploaded; locations are printed rounded to about 1 km.

```
node spike/food-photos/check.mjs ~/Downloads/takeout-20261126.zip
node spike/food-photos/check.mjs ~/Downloads/Food
```

## What to test (10–20 food photos)

1. In Google Photos, search "food", add the results to an album called **Food**.
2. **Takeout:** takeout.google.com → Deselect all → Google Photos → "All photo albums included" → only **Food** → ZIP → export, download, run the script on the ZIP.
3. **Album download:** in the Food album, ⋮ → Download all; run the script on that ZIP.
4. **Phone:** copy a few food photos straight off the phone (AirDrop, cable, or the phone's own share), run the script on the folder.

Findings go in `FINDINGS.md`.
