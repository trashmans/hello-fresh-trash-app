import { describe, it, expect } from 'vitest'
import { ownInProgressIds, inProgressIdsToCheck, mergeStatusUpdates, recipeCardState } from '@/lib/recipeStatus'

const ME = 'user-me'
const recipe = (id, status, uploaded_by = ME, extra = {}) => ({ id, status, uploaded_by, name: null, ...extra })

describe('ownInProgressIds', () => {
  it('lists my recipes that are still pending or processing, in list order', () => {
    const recipes = [
      recipe('a', 'processing'),
      recipe('b', 'ready'),
      recipe('c', 'pending'),
      recipe('d', 'failed'),
      recipe('e', 'rejected'),
    ]
    expect(ownInProgressIds(recipes, ME)).toEqual(['a', 'c'])
  })

  it("ignores other people's recipes", () => {
    expect(ownInProgressIds([recipe('a', 'processing', 'someone-else')], ME)).toEqual([])
  })

  it('returns an empty list when nothing is in progress', () => {
    expect(ownInProgressIds([], ME)).toEqual([])
    expect(ownInProgressIds([recipe('a', 'ready')], ME)).toEqual([])
  })
})

describe('inProgressIdsToCheck', () => {
  const OTHER = 'someone-else'

  it('includes my own pending or processing recipes', () => {
    expect(inProgressIdsToCheck([recipe('a', 'pending'), recipe('b', 'ready')], ME, new Set())).toEqual(['a'])
  })

  it("includes someone else's recipe I am re-parsing, while it is in progress", () => {
    const recipes = [recipe('x', 'processing', OTHER), recipe('y', 'pending', OTHER)]
    expect(inProgressIdsToCheck(recipes, ME, new Set(['x']))).toEqual(['x'])
  })

  it('stops checking a re-parsed recipe once it is ready again', () => {
    expect(inProgressIdsToCheck([recipe('x', 'ready', OTHER)], ME, new Set(['x']))).toEqual([])
  })

  it("ignores other people's in-progress recipes I am not re-parsing", () => {
    expect(inProgressIdsToCheck([recipe('y', 'processing', OTHER)], ME, new Set())).toEqual([])
  })

  it('keeps list order and works without a watch list', () => {
    const recipes = [recipe('x', 'pending', OTHER), recipe('a', 'processing'), recipe('b', 'pending')]
    expect(inProgressIdsToCheck(recipes, ME, new Set(['x']))).toEqual(['x', 'a', 'b'])
    expect(inProgressIdsToCheck(recipes, ME)).toEqual(['a', 'b'])
  })
})

describe('mergeStatusUpdates', () => {
  it('applies fresh rows to matching recipes', () => {
    const recipes = [recipe('a', 'processing'), recipe('b', 'ready', ME, { name: 'Tacos' })]
    const merged = mergeStatusUpdates(recipes, [{ id: 'a', status: 'ready', name: 'Curry' }])
    expect(merged).toEqual([
      recipe('a', 'ready', ME, { name: 'Curry' }),
      recipe('b', 'ready', ME, { name: 'Tacos' }),
    ])
  })

  it('ignores rows for recipes that are not in the list', () => {
    const recipes = [recipe('a', 'processing')]
    expect(mergeStatusUpdates(recipes, [{ id: 'zzz', status: 'ready' }])).toBe(recipes)
  })

  it('returns the same list when nothing changed, so the page does not re-render', () => {
    const recipes = [recipe('a', 'processing')]
    expect(mergeStatusUpdates(recipes, [])).toBe(recipes)
    expect(mergeStatusUpdates(recipes, null)).toBe(recipes)
    expect(mergeStatusUpdates(recipes, [{ id: 'a', status: 'processing' }])).toBe(recipes)
  })

  it('keeps unchanged recipes as the same objects', () => {
    const untouched = recipe('b', 'ready')
    const merged = mergeStatusUpdates([recipe('a', 'processing'), untouched], [{ id: 'a', status: 'ready' }])
    expect(merged[1]).toBe(untouched)
  })

  it('does not modify the list it was given', () => {
    const recipes = [recipe('a', 'processing')]
    mergeStatusUpdates(recipes, [{ id: 'a', status: 'ready' }])
    expect(recipes[0].status).toBe('processing')
  })
})

describe('recipeCardState', () => {
  const OTHER = 'someone-else'
  const normal = { userId: ME }
  const admin = { userId: ME, adminMode: true }

  it('shows ready recipes to everyone', () => {
    expect(recipeCardState(recipe('a', 'ready'), normal)).toEqual({ kind: 'ready' })
    expect(recipeCardState(recipe('b', 'ready', OTHER), normal)).toEqual({ kind: 'ready' })
  })

  it('shows my own pending or processing recipe with Cancel', () => {
    expect(recipeCardState(recipe('a', 'pending'), normal)).toEqual({ kind: 'pending', canCancel: true })
    expect(recipeCardState(recipe('a', 'processing'), admin)).toEqual({ kind: 'pending', canCancel: true })
  })

  it("hides someone else's in-progress recipe in normal mode", () => {
    expect(recipeCardState(recipe('b', 'processing', OTHER), normal)).toBeNull()
  })

  it("shows someone else's in-progress recipe without Cancel when I re-parsed it or am in admin mode", () => {
    const watched = { userId: ME, watchedIds: new Set(['b']) }
    expect(recipeCardState(recipe('b', 'pending', OTHER), watched)).toEqual({ kind: 'pending', canCancel: false })
    expect(recipeCardState(recipe('b', 'pending', OTHER), admin)).toEqual({ kind: 'pending', canCancel: false })
  })

  it('lets me retry my own failed recipe through retry-parse', () => {
    expect(recipeCardState(recipe('a', 'failed', ME, { retry_count: 1 }), normal))
      .toEqual({ kind: 'failed', retryVia: 'retry-parse' })
  })

  it('switches to admin-reparse for my own recipe once retry-parse has hit its limit of 3', () => {
    const usedUp = recipe('a', 'failed', ME, { retry_count: 3 })
    expect(recipeCardState(usedUp, normal)).toEqual({ kind: 'failed', retryVia: null })
    expect(recipeCardState(usedUp, admin)).toEqual({ kind: 'failed', retryVia: 'admin-reparse' })
  })

  it("shows someone else's failed recipe only in admin mode, retried through admin-reparse", () => {
    const theirs = recipe('b', 'failed', OTHER, { retry_count: 1 })
    expect(recipeCardState(theirs, normal)).toBeNull()
    expect(recipeCardState(theirs, admin)).toEqual({ kind: 'failed', retryVia: 'admin-reparse' })
  })

  it('shows rejected duplicates only to their uploader', () => {
    expect(recipeCardState(recipe('a', 'rejected'), normal)).toEqual({ kind: 'rejected' })
    expect(recipeCardState(recipe('b', 'rejected', OTHER), admin)).toBeNull()
  })

  it('hides recipes with an unknown status', () => {
    expect(recipeCardState(recipe('a', 'archived'), admin)).toBeNull()
  })
})
