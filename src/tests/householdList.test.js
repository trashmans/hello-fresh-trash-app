import { describe, it, expect } from 'vitest'
import { toListState, diffListState, mergeRemote } from '@/lib/householdList'

const state = (recipeSelections = [], adjustedItems = []) => ({ recipeSelections, adjustedItems })
const pick = (recipe_id, servings = 2) => ({ recipe_id, servings })
const adj = (key, buy_qty) => ({ key, buy_qty })

describe('toListState', () => {
  it('turns household rows into the shopping list state', () => {
    const picks = [
      { recipe_id: 'r1', servings: 2, added_at: '2026-11-10T10:00:00Z' },
      { recipe_id: 'r2', servings: 0.5, added_at: '2026-11-11T10:00:00Z' },
    ]
    const adjustments = [
      { item_key: 'olive oil|volume:metric', buy_qty: 0 },
      { item_key: 'garlic|count:', buy_qty: 3 },
    ]
    expect(toListState(picks, adjustments)).toEqual(
      state([pick('r1', 2), pick('r2', 0.5)], [adj('olive oil|volume:metric', 0), adj('garlic|count:', 3)])
    )
  })

  it('orders picks by when they were added, oldest first', () => {
    const picks = [
      { recipe_id: 'late', servings: 2, added_at: '2026-11-12T10:00:00Z' },
      { recipe_id: 'early', servings: 2, added_at: '2026-11-01T10:00:00Z' },
      { recipe_id: 'middle', servings: 2, added_at: '2026-11-05T10:00:00Z' },
    ]
    expect(toListState(picks, []).recipeSelections.map(r => r.recipe_id)).toEqual(['early', 'middle', 'late'])
  })

  it('breaks added_at ties by recipe id, so both members see the same order', () => {
    const at = '2026-11-12T10:00:00Z'
    const picks = [
      { recipe_id: 'b', servings: 2, added_at: at },
      { recipe_id: 'a', servings: 2, added_at: at },
    ]
    expect(toListState(picks, []).recipeSelections.map(r => r.recipe_id)).toEqual(['a', 'b'])
  })

  it('reads numbers that arrive as text', () => {
    const result = toListState(
      [{ recipe_id: 'r1', servings: '1.5', added_at: '2026-11-10T10:00:00Z' }],
      [{ item_key: 'k', buy_qty: '0' }]
    )
    expect(result).toEqual(state([pick('r1', 1.5)], [adj('k', 0)]))
  })

  it('gives an empty list for missing rows', () => {
    expect(toListState(null, undefined)).toEqual(state())
    expect(toListState()).toEqual(state())
  })

  it('does not change the rows it was given', () => {
    const picks = [
      { recipe_id: 'b', servings: 2, added_at: '2026-11-12T10:00:00Z' },
      { recipe_id: 'a', servings: 2, added_at: '2026-11-01T10:00:00Z' },
    ]
    toListState(picks, [])
    expect(picks.map(p => p.recipe_id)).toEqual(['b', 'a'])
  })
})

describe('diffListState', () => {
  it('gives no writes when nothing changed', () => {
    const s = state([pick('r1')], [adj('k', 0)])
    expect(diffListState(s, state([pick('r1')], [adj('k', 0)]))).toEqual([])
  })

  it('adds a newly picked recipe', () => {
    expect(diffListState(state([pick('r1')]), state([pick('r1'), pick('r2', 4)]))).toEqual([
      { type: 'addPick', recipe_id: 'r2', servings: 4 },
    ])
  })

  it('removes an unpicked recipe', () => {
    expect(diffListState(state([pick('r1'), pick('r2')]), state([pick('r2')]))).toEqual([
      { type: 'removePick', recipe_id: 'r1' },
    ])
  })

  it('changes servings without re-adding the recipe', () => {
    expect(diffListState(state([pick('r1', 2)]), state([pick('r1', 3)]))).toEqual([
      { type: 'setPickServings', recipe_id: 'r1', servings: 3 },
    ])
  })

  it('sets a new or changed adjustment, keeping 0 (checked off)', () => {
    const base = state([], [adj('a', 2)])
    const next = state([], [adj('a', 5), adj('b', 0)])
    expect(diffListState(base, next)).toEqual([
      { type: 'setAdjustment', item_key: 'a', buy_qty: 5 },
      { type: 'setAdjustment', item_key: 'b', buy_qty: 0 },
    ])
  })

  it('removes an adjustment that was reset', () => {
    expect(diffListState(state([], [adj('a', 2), adj('b', 0)]), state([], [adj('a', 2)]))).toEqual([
      { type: 'removeAdjustment', item_key: 'b' },
    ])
  })

  it('only touches the rows that changed', () => {
    const base = state([pick('r1'), pick('r2'), pick('r3')], [adj('a', 1), adj('b', 0)])
    const next = state([pick('r1'), pick('r3', 4), pick('r4')], [adj('a', 1)])
    const ops = diffListState(base, next)
    expect(ops).toHaveLength(4)
    expect(ops).toEqual(expect.arrayContaining([
      { type: 'removePick', recipe_id: 'r2' },
      { type: 'setPickServings', recipe_id: 'r3', servings: 4 },
      { type: 'addPick', recipe_id: 'r4', servings: 2 },
      { type: 'removeAdjustment', item_key: 'b' },
    ]))
  })

  it('ignores a change of order', () => {
    expect(diffListState(state([pick('r1'), pick('r2')]), state([pick('r2'), pick('r1')]))).toEqual([])
  })

  it('uses the last entry when a recipe or item appears twice', () => {
    const next = state([pick('r1', 2), pick('r1', 4)], [adj('k', 1), adj('k', 2)])
    expect(diffListState(state(), next)).toEqual([
      { type: 'addPick', recipe_id: 'r1', servings: 4 },
      { type: 'setAdjustment', item_key: 'k', buy_qty: 2 },
    ])
  })

  it('defaults missing servings to 2, like adding a recipe does', () => {
    expect(diffListState(state(), state([{ recipe_id: 'r1' }]))).toEqual([
      { type: 'addPick', recipe_id: 'r1', servings: 2 },
    ])
  })

  it('skips entries the database would reject', () => {
    const next = state(
      [{ servings: 2 }, pick('', 2), pick('zero', 0), pick('neg', -1), pick('nan', NaN), pick('text', 'two')],
      [{ buy_qty: 1 }, adj('', 1), adj('nan', NaN), adj('text', '3'), adj('missing')]
    )
    expect(diffListState(state(), next)).toEqual([])
  })

  it('treats a missing side as an empty list', () => {
    expect(diffListState(undefined, state([pick('r1')]))).toEqual([{ type: 'addPick', recipe_id: 'r1', servings: 2 }])
    expect(diffListState(state([pick('r1')]), undefined)).toEqual([{ type: 'removePick', recipe_id: 'r1' }])
    expect(diffListState()).toEqual([])
  })
})

describe('mergeRemote', () => {
  it('takes the household list as it is when nothing is waiting to be saved', () => {
    const base = state([pick('r1')], [adj('a', 0)])
    const remote = state([pick('r1', 3), pick('r9')], [adj('b', 2)])
    expect(mergeRemote(base, base, remote)).toEqual(remote)
  })

  it('shows the other member\'s new pick next to mine that is not saved yet', () => {
    const base = state([pick('r1')])
    const local = state([pick('r1'), pick('mine')])
    const remote = state([pick('r1'), pick('theirs')])
    expect(mergeRemote(base, local, remote)).toEqual(state([pick('r1'), pick('theirs'), pick('mine')]))
  })

  it('keeps my unsaved removal', () => {
    const base = state([pick('r1'), pick('r2')])
    const local = state([pick('r2')])
    const remote = state([pick('r1'), pick('r2'), pick('theirs')])
    expect(mergeRemote(base, local, remote)).toEqual(state([pick('r2'), pick('theirs')]))
  })

  it('keeps my unsaved servings change', () => {
    const base = state([pick('r1', 2)])
    const local = state([pick('r1', 4)])
    const remote = state([pick('r1', 2), pick('theirs')])
    expect(mergeRemote(base, local, remote)).toEqual(state([pick('r1', 4), pick('theirs')]))
  })

  it('does not bring back a recipe the other member removed when I only changed its servings', () => {
    const base = state([pick('r1', 2), pick('r2')])
    const local = state([pick('r1', 4), pick('r2')])
    const remote = state([pick('r2')])
    expect(mergeRemote(base, local, remote)).toEqual(state([pick('r2')]))
  })

  it('uses my servings when we both added the same recipe', () => {
    const local = state([pick('same', 4)])
    const remote = state([pick('same', 2)])
    expect(mergeRemote(state(), local, remote)).toEqual(state([pick('same', 4)]))
  })

  it('keeps my unsaved ticks and quantity changes next to theirs', () => {
    const base = state([], [adj('a', 2), adj('b', 0)])
    const local = state([], [adj('a', 5), adj('mine', 0)]) // changed a, reset b, ticked mine
    const remote = state([], [adj('a', 2), adj('b', 0), adj('theirs', 0)])
    expect(mergeRemote(base, local, remote)).toEqual(state([], [adj('a', 5), adj('theirs', 0), adj('mine', 0)]))
  })

  it('leaves nothing to save again once my changes are already in the household list', () => {
    const base = state([pick('r1')])
    const local = state([pick('r1'), pick('mine', 3)])
    const remote = state([pick('r1'), pick('mine', 3)])
    const merged = mergeRemote(base, local, remote)
    expect(diffListState(remote, merged)).toEqual([])
  })

  it('leaves exactly my unsaved changes to save after merging', () => {
    const base = state([pick('r1'), pick('r2')], [adj('a', 1)])
    const local = state([pick('r1', 3), pick('mine')], [adj('a', 1), adj('b', 0)])
    const remote = state([pick('r1'), pick('r2'), pick('theirs')], [adj('a', 1)])
    const merged = mergeRemote(base, local, remote)
    const ops = diffListState(remote, merged)
    expect(ops).toHaveLength(4)
    expect(ops).toEqual(expect.arrayContaining([
      { type: 'setPickServings', recipe_id: 'r1', servings: 3 },
      { type: 'removePick', recipe_id: 'r2' },
      { type: 'addPick', recipe_id: 'mine', servings: 2 },
      { type: 'setAdjustment', item_key: 'b', buy_qty: 0 },
    ]))
  })

  it('does not change the states it was given', () => {
    const base = state([pick('r1')])
    const local = state([pick('r1'), pick('mine')])
    const remote = state([pick('r1'), pick('theirs')])
    const copy = JSON.parse(JSON.stringify({ base, local, remote }))
    mergeRemote(base, local, remote)
    expect({ base, local, remote }).toEqual(copy)
  })
})
