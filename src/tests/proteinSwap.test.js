import { describe, it, expect } from 'vitest'
import { SWAP_MODES, swapModesFor, applySwap, swapIngredientsMap } from '@/lib/proteinSwap'

// A recipe's ingredients as the app loads them (amounts for the recipe's own servings).
const ing = (id, name, quantity, unit = null, extra = {}) => ({
  id, name, canonical_name: name.toLowerCase(), quantity, unit, preparation: null, display_order: Number(id), ...extra,
})
const recipe = {
  ingredients: [
    ing('1', 'Chicken thighs', 500, 'g'),
    ing('2', 'Chicken stock', 500, 'mL'),
    ing('3', 'Onion', 1),
    ing('4', 'Fish sauce', 1, 'tbsp'),
  ],
  steps: ['Brown the chicken.', 'Add the stock and simmer.'],
}

// A saved Gemini option (recipe_swaps row): each change is a "portion" change (the
// protein itself, split in Half & half) or a "shared" change (goes into the whole dish).
const toVeg = {
  direction: 'to_vegetarian',
  changes: [
    { kind: 'portion', replaces: ['Chicken thighs'], add: { name: 'Halloumi', canonical_name: 'halloumi', quantity: 400, unit: 'g', preparation: 'sliced' } },
    { kind: 'shared', replaces: ['Chicken stock'], add: { name: 'Vegetable stock', canonical_name: 'vegetable stock', quantity: 500, unit: 'mL', preparation: null } },
    { kind: 'shared', replaces: ['Fish sauce'], add: { name: 'Soy sauce', canonical_name: 'soy sauce', quantity: 1, unit: 'tbsp', preparation: null } },
  ],
  steps_all: ['Fry the halloumi.', 'Add the vegetable stock and simmer.'],
  steps_half: ['Brown the chicken in one pan and fry the halloumi in another.', 'Add the vegetable stock to both and simmer.'],
}

const names = (list) => list.map(i => `${i.name}${i.quantity != null ? ` ${i.quantity}` : ''}`)

describe('swapModesFor', () => {
  it('offers vegetarian swaps for a recipe with meat or fish', () => {
    expect(swapModesFor({ protein_source: 'Chicken' })).toEqual({ direction: 'to_vegetarian', modes: ['original', 'all', 'half'] })
    expect(swapModesFor({ protein_source: 'Seafood' }).direction).toBe('to_vegetarian')
  })

  it('offers meat swaps for a vegetarian recipe', () => {
    expect(swapModesFor({ protein_source: 'Vegetarian' })).toEqual({ direction: 'to_meat', modes: ['original', 'all', 'half'] })
  })

  it('offers nothing when the protein is unknown', () => {
    expect(swapModesFor({ protein_source: null })).toBeNull()
    expect(swapModesFor({})).toBeNull()
  })

  it('names the modes for both directions', () => {
    expect(SWAP_MODES.to_vegetarian.all).toBe('All vegetarian')
    expect(SWAP_MODES.to_meat.all).toBe('All with meat')
    expect(SWAP_MODES.to_vegetarian.half).toBe('Half & half')
  })
})

describe('applySwap', () => {
  it('changes nothing for the original or without a swap', () => {
    expect(applySwap({ ...recipe, swap: toVeg, mode: 'original' })).toEqual(recipe)
    expect(applySwap({ ...recipe, swap: null, mode: 'all' })).toEqual(recipe)
  })

  it('All vegetarian: replaces the protein and every shared ingredient, and uses the swap steps', () => {
    const out = applySwap({ ...recipe, swap: toVeg, mode: 'all' })
    expect(names(out.ingredients)).toEqual(['Halloumi 400', 'Vegetable stock 500', 'Onion 1', 'Soy sauce 1'])
    expect(out.steps).toEqual(toVeg.steps_all)
  })

  it('keeps each new ingredient where the one it replaces was', () => {
    const out = applySwap({ ...recipe, swap: toVeg, mode: 'all' })
    expect(out.ingredients.map(i => i.display_order)).toEqual([1, 2, 3, 4])
  })

  it('marks what the swap added, with ids that cannot clash with real ones', () => {
    const out = applySwap({ ...recipe, swap: toVeg, mode: 'all' })
    expect(out.ingredients[0]).toMatchObject({ id: 'swap:0', swap: 'added', preparation: 'sliced' })
    expect(out.ingredients[2]).toEqual(recipe.ingredients[2])
  })

  it('Half & half to vegetarian: halves the protein both ways, but shared ingredients go fully vegetarian', () => {
    const out = applySwap({ ...recipe, swap: toVeg, mode: 'half' })
    expect(names(out.ingredients)).toEqual(['Chicken thighs 250', 'Halloumi 200', 'Vegetable stock 500', 'Onion 1', 'Soy sauce 1'])
    expect(out.ingredients[0].swap).toBe('halved')
    expect(out.steps).toEqual(toVeg.steps_half)
  })

  const toMeat = {
    direction: 'to_meat',
    changes: [
      { kind: 'portion', replaces: ['Chickpeas'], add: { name: 'Chicken breast', canonical_name: 'chicken', quantity: 300, unit: 'g', preparation: null } },
      { kind: 'shared', replaces: ['Vegetable stock'], add: { name: 'Chicken stock', canonical_name: 'chicken stock', quantity: 500, unit: 'mL', preparation: null } },
    ],
    steps_all: ['Cook the chicken.'],
    steps_half: null,
  }
  const veggie = {
    ingredients: [ing('1', 'Chickpeas', 2, 'can'), ing('2', 'Vegetable stock', 500, 'mL')],
    steps: ['Simmer the chickpeas.'],
  }

  it('All with meat: shared changes apply', () => {
    const out = applySwap({ ...veggie, swap: toMeat, mode: 'all' })
    expect(names(out.ingredients)).toEqual(['Chicken breast 300', 'Chicken stock 500'])
  })

  it('Half & half to meat: the shared base stays vegetarian, so the vegetarian half really is', () => {
    const out = applySwap({ ...veggie, swap: toMeat, mode: 'half' })
    expect(names(out.ingredients)).toEqual(['Chickpeas 1', 'Chicken breast 150', 'Vegetable stock 500'])
  })

  it('falls back to the all steps, then the recipe steps, when a step list is missing', () => {
    expect(applySwap({ ...veggie, swap: toMeat, mode: 'half' }).steps).toEqual(['Cook the chicken.'])
    expect(applySwap({ ...veggie, swap: { ...toMeat, steps_all: null }, mode: 'all' }).steps).toEqual(veggie.steps)
  })

  it('matches the replaced ingredient by name or base name, ignoring case and spaces', () => {
    const swap = { ...toVeg, changes: [{ kind: 'portion', replaces: ['  chicken THIGHS '], add: toVeg.changes[0].add }] }
    expect(names(applySwap({ ...recipe, swap, mode: 'all' }).ingredients)[0]).toBe('Halloumi 400')
    const byBase = { ...toVeg, changes: [{ kind: 'shared', replaces: ['chicken stock'], add: null }] }
    expect(names(applySwap({ ...recipe, swap: byBase, mode: 'all' }).ingredients)).toEqual(['Chicken thighs 500', 'Onion 1', 'Fish sauce 1'])
  })

  it('a change that only removes: gone in All, halved in Half & half for a portion change', () => {
    const swap = { ...toVeg, changes: [{ kind: 'portion', replaces: ['Chicken thighs'], add: null }] }
    expect(names(applySwap({ ...recipe, swap, mode: 'all' }).ingredients)).toEqual(['Chicken stock 500', 'Onion 1', 'Fish sauce 1'])
    expect(names(applySwap({ ...recipe, swap, mode: 'half' }).ingredients)[0]).toBe('Chicken thighs 250')
  })

  it('a change that only adds: added at the end, halved in Half & half for a portion change', () => {
    const swap = { ...toVeg, changes: [{ kind: 'portion', replaces: [], add: { name: 'Tofu', canonical_name: 'tofu', quantity: 300, unit: 'g', preparation: null } }] }
    expect(names(applySwap({ ...recipe, swap, mode: 'all' }).ingredients).at(-1)).toBe('Tofu 300')
    expect(names(applySwap({ ...recipe, swap, mode: 'half' }).ingredients).at(-1)).toBe('Tofu 150')
  })

  it('keeps an unknown amount unknown when halving', () => {
    const r = { ingredients: [ing('1', 'Chicken thighs', null)], steps: [] }
    expect(applySwap({ ...r, swap: toVeg, mode: 'half' }).ingredients[0].quantity).toBeNull()
  })

  it('ignores a change whose ingredient is not in the recipe (no add, no remove)', () => {
    const swap = { ...toVeg, changes: [{ kind: 'portion', replaces: ['Beef'], add: { name: 'Tofu', canonical_name: 'tofu', quantity: 300, unit: 'g', preparation: null } }] }
    expect(applySwap({ ...recipe, swap, mode: 'all' }).ingredients).toEqual(recipe.ingredients)
  })

  it('never changes the lists it was given', () => {
    const copy = JSON.parse(JSON.stringify(recipe))
    applySwap({ ...recipe, swap: toVeg, mode: 'half' })
    expect(recipe).toEqual(copy)
  })
})

describe('swapIngredientsMap', () => {
  // The Shopping tab and the AH preview merge ingredients per recipe; a swapped pick's
  // ingredients go through applySwap first.
  const map = { r1: recipe.ingredients, r2: [ing('9', 'Rice', 150, 'g')] }

  it('swaps the ingredients of picks that have a swap, leaves the others alone', () => {
    const out = swapIngredientsMap(
      [{ recipe_id: 'r1', servings: 2, swap_id: 's1', swap_mode: 'all' }, { recipe_id: 'r2', servings: 2 }],
      map,
      { s1: toVeg },
    )
    expect(names(out.r1)).toEqual(['Halloumi 400', 'Vegetable stock 500', 'Onion 1', 'Soy sauce 1'])
    expect(out.r2).toBe(map.r2)
  })

  it('uses the original when the swap is not loaded (yet)', () => {
    const out = swapIngredientsMap([{ recipe_id: 'r1', servings: 2, swap_id: 'gone', swap_mode: 'half' }], map, {})
    expect(out.r1).toBe(map.r1)
  })

  it('does not change the map it was given', () => {
    swapIngredientsMap([{ recipe_id: 'r1', servings: 2, swap_id: 's1', swap_mode: 'half' }], map, { s1: toVeg })
    expect(map.r1).toBe(recipe.ingredients)
  })
})
