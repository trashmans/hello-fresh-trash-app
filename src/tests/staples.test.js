import { describe, it, expect } from 'vitest'
import { weekStartOf, checkStaple, planDueStaples } from '@/lib/staples'

// Dates are plain 'YYYY-MM-DD' strings in the household's local calendar.
// Weeks run Monday to Sunday. 2026-10-26 is a Monday.
const RUN_WEEK = '2026-10-26'

const staple = (overrides = {}) => ({
  id: 's1',
  quantity: 1,
  cadence_weeks: 1,
  active: true,
  skip_next: false,
  last_added_on: null,
  covered_until: null,
  ...overrides,
})

describe('weekStartOf', () => {
  it('returns the Monday of the week', () => {
    expect(weekStartOf('2026-10-26')).toBe('2026-10-26') // Monday
    expect(weekStartOf('2026-10-28')).toBe('2026-10-26') // Wednesday
    expect(weekStartOf('2026-11-01')).toBe('2026-10-26') // Sunday belongs to the week before it
  })

  it('crosses month and year boundaries', () => {
    expect(weekStartOf('2026-11-03')).toBe('2026-11-02')
    expect(weekStartOf('2027-01-01')).toBe('2026-12-28')
  })

  it('returns null for missing or malformed dates', () => {
    expect(weekStartOf(null)).toBeNull()
    expect(weekStartOf('')).toBeNull()
    expect(weekStartOf('26-10-2026')).toBeNull()
    expect(weekStartOf('2026-02-30')).toBeNull()
  })
})

describe('checkStaple', () => {
  it('is due the first time it is ever planned', () => {
    expect(checkStaple(staple(), RUN_WEEK)).toEqual({ due: true, reason: 'first_time' })
  })

  it('is due weekly when added last week', () => {
    expect(checkStaple(staple({ last_added_on: '2026-10-19' }), RUN_WEEK)).toEqual({ due: true, reason: 'cadence' })
  })

  it('counts whole weeks, not days', () => {
    // Added on the Wednesday of last week: still one week ago
    expect(checkStaple(staple({ last_added_on: '2026-10-21' }), RUN_WEEK).due).toBe(true)
  })

  it('waits for the cadence to pass', () => {
    const everyTwoWeeks = { cadence_weeks: 2 }
    expect(checkStaple(staple({ ...everyTwoWeeks, last_added_on: '2026-10-19' }), RUN_WEEK))
      .toEqual({ due: false, reason: 'not_yet' })
    expect(checkStaple(staple({ ...everyTwoWeeks, last_added_on: '2026-10-12' }), RUN_WEEK))
      .toEqual({ due: true, reason: 'cadence' })
  })

  it('is not due again in a week it was already added (re-running the job is safe)', () => {
    expect(checkStaple(staple({ last_added_on: '2026-10-26' }), RUN_WEEK)).toEqual({ due: false, reason: 'not_yet' })
    expect(checkStaple(staple({ last_added_on: '2026-10-27' }), RUN_WEEK)).toEqual({ due: false, reason: 'not_yet' })
  })

  it('treats a missing or zero cadence as weekly', () => {
    expect(checkStaple(staple({ cadence_weeks: null, last_added_on: '2026-10-19' }), RUN_WEEK).due).toBe(true)
    expect(checkStaple(staple({ cadence_weeks: 0, last_added_on: '2026-10-19' }), RUN_WEEK).due).toBe(true)
  })

  it('skips inactive staples', () => {
    expect(checkStaple(staple({ active: false }), RUN_WEEK)).toEqual({ due: false, reason: 'inactive' })
  })

  it('skips one week when skip_next is set, even if otherwise due', () => {
    expect(checkStaple(staple({ skip_next: true }), RUN_WEEK)).toEqual({ due: false, reason: 'skipped' })
    expect(checkStaple(staple({ skip_next: true, last_added_on: '2026-10-05' }), RUN_WEEK))
      .toEqual({ due: false, reason: 'skipped' })
  })

  it('is not due while bonus stock lasts through the end of the week', () => {
    const lastAddedLongAgo = { last_added_on: '2026-09-07' }
    expect(checkStaple(staple({ ...lastAddedLongAgo, covered_until: '2026-12-31' }), RUN_WEEK))
      .toEqual({ due: false, reason: 'covered' })
    // Stock lasting exactly to Sunday is enough; next Monday's run picks it up
    expect(checkStaple(staple({ ...lastAddedLongAgo, covered_until: '2026-11-01' }), RUN_WEEK))
      .toEqual({ due: false, reason: 'covered' })
  })

  it('is due when bonus stock runs out during this week, even before the cadence', () => {
    const recentlyAdded = { cadence_weeks: 4, last_added_on: '2026-10-19' }
    expect(checkStaple(staple({ ...recentlyAdded, covered_until: '2026-10-30' }), RUN_WEEK))
      .toEqual({ due: true, reason: 'running_out' })
  })

  it('ignores stock cover that ended before this week and falls back to the cadence', () => {
    expect(checkStaple(staple({ cadence_weeks: 4, last_added_on: '2026-10-19', covered_until: '2026-10-20' }), RUN_WEEK))
      .toEqual({ due: false, reason: 'not_yet' })
  })

  it('checks inactive before skip_next, and skip_next before stock cover', () => {
    expect(checkStaple(staple({ active: false, skip_next: true }), RUN_WEEK).reason).toBe('inactive')
    expect(checkStaple(staple({ skip_next: true, covered_until: '2026-10-28' }), RUN_WEEK).reason).toBe('skipped')
  })

  it('accepts any date in the run week, not only the Monday', () => {
    expect(checkStaple(staple({ last_added_on: '2026-10-19' }), '2026-10-29')).toEqual({ due: true, reason: 'cadence' })
  })

  it('throws on an invalid run date', () => {
    expect(() => checkStaple(staple(), 'next monday')).toThrow()
  })
})

describe('planDueStaples', () => {
  it('lists due staples with their quantities and reasons', () => {
    const result = planDueStaples([
      staple({ id: 'milk', quantity: 2, last_added_on: '2026-10-19' }),
      staple({ id: 'coffee', cadence_weeks: 3, last_added_on: '2026-10-19' }),
      staple({ id: 'eggs' }),
    ], RUN_WEEK)

    expect(result.due).toEqual([
      { staple_id: 'milk', quantity: 2, reason: 'cadence' },
      { staple_id: 'eggs', quantity: 1, reason: 'first_time' },
    ])
  })

  it('returns the ids whose skip_next flag should be cleared after this run', () => {
    const result = planDueStaples([
      staple({ id: 'wine', skip_next: true }),
      staple({ id: 'milk' }),
    ], RUN_WEEK)

    expect(result.due.map(d => d.staple_id)).toEqual(['milk'])
    expect(result.clearSkip).toEqual(['wine'])
  })

  it('uses at least 1 as the quantity', () => {
    const result = planDueStaples([staple({ quantity: 0 }), staple({ id: 's2', quantity: null })], RUN_WEEK)
    expect(result.due.map(d => d.quantity)).toEqual([1, 1])
  })

  it('handles an empty list', () => {
    expect(planDueStaples([], RUN_WEEK)).toEqual({ due: [], clearSkip: [] })
  })
})
