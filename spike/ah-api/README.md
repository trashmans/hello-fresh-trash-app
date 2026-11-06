# AH API spike

Throwaway test to answer one question: **can we reliably read and write an Albert Heijn cart and shopping list from code?** Nothing here is part of the app or deployed by CI.

AH has no public API. This uses the unofficial mobile-app API (endpoints taken from [appie-go](https://github.com/gwillem/appie-go)). AH can change or block it at any time.

## Run

Needs Node 18+ only (no `npm install`). From the repo root:

```
node spike/ah-api/spike.mjs login       # one-time browser login, saves tokens
node spike/ah-api/spike.mjs all         # runs every test, asks before writing anything
```

Individual commands:

| Command | What it does | Writes to AH? |
|---|---|---|
| `login` | Browser login → exchanges code for tokens | No |
| `refresh` | Refreshes the access token, reports lifetime and whether the refresh token rotates | No |
| `search [term]` | Product search, shows price/bonus/unit size | No |
| `bonus` | Bonus periods (dates) + spotlight offers | No |
| `cart` | Reads the active online order | No |
| `cart-test [productId]` | Adds 1 of a product, verifies, restores original quantity | Yes (restored) |
| `list` | Reads the shopping list | No |
| `list-test [productId]` | Adds a free-text line + a product line | Yes (delete manually) |
| `list-edit-test` | Adds a test product, then tries changing quantity, ticking, unticking and removing it | Yes (cleans up after itself) |

## Weekly trial (`weekly.mjs`)

A local trial of the AH weekly shop for your own account, outside the app. It plans this week's staples with the app's real planner (`src/lib/planWeek.js`: due rules, bonus stock-up, whole packs), compares the plan with your AH shopping list (`src/lib/listDiff.js`), and only after you confirm adds what's missing. It never removes or lowers anything on your list.

```
cp spike/ah-api/staples.example.json spike/ah-api/staples.json   # then edit it
node spike/ah-api/spike.mjs login        # once, if you have no tokens yet
node spike/ah-api/weekly.mjs plan        # dry run: shows the products found and the changes
node spike/ah-api/weekly.mjs send        # same, asks [y/N], then writes to your AH list
```

- `staples.json` (your staples) and `weekly-state.json` (what was added when, bonus stock) are gitignored.
- Run `send` once per week, on the day you order (Monday suits the bonus week). The week is Monday–Sunday: sending on Friday counts as this week, so weekly items would be due again on Monday.
- If a product is wrong, pin it: copy the `[id …]` that `plan` shows (or one from `spike.mjs search`) into that staple's `productId`.
- Needs Node 22.15+ (it loads the app's `src/lib` files directly).

Raw API responses go to `spike/ah-api/out/` and tokens to `spike/ah-api/.tokens.json`. Both are gitignored; they contain personal data.

## Security

- Your AH password is typed only into AH's own login page in your browser.
- Never commit `.tokens.json` — the refresh token gives full access to your AH account. Delete it when the spike is done.
