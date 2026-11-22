// Protein swaps (docs/adr/0010): turning a recipe vegetarian, adding meat to a vegetarian
// one, or half and half, from an option Gemini suggested (a public.recipe_swaps row).
// Each change in an option is either:
//   portion  the protein itself; in Half & half half the servings keep the original
//   shared   something that goes into the whole dish (stock, fish sauce, frying fat…);
//            it switches as soon as any serving is vegetarian, so going vegetarian it
//            applies in All and Half & half, going to meat only in All (the shared base
//            stays vegetarian so the vegetarian half really is)
// Amounts are for the recipe's own servings; scaling happens afterwards as usual.
// Pure: no I/O, never changes its inputs.

export const SWAP_MODES = {
  to_vegetarian: { original: 'Original', all: 'All vegetarian', half: 'Half & half' },
  to_meat: { original: 'Original', all: 'All with meat', half: 'Half & half' },
}

/** Which way a recipe can be swapped, or null when its protein is unknown. */
export function swapModesFor(recipe) {
  const protein = recipe?.protein_source
  if (!protein) return null
  return { direction: protein === 'Vegetarian' ? 'to_meat' : 'to_vegetarian', modes: ['original', 'all', 'half'] }
}

const norm = (text) => String(text ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
const halve = (q) => (q == null ? null : q / 2)

/** → { ingredients, steps } for the recipe with this swap in this mode ('original' | 'all' | 'half'). */
export function applySwap({ ingredients, steps, swap, mode }) {
  if (!swap || (mode !== 'all' && mode !== 'half')) return { ingredients, steps }

  const half = mode === 'half'
  const sharedApplies = mode === 'all' || swap.direction === 'to_vegetarian'
  const list = (ingredients ?? []).map((i) => ({ ...i }))
  let maxOrder = list.reduce((m, i) => Math.max(m, Number(i.display_order) || 0), 0)
  let added = 0

  for (const change of swap.changes ?? []) {
    const shared = change.kind === 'shared'
    if (shared && !sharedApplies) continue
    const split = half && !shared
    const targets = (change.replaces ?? []).map(norm).filter(Boolean)
    const matched = []
    list.forEach((item, index) => {
      if (targets.includes(norm(item.name)) || (item.canonical_name && targets.includes(norm(item.canonical_name)))) matched.push(index)
    })
    // A change for an ingredient this recipe doesn't have is ignored altogether.
    if (targets.length > 0 && matched.length === 0) continue

    let insertAt = list.length
    let order = maxOrder + 1
    if (matched.length > 0) {
      order = list[matched[0]].display_order
      if (split) {
        for (const index of matched) list[index] = { ...list[index], quantity: halve(list[index].quantity), swap: 'halved' }
        insertAt = matched[matched.length - 1] + 1
      } else {
        for (const index of [...matched].reverse()) list.splice(index, 1)
        insertAt = matched[0]
      }
    } else {
      maxOrder = order
    }

    if (change.add) {
      const a = change.add
      list.splice(insertAt, 0, {
        id: `swap:${added++}`,
        name: a.name,
        canonical_name: a.canonical_name ?? null,
        quantity: split ? halve(a.quantity ?? null) : (a.quantity ?? null),
        unit: a.unit ?? null,
        preparation: a.preparation ?? null,
        display_order: order,
        swap: 'added',
      })
    }
  }

  const pick = (...options) => options.find((s) => Array.isArray(s) && s.length > 0)
  const swappedSteps = half ? pick(swap.steps_half, swap.steps_all, steps) : pick(swap.steps_all, steps)
  return { ingredients: list, steps: swappedSteps ?? steps }
}

// Applies each pick's protein swap to its recipe's ingredients, for the
// shopping list and the AH preview. Picks without a swap, or whose swap is
// not loaded (yet), keep the original ingredients. Returns a new map.
export function swapIngredientsMap(selections, ingredientsMap, swapsById) {
  const out = { ...ingredientsMap }
  for (const s of selections ?? []) {
    const swap = s?.swap_id ? swapsById?.[s.swap_id] : null
    if (!swap || !out[s.recipe_id]) continue
    out[s.recipe_id] = applySwap({ ingredients: out[s.recipe_id], steps: [], swap, mode: s.swap_mode }).ingredients
  }
  return out
}
