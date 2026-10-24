import { describe, it, expect } from 'vitest'
import { mergeTargetLines, diffList } from '@/lib/listDiff'

// Target lines come from the planner: due staples, bonus stock-ups, recipe packs.
// A line is either a product ({ productId, packs }) or free text ({ text, packs }).
describe('mergeTargetLines', () => {
  it('adds up lines for the same product and keeps where they came from', () => {
    expect(mergeTargetLines([
      { productId: 1525, packs: 1, source: 'staple' },
      { productId: 1525, packs: 2, source: 'recipe' },
    ])).toEqual([
      { productId: 1525, text: null, packs: 3, sources: ['staple', 'recipe'] },
    ])
  })

  it('treats a product id given as text the same as a number', () => {
    expect(mergeTargetLines([
      { productId: '1525', packs: 1, source: 'staple' },
      { productId: 1525, packs: 1, source: 'recipe' },
    ])).toHaveLength(1)
  })

  it('merges free-text lines ignoring case and extra spaces', () => {
    expect(mergeTargetLines([
      { text: 'Fresh basil', packs: 1, source: 'recipe' },
      { text: '  fresh   BASIL ', packs: 1, source: 'recipe' },
    ])).toEqual([
      { productId: null, text: 'Fresh basil', packs: 2, sources: ['recipe', 'recipe'] },
    ])
  })

  it('never merges a free-text line into a product line', () => {
    expect(mergeTargetLines([
      { productId: 1525, packs: 1, source: 'staple' },
      { text: '1525', packs: 1, source: 'recipe' },
    ])).toHaveLength(2)
  })

  it('drops lines with no packs and keeps first-seen order', () => {
    expect(mergeTargetLines([
      { productId: 2, packs: 0, source: 'staple' },
      { productId: 3, packs: 1, source: 'staple' },
      { text: 'limes', packs: 2, source: 'recipe' },
      { productId: 1, packs: -1, source: 'staple' },
    ]).map(l => l.productId ?? l.text)).toEqual([3, 'limes'])
  })
})

// The current AH list, already normalised by the adapter:
// { productId | null, text, quantity, ticked }
const onList = (overrides) => ({ productId: null, text: null, quantity: 1, ticked: false, ...overrides })

describe('diffList', () => {
  it('adds products that are not on the list', () => {
    expect(diffList([{ productId: 1525, text: null, packs: 2 }], [])).toEqual([
      { action: 'add', productId: 1525, text: null, from: 0, to: 2 },
    ])
  })

  it('adds free-text lines that are not on the list', () => {
    expect(diffList([{ productId: null, text: 'fresh basil', packs: 1 }], [])).toEqual([
      { action: 'add', productId: null, text: 'fresh basil', from: 0, to: 1 },
    ])
  })

  it('changes nothing when the list already has enough', () => {
    const current = [onList({ productId: 1525, quantity: 2 })]
    expect(diffList([{ productId: 1525, text: null, packs: 2 }], current)).toEqual([])
    expect(diffList([{ productId: 1525, text: null, packs: 1 }], current)).toEqual([])
  })

  it('raises the quantity when the list has fewer', () => {
    const current = [onList({ productId: 1525, quantity: 1 })]
    expect(diffList([{ productId: 1525, text: null, packs: 3 }], current)).toEqual([
      { action: 'increase', productId: 1525, text: null, from: 1, to: 3 },
    ])
  })

  it('unticks a ticked item and sets the target quantity', () => {
    const current = [onList({ productId: 1525, quantity: 4, ticked: true })]
    expect(diffList([{ productId: 1525, text: null, packs: 2 }], current)).toEqual([
      { action: 'untick', productId: 1525, text: null, from: 0, to: 2 },
    ])
  })

  it('matches free-text lines by text, ignoring case and spaces', () => {
    const current = [onList({ text: 'Fresh  Basil', quantity: 1 })]
    expect(diffList([{ productId: null, text: 'fresh basil', packs: 1 }], current)).toEqual([])
  })

  it('does not match a free-text target to a product line with similar text', () => {
    const current = [onList({ productId: 99, text: 'basil', quantity: 1 })]
    expect(diffList([{ productId: null, text: 'basil', packs: 1 }], current)).toEqual([
      { action: 'add', productId: null, text: 'basil', from: 0, to: 1 },
    ])
  })

  it('never removes or changes items that are not in the target', () => {
    const current = [
      onList({ productId: 111, quantity: 3 }),
      onList({ text: 'birthday candles', quantity: 1 }),
    ]
    expect(diffList([], current)).toEqual([])
  })

  it('treats product ids given as text the same as numbers', () => {
    const current = [onList({ productId: '1525', quantity: 2 })]
    expect(diffList([{ productId: 1525, text: null, packs: 2 }], current)).toEqual([])
  })

  it('returns changes in target order', () => {
    const changes = diffList([
      { productId: 3, text: null, packs: 1 },
      { productId: null, text: 'limes', packs: 2 },
      { productId: 1, text: null, packs: 1 },
    ], [])
    expect(changes.map(c => c.productId ?? c.text)).toEqual([3, 'limes', 1])
  })

  it('gives an empty diff when run again after its changes are applied', () => {
    const target = [
      { productId: 1525, text: null, packs: 2 },
      { productId: 777, text: null, packs: 1 },
      { productId: null, text: 'fresh basil', packs: 1 },
    ]
    let current = [
      onList({ productId: 1525, quantity: 1, ticked: true }),
      onList({ productId: 42, quantity: 5 }),
    ]

    const first = diffList(target, current)
    expect(first).toHaveLength(3)

    // Apply the changes the way AH does: setting a quantity on an existing line, or adding a new one
    for (const change of first) {
      const existing = current.find(i =>
        change.productId != null ? String(i.productId) === String(change.productId) : i.text === change.text)
      if (existing) Object.assign(existing, { quantity: change.to, ticked: false })
      else current = [...current, onList({ productId: change.productId, text: change.text, quantity: change.to })]
    }

    expect(diffList(target, current)).toEqual([])
  })
})
