# AH API spike — findings

Date run: 2026-10-22 (home MacBook, Node, no dependencies)

| Test | Result | Notes |
|---|---|---|
| Login (code → tokens) | ✅ | App login page (`client_id=appie-ios`) works. Page spins forever after login; code found in DevTools Network tab (Cmd+F `login-exit`). Manual, one-time. |
| Access token lifetime | ✅ 7 days | 10,080 min |
| Refresh works | ✅ | |
| Refresh token rotates? | ⚠️ Yes | New refresh token on every refresh — must be saved each time (Supabase Vault row update). |
| Product search | ✅ | `/mobile-services/product/search/v2` — title, unit size, price, `webshopId` |
| Bonus fields on products | ✅ | `isBonus`, `bonusMechanism` (e.g. "10% KORTING"), `priceBeforeBonus` |
| Bonus periods | ✅ | Current week only (Mon–Sun, e.g. 2026-10-19 → 2026-10-25). Next week's bonuses not seen. |
| Bonus groups (e.g. "2e GRATIS") | ✅ | Spotlight section returns groups with `id`, description, mechanism |
| Cart read | ❌ 404 | No "order" exists until the user presses **Online bestellen** and picks a slot. |
| Cart write | ❌ 400 | Requires `Appie-Current-Order-Id` header — i.e. an existing order. |
| Shopping list read | ✅ | `GET /mobile-services/shoppinglist/v2/items` — returns all items incl. ticked (`strikedthrough`) |
| Shopping list add (free text) | ✅ | `PATCH .../shoppinglist/v2/items`, originCode `TXT` |
| Shopping list add (product) | ✅ | Same endpoint with `productId` |

## Ticked items

Ticked (`strikedthrough`) items stay visible in the app's in-store view but are **not counted in the total**. Only unticked items count, so old ticked items on the list are harmless.

## Key finding

**In AH's current app/site, the shopping list *is* the pre-order cart.** It shows a total and an "Online bestellen" button. An API "order" only exists after the user starts checkout. So the automation should write everything (staples + recipe items) to the **shopping list**, and the user presses "Online bestellen" → picks pickup slot → pays.

## Part 2: editing list items (2026-10-23)

Everything goes through one call: `PATCH /mobile-services/shoppinglist/v2/items` with `{"items": [...]}`.

| Action | Product line (keyed by `productId`) | Free-text line (keyed by `description`) |
|---|---|---|
| Add | quantity ≥ 1 | quantity ≥ 1, no `productId` |
| Change quantity | Re-send with new quantity: **sets** it, no duplicate line. `listItemId` optional. | Re-send same text (untested, expected same) |
| Tick / untick | `strikeThrough: true / false` | (untested) |
| Remove | quantity `0` | Same text, quantity `0` |

- Free-text lines come back with `listItemId: 0`, so their text is the only identifier.
- The weekly merge can be one idempotent write per item: target quantity + `strikeThrough: false`. Works whether the item is new, already on the list, or ticked from last week.
- The `lists/v3` endpoints and GraphQL "favourite list" mutations in appie-go are not needed.

## Open questions after the spike

- Does the 7-day refresh token survive weeks of disuse, or must refresh run more often?
- Run must be scheduled Monday — bonus data only covers the current week.

## Decision

- [x] Go: build on the **shopping list** API (cart/order API not needed)
- [ ] No-go: fall back to product-link list
