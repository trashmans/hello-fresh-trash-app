import { describe, it, expect } from 'vitest'
import { SUGGEST_LIMIT, unmappedLines, pickSuggestion } from '@/lib/mappingSuggestions'

// Preview lines as buildWeekPreview() returns them (only the fields used here).
const change = (over) => ({ productId: null, text: 'garlic', title: 'garlic', sources: ['recipe'], ...over })
const onList = (over) => ({ productId: null, text: 'limes', title: 'limes', ...over })

describe('unmappedLines', () => {
  it('lists recipe lines that are still free text, from the changes and the AH list', () => {
    const preview = {
      changes: [change({ text: 'garlic' }), change({ text: 'olive oil', productId: 12 }), change({ text: 'AH Bananen', sources: ['staple'] })],
      onListAlready: [onList({ text: 'limes' }), onList({ text: 'AH Halfvolle melk', productId: 101 })],
    }
    expect(unmappedLines(preview)).toEqual(['garlic', 'limes'])
  })

  it('lists each ingredient once, ignoring case and spaces', () => {
    const preview = { changes: [change({ text: 'Garlic' }), change({ text: ' garlic ' })], onListAlready: [onList({ text: 'GARLIC' })] }
    expect(unmappedLines(preview)).toEqual(['Garlic'])
  })

  it(`stops at ${SUGGEST_LIMIT} ingredients`, () => {
    const many = Array.from({ length: SUGGEST_LIMIT + 3 }, (_, i) => change({ text: `item ${i}` }))
    expect(unmappedLines({ changes: many, onListAlready: [] })).toHaveLength(SUGGEST_LIMIT)
  })

  it('leaves out ingredients already looked at, so the next batch moves on', () => {
    const many = Array.from({ length: SUGGEST_LIMIT + 3 }, (_, i) => change({ text: `item ${i}` }))
    const first = unmappedLines({ changes: many, onListAlready: [] })
    const next = unmappedLines({ changes: many, onListAlready: [] }, { skip: first.map(n => n.toUpperCase()) })
    expect(next).toEqual(['item 15', 'item 16', 'item 17'])
  })

  it('copes with no preview or empty parts', () => {
    expect(unmappedLines(null)).toEqual([])
    expect(unmappedLines({})).toEqual([])
  })
})

describe('pickSuggestion', () => {
  const p = (id, title) => ({ externalId: id, title })

  it('prefers a product whose name has every word of the Dutch search term', () => {
    const products = [p(1, 'AH Knoflookpoeder'), p(2, 'Verstegen Knoflook gemalen'), p(3, 'AH Knoflook')]
    expect(pickSuggestion({ products, searchedFor: ['knoflook', 'garlic'] })).toEqual({ product: products[2], sure: true })
  })

  it('matches whole words, so "knoflook" does not match "knoflookpoeder"', () => {
    const products = [p(1, 'AH Knoflookpoeder'), p(2, 'Knoflook teentjes')]
    expect(pickSuggestion({ products, searchedFor: ['knoflook'] }).product.externalId).toBe(2)
  })

  it('prefers the AH house brand when several match', () => {
    const products = [p(1, 'Bertolli Olijfolie'), p(2, 'AH Olijfolie')]
    expect(pickSuggestion({ products, searchedFor: ['olijfolie'] }).product.externalId).toBe(2)
  })

  it("keeps AH's own order otherwise", () => {
    const products = [p(1, 'AH Limoenen'), p(2, 'AH Biologisch Limoenen')]
    expect(pickSuggestion({ products, searchedFor: ['limoenen'] }).product.externalId).toBe(1)
  })

  it('falls back to the first result, marked as not sure, when nothing has every word', () => {
    const products = [p(1, 'AH Rode pesto'), p(2, 'AH Pesto verde')]
    expect(pickSuggestion({ products, searchedFor: ['basilicum pesto'] })).toEqual({ product: products[0], sure: false })
  })

  it('ignores case and accents in the match', () => {
    const products = [p(1, 'AH Crème fraîche')]
    expect(pickSuggestion({ products, searchedFor: ['creme fraiche'] }).sure).toBe(true)
  })

  it('suggests nothing when AH found nothing', () => {
    expect(pickSuggestion({ products: [], searchedFor: ['saffraan'] })).toBeNull()
    expect(pickSuggestion({})).toBeNull()
  })
})
