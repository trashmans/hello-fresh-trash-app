// Protein swaps (docs/adr/0010): the Gemini prompt for swap options and the check of its
// reply. Pure, tested with Vitest (src/tests/swapOptions.test.js); used by suggest-swaps.

// deno-lint-ignore no-explicit-any
type Json = any

export interface SwapIngredient {
  name: string
  canonical_name: string | null
  quantity: number | null
  unit: string | null
  preparation: string | null
}
export interface SwapChange { kind: 'portion' | 'shared'; replaces: string[]; add: SwapIngredient | null }
export interface SwapOption { title: string; summary: string | null; changes: SwapChange[]; steps_all: string[]; steps_half: string[] }

export interface SwapRecipe {
  name: string
  cuisine: string | null
  protein_source: string | null
  servings: number | null
  ingredients: { name: string; quantity: number | null; unit: string | null; preparation: string | null }[]
  steps: string[]
}

const line = (i: SwapRecipe['ingredients'][number]) =>
  [i.quantity != null ? String(i.quantity) : null, i.unit, i.name].filter(Boolean).join(' ') + (i.preparation ? `, ${i.preparation}` : '')

/** The prompt for 3–4 swap options. avoid: titles already offered (for "Suggest other options"). */
export function swapPrompt(recipe: SwapRecipe, direction: 'to_vegetarian' | 'to_meat', avoid: string[] = []): string {
  const goal = direction === 'to_vegetarian'
    ? 'make it VEGETARIAN (no meat, poultry, fish or seafood; eggs and dairy are fine)'
    : 'add MEAT, POULTRY OR FISH to this vegetarian recipe'
  return `You are a cook helping a household ${goal}, in a way that suits this dish and its cuisine.

RECIPE: ${recipe.name}${recipe.cuisine ? ` (${recipe.cuisine})` : ''}, serves ${recipe.servings ?? 'unknown'}
INGREDIENTS (exact names in quotes):
${recipe.ingredients.map((i) => `- "${i.name}": ${line(i)}`).join('\n')}
STEPS:
${recipe.steps.map((s, n) => `${n + 1}. ${s}`).join('\n')}

Suggest 3 or 4 DIFFERENT options (different proteins or approaches), the best fit first.${avoid.length ? `\nDo not repeat these options: ${avoid.join('; ')}.` : ''}
Each option changes only what it must. Every change has a kind:
- "portion": the protein itself (e.g. chicken thighs → halloumi). Amounts for the whole recipe.
- "shared": anything that goes into the whole dish and so cannot be split between servings: stock, broth or bouillon, fish sauce, oyster sauce, Worcestershire sauce, anchovies in a sauce, gelatine, lard, bacon fat or other animal fat used for cooking.${direction === 'to_vegetarian' ? ' Every non-vegetarian shared ingredient MUST get a shared change.' : ''}
"replaces" lists the exact ingredient names (as quoted above) that the change replaces; [] adds something new. "add" is the new ingredient, or null to only remove.

Also rewrite the steps twice, in English, concise, in your own words, keeping step count and order where possible and keeping any {{temp:…}} markers as they are:
- "steps_all": the whole recipe with this option.
- "steps_half": half the servings keep the original protein and half get the new one, cooked side by side where needed; ${direction === 'to_vegetarian' ? 'shared ingredients are the vegetarian version for everyone' : 'shared ingredients stay vegetarian for everyone'}. Say clearly which pan or portion each step is for.

Reply only with JSON:
{"options":[{"title":"short name, e.g. 'Halloumi instead of chicken' (max 60 characters)","summary":"one sentence on why it suits the dish (max 200 characters)","changes":[{"kind":"portion","replaces":["Chicken thighs"],"add":{"name":"Halloumi","canonical_name":"halloumi","quantity":400,"unit":"g","preparation":"sliced"}}],"steps_all":["..."],"steps_half":["..."]}]}`
}

const str = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null
  const t = v.trim().replace(/\s+/g, ' ')
  return t ? t.slice(0, max) : null
}
const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null
}
const steps = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((s) => str(s, 600)).filter((s): s is string => !!s).slice(0, 30) : []

/**
 * Checks Gemini's reply and keeps only usable options (at most 4): a title, at least one
 * change, replaced names that exist in the recipe (others dropped), and an added ingredient
 * with a name. Returns [] when nothing is usable.
 */
export function checkSwapOptions(reply: Json, ingredientNames: string[]): SwapOption[] {
  const known = new Map(ingredientNames.map((n) => [n.trim().toLowerCase(), n]))
  const options: SwapOption[] = []
  for (const o of Array.isArray(reply?.options) ? reply.options : []) {
    const title = str(o?.title, 80)
    if (!title) continue
    const changes: SwapChange[] = []
    for (const c of Array.isArray(o?.changes) ? o.changes : []) {
      const kind = c?.kind === 'shared' ? 'shared' : c?.kind === 'portion' ? 'portion' : null
      if (!kind) continue
      const asked = Array.isArray(c?.replaces) ? c.replaces : []
      const replaces = asked.map((r: unknown) => known.get(String(r ?? '').trim().toLowerCase())).filter((r: string | undefined): r is string => !!r)
      if (asked.length > 0 && replaces.length === 0) continue // names an ingredient the recipe doesn't have
      const addName = str(c?.add?.name, 120)
      const add: SwapIngredient | null = addName
        ? {
            name: addName,
            canonical_name: str(c.add.canonical_name, 120),
            quantity: num(c.add.quantity),
            unit: str(c.add.unit, 30),
            preparation: str(c.add.preparation, 120),
          }
        : null
      if (!add && replaces.length === 0) continue
      changes.push({ kind, replaces, add })
    }
    if (changes.length === 0) continue
    options.push({ title, summary: str(o?.summary, 300), changes, steps_all: steps(o?.steps_all), steps_half: steps(o?.steps_half) })
    if (options.length === 4) break
  }
  return options
}
