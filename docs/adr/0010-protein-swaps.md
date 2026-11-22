# 0010. Protein swaps: vegetarian, meat, or half and half

- Status: Accepted
- Date: 2026-11-22
- Deciders: Chris (David reviews the PR)

## Context

Households want to cook a meat recipe vegetarian, add meat to a vegetarian one, or cook half the servings each way, with sensible substitutes for the dish and the shopping list to match.

## Decision

1. **Modes:** a meat or fish recipe offers Original · All vegetarian · Half & half; a vegetarian recipe offers Original · All with meat · Half & half (`swapModesFor`, from `protein_source`).
2. **Gemini suggests options** (3–4 per request) that suit the dish and cuisine, through the `suggest-swaps` Edge Function. They are **saved per recipe and direction** in `public.recipe_swaps` and shared by everyone, like the catalogue; "Suggest other options" adds a new batch avoiding earlier titles. Gemini gets only the recipe.
3. **Two kinds of change.** A *portion* change is the protein itself and is split in Half & half. A *shared* change is something cooked into the whole dish (stock, fish sauce, frying fat, gelatine…): going vegetarian it applies as soon as any serving is vegetarian (Half & half uses vegetable stock for everyone); going to meat it applies only in All, so the vegetarian half stays vegetarian. `applySwap()` (src/lib/proteinSwap.js) enforces this, whatever Gemini returns.
4. **Where it applies:** the recipe page, and — when the recipe is in this week's list — the Shopping tab and the AH preview. The choice is stored on the household's pick (`household_recipe_picks.swap_id`, `swap_mode`), so it lasts for this week's pick and is shared with the household; picking the recipe again starts from the original.
5. **Nutrition is not recalculated** for a swap; the page says the values are for the original recipe.

## Consequences

- Suggestions cost one Gemini call per recipe and direction (plus "other options"), then load instantly. Limits: 20 batches per recipe and direction, 40 options per user per 24 hours.
- A deleted swap (or recipe) returns the pick to the original via the foreign key; the pick's FK includes the recipe so a swap can't be attached to another recipe.
- The swap's amounts are for the recipe's own servings; scaling and merging work as for the original.

## Alternatives considered

- **Saving a swapped copy as a new recipe.** Rejected: duplicates the catalogue and loses the link to the original.
- **Fresh suggestions every time.** Rejected: slower and more Gemini calls for the same answers.
- **Trusting Gemini for the shared-ingredient rule.** Rejected: the app applies it so a vegetarian half can't end up with chicken stock.
