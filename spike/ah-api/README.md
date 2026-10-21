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

Raw API responses go to `spike/ah-api/out/` and tokens to `spike/ah-api/.tokens.json`. Both are gitignored; they contain personal data.

## Security

- Your AH password is typed only into AH's own login page in your browser.
- Never commit `.tokens.json` — the refresh token gives full access to your AH account. Delete it when the spike is done.
