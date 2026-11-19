// @vitest-environment node
// Send to AH (rollout phase 6), the server's own checks before anything is written to a
// real AH list: the request from the browser is checked, then compared with the AH list
// as it is now, so only writes that add something are sent (never remove, never lower).
// Staple dates are only saved for lines that are on the AH list afterwards.
import { describe, it, expect } from 'vitest'
import {
  MAX_SEND_LINES, MAX_LINE_QUANTITY, MAX_TEXT_LENGTH,
  checkSendRequest, planWrites, applicableStapleUpdates,
} from '../../supabase/functions/_shared/retailer/sendPlan.ts'

const MONDAY = '2026-11-16'
const STAPLE_A = '11111111-1111-4111-8111-111111111111'
const STAPLE_B = '22222222-2222-4222-8222-222222222222'
const STAPLE_C = '33333333-3333-4333-8333-333333333333'

const productLine = (productId, quantity = 1, over = {}) => ({ productId, text: `Product ${productId}`, quantity, sources: ['staple'], ...over })
const textLine = (text, quantity = 1) => ({ productId: null, text, quantity, sources: ['recipe'] })
const request = (over = {}) => ({ weekStart: MONDAY, lines: [productLine(101, 2)], stapleUpdates: [], ...over })

const refused = (raw) => {
  const result = checkSendRequest(raw)
  expect(result.ok).toBe(false)
  expect(result.message).toMatch(/\S/)
}

describe('checkSendRequest', () => {
  it('has limits that keep one send small', () => {
    expect([MAX_SEND_LINES, MAX_LINE_QUANTITY, MAX_TEXT_LENGTH]).toEqual([60, 20, 120])
  })

  it('accepts product and free-text lines, cleaned up', () => {
    const result = checkSendRequest(request({
      lines: [productLine('101', 2), { productId: null, text: '  Olive   oil ', quantity: 1, sources: ['recipe'] }],
    }))
    expect(result).toEqual({
      ok: true,
      request: {
        weekStart: MONDAY,
        lines: [
          { productId: 101, text: 'Product 101', quantity: 2, sources: ['staple'] },
          { productId: null, text: 'Olive oil', quantity: 1, sources: ['recipe'] },
        ],
        stapleUpdates: [],
      },
    })
  })

  it('needs the Monday of the week being sent', () => {
    for (const weekStart of ['2026-11-17', '2026-02-30', 'next week', null, undefined]) refused(request({ weekStart }))
  })

  it('needs at least one line and at most the limit', () => {
    refused(request({ lines: [] }))
    refused(request({ lines: 'x' }))
    const many = Array.from({ length: MAX_SEND_LINES + 1 }, (_, i) => productLine(1000 + i))
    refused(request({ lines: many }))
    expect(checkSendRequest(request({ lines: many.slice(0, MAX_SEND_LINES) })).ok).toBe(true)
  })

  it('refuses quantities that would remove, lower to nothing, or are far too many', () => {
    for (const quantity of [0, -1, 1.5, MAX_LINE_QUANTITY + 1, '2', null]) refused(request({ lines: [productLine(101, quantity)] }))
    expect(checkSendRequest(request({ lines: [productLine(101, MAX_LINE_QUANTITY)] })).ok).toBe(true)
  })

  it('refuses bad product ids and missing or overlong descriptions', () => {
    for (const productId of [0, -5, 1.5, 'abc']) refused(request({ lines: [productLine(productId)] }))
    refused(request({ lines: [textLine('')] }))
    refused(request({ lines: [textLine('   ')] }))
    refused(request({ lines: [textLine('x'.repeat(MAX_TEXT_LENGTH + 1))] }))
    expect(checkSendRequest(request({ lines: [textLine('x'.repeat(MAX_TEXT_LENGTH))] })).ok).toBe(true)
  })

  it('refuses the same product or free text twice (the preview already combines them)', () => {
    refused(request({ lines: [productLine(101), productLine('101')] }))
    refused(request({ lines: [textLine('Olive oil'), textLine('olive  OIL')] }))
  })

  it('only accepts known sources', () => {
    refused(request({ lines: [productLine(101, 1, { sources: ['hacked'] })] }))
    refused(request({ lines: [productLine(101, 1, { sources: 'staple' })] }))
  })

  it('refuses something that is not a request at all', () => {
    for (const raw of [null, undefined, 'x', 42, []]) refused(raw)
  })

  describe('staple updates', () => {
    const added = (over = {}) => ({ staple_id: STAPLE_A, product_id: 101, last_added_on: MONDAY, ...over })

    it('accepts the dates the planner sets, tied to the line they came from', () => {
      const updates = [added(), added({ staple_id: STAPLE_B, covered_until: '2027-01-10' }), { staple_id: STAPLE_C, product_id: null, skip_next: false }]
      const result = checkSendRequest(request({ stapleUpdates: updates }))
      expect(result.ok).toBe(true)
      expect(result.request.stapleUpdates).toEqual(updates)
    })

    it('only lets the planner set last_added_on to the week being sent', () => {
      refused(request({ stapleUpdates: [added({ last_added_on: '2026-11-09' })] }))
    })

    it('needs the line a dated update belongs to, among the lines being sent', () => {
      refused(request({ stapleUpdates: [added({ product_id: null })] }))
      refused(request({ stapleUpdates: [added({ product_id: 999 })] }))
    })

    it('only clears skip_next, never sets it', () => {
      refused(request({ stapleUpdates: [{ staple_id: STAPLE_A, product_id: null, skip_next: true }] }))
    })

    it('refuses any other field, a bad staple id, a bad date, or an update that changes nothing', () => {
      refused(request({ stapleUpdates: [added({ quantity: 20 })] }))
      refused(request({ stapleUpdates: [added({ household_id: STAPLE_B })] }))
      refused(request({ stapleUpdates: [added({ staple_id: 'not-a-uuid' })] }))
      refused(request({ stapleUpdates: [added({ covered_until: '2027-13-01' })] }))
      refused(request({ stapleUpdates: [{ staple_id: STAPLE_A, product_id: null }] }))
      refused(request({ stapleUpdates: 'x' }))
    })

    it('refuses the same staple twice', () => {
      refused(request({ stapleUpdates: [added(), added()] }))
    })
  })
})

describe('planWrites', () => {
  it('adds what is not on the list yet', () => {
    expect(planWrites([productLine(101, 2), textLine('Olive oil')], [])).toEqual({
      writes: [
        { action: 'add', productId: 101, text: 'Product 101', from: 0, quantity: 2, sources: ['staple'] },
        { action: 'add', productId: null, text: 'Olive oil', from: 0, quantity: 1, sources: ['recipe'] },
      ],
      skipped: [],
    })
  })

  it('raises a lower quantity and unticks a ticked item, never lowers', () => {
    const current = [
      { productId: 101, text: 'AH Halfvolle melk', quantity: 1, ticked: false },
      { productId: 102, text: 'AH Volle melk', quantity: 5, ticked: true },
      { productId: 103, text: 'AH Bananen', quantity: 4, ticked: false },
    ]
    const { writes, skipped } = planWrites([productLine(101, 2), productLine(102, 1), productLine(103, 2)], current)
    expect(writes.map(w => [w.action, w.productId, w.from, w.quantity])).toEqual([
      ['increase', 101, 1, 2],
      ['untick', 102, 0, 1],
    ])
    expect(skipped).toEqual([{ productId: 103, text: 'Product 103', quantity: 4, reason: 'already_enough' }])
  })

  it('matches free text the way AH does: ignoring case and extra spaces', () => {
    const { writes, skipped } = planWrites([textLine('Olive oil')], [{ productId: null, text: '  olive  OIL ', quantity: 1, ticked: false }])
    expect(writes).toEqual([])
    expect(skipped).toHaveLength(1)
  })

  it('never touches items that are only on the AH list', () => {
    const current = [{ productId: null, text: 'Kaarsen', quantity: 1, ticked: false }, { productId: 555, text: 'Wine', quantity: 1, ticked: true }]
    expect(planWrites([productLine(101)], current).writes.map(w => w.productId)).toEqual([101])
  })

  it('gives no writes when sent again after it worked', () => {
    const lines = [productLine(101, 2), textLine('Olive oil')]
    const after = planWrites(lines, []).writes.map(w => ({ productId: w.productId, text: w.text, quantity: w.quantity, ticked: false }))
    expect(planWrites(lines, after).writes).toEqual([])
  })
})

describe('applicableStapleUpdates', () => {
  const update = (staple_id, product_id, over = {}) => ({ staple_id, product_id, last_added_on: MONDAY, ...over })
  const outcomes = new Map([['p:101', 'written'], ['p:102', 'already_enough'], ['p:103', 'failed']])

  it('saves dates for staples whose line is on the AH list now: written, or already enough', () => {
    const updates = [update(STAPLE_A, 101), update(STAPLE_B, 102)]
    expect(applicableStapleUpdates(updates, outcomes)).toEqual(updates)
  })

  it('leaves a staple alone when its line failed, so it is due again next time', () => {
    expect(applicableStapleUpdates([update(STAPLE_A, 103)], outcomes)).toEqual([])
  })

  it('leaves a staple alone when its line was not sent at all', () => {
    expect(applicableStapleUpdates([update(STAPLE_A, 999)], outcomes)).toEqual([])
  })

  it('clears a skip once the week is sent, even though it has no line', () => {
    const skip = { staple_id: STAPLE_A, product_id: null, skip_next: false }
    expect(applicableStapleUpdates([skip], outcomes)).toEqual([skip])
  })

  it('does nothing for a send where every line failed, skips included', () => {
    const allFailed = new Map([['p:103', 'failed']])
    const skip = { staple_id: STAPLE_B, product_id: null, skip_next: false }
    expect(applicableStapleUpdates([update(STAPLE_A, 103), skip], allFailed)).toEqual([])
  })
})
