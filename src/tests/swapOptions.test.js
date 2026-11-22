// @vitest-environment node
// Protein swaps (docs/adr/0010): the prompt for Gemini and the check of its reply.
import { describe, it, expect } from 'vitest'
import { swapPrompt, checkSwapOptions } from '../../supabase/functions/_shared/swapOptions.ts'

const recipe = {
  name: 'Chicken Pho', cuisine: 'Vietnamese', protein_source: 'Chicken', servings: 2,
  ingredients: [
    { name: 'Chicken thighs', quantity: 300, unit: 'g', preparation: 'sliced' },
    { name: 'Chicken stock', quantity: 1, unit: 'l', preparation: null },
    { name: 'Fish sauce', quantity: 1, unit: 'tbsp', preparation: null },
  ],
  steps: ['Simmer the stock.', 'Poach the chicken.'],
}
const NAMES = recipe.ingredients.map(i => i.name)

describe('swapPrompt', () => {
  it('quotes the exact ingredient names and lists the steps', () => {
    const p = swapPrompt(recipe, 'to_vegetarian')
    expect(p).toContain('"Chicken stock": 1 l Chicken stock')
    expect(p).toContain('1. Simmer the stock.')
    expect(p).toContain('Chicken Pho (Vietnamese), serves 2')
  })

  it('asks for a vegetarian dish with every shared ingredient changed, and a vegetarian shared base in half & half', () => {
    const p = swapPrompt(recipe, 'to_vegetarian')
    expect(p).toMatch(/VEGETARIAN/)
    expect(p).toMatch(/Every non-vegetarian shared ingredient MUST get a shared change/)
    expect(p).toMatch(/shared ingredients are the vegetarian version for everyone/)
  })

  it('going to meat, keeps the shared base vegetarian in half & half', () => {
    const p = swapPrompt({ ...recipe, protein_source: 'Vegetarian' }, 'to_meat')
    expect(p).toMatch(/add MEAT, POULTRY OR FISH/)
    expect(p).toMatch(/shared ingredients stay vegetarian for everyone/)
    expect(p).not.toMatch(/MUST get a shared change/)
  })

  it('names options to avoid when asked for other options', () => {
    expect(swapPrompt(recipe, 'to_vegetarian', ['Tofu instead of chicken'])).toContain('Do not repeat these options: Tofu instead of chicken')
  })
})

const option = (over = {}) => ({
  title: 'Tofu instead of chicken',
  summary: 'Silken tofu soaks up the broth.',
  changes: [
    { kind: 'portion', replaces: ['Chicken thighs'], add: { name: 'Firm tofu', canonical_name: 'tofu', quantity: '300', unit: 'g', preparation: 'cubed' } },
    { kind: 'shared', replaces: ['chicken stock'], add: { name: 'Vegetable stock', canonical_name: 'vegetable stock', quantity: 1, unit: 'l', preparation: null } },
  ],
  steps_all: ['Simmer the vegetable stock.', 'Add the tofu.'],
  steps_half: ['Simmer the vegetable stock.', 'Poach the chicken in one pot, warm the tofu in another.'],
  ...over,
})

describe('checkSwapOptions', () => {
  it('keeps a good option, tidying numbers and matching names to the recipe', () => {
    const [o] = checkSwapOptions({ options: [option()] }, NAMES)
    expect(o.title).toBe('Tofu instead of chicken')
    expect(o.changes[0].add.quantity).toBe(300)
    expect(o.changes[1].replaces).toEqual(['Chicken stock'])
    expect(o.steps_half).toHaveLength(2)
  })

  it('drops a change that names an ingredient the recipe does not have', () => {
    const [o] = checkSwapOptions({ options: [option({ changes: [...option().changes, { kind: 'portion', replaces: ['Beef'], add: { name: 'Seitan' } }] })] }, NAMES)
    expect(o.changes).toHaveLength(2)
  })

  it('keeps add-only and remove-only changes, drops empty ones and unknown kinds', () => {
    const [o] = checkSwapOptions({ options: [option({ changes: [
      { kind: 'portion', replaces: [], add: { name: 'Edamame', quantity: 100, unit: 'g' } },
      { kind: 'shared', replaces: ['Fish sauce'], add: null },
      { kind: 'portion', replaces: [], add: null },
      { kind: 'garnish', replaces: ['Fish sauce'], add: null },
    ] })] }, NAMES)
    expect(o.changes.map(c => c.kind)).toEqual(['portion', 'shared'])
    expect(o.changes[0].add).toEqual({ name: 'Edamame', canonical_name: null, quantity: 100, unit: 'g', preparation: null })
  })

  it('drops options without a title or without usable changes, and keeps at most 4', () => {
    const many = Array.from({ length: 6 }, (_, i) => option({ title: `Option ${i}` }))
    expect(checkSwapOptions({ options: [option({ title: '' }), option({ changes: [] }), ...many] }, NAMES).map(o => o.title))
      .toEqual(['Option 0', 'Option 1', 'Option 2', 'Option 3'])
  })

  it('gives [] for a reply that is not what was asked', () => {
    expect(checkSwapOptions(null, NAMES)).toEqual([])
    expect(checkSwapOptions({ options: 'nope' }, NAMES)).toEqual([])
  })

  it('cuts long text to size', () => {
    const [o] = checkSwapOptions({ options: [option({ title: 'x'.repeat(200), summary: 'y'.repeat(500) })] }, NAMES)
    expect(o.title).toHaveLength(80)
    expect(o.summary).toHaveLength(300)
  })
})
