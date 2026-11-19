// @vitest-environment node
// Send to AH (rollout phase 6): one send, from the request to the run log, with in-memory
// stand-ins for the database and AH (as in weekSnapshot.test.js). Only the household owner
// of a household with both switches on may send; one send at a time; never lowers or removes.
import { describe, it, expect } from 'vitest'
import { sendWeek } from '../../supabase/functions/_shared/retailer/sendWeek.ts'
import { RetailerError } from '../../supabase/functions/_shared/retailer/types.ts'

const MONDAY = '2026-11-16'
const STAPLE_MILK = '11111111-1111-4111-8111-111111111111'
const STAPLE_RICE = '22222222-2222-4222-8222-222222222222'
const STAPLE_SKIP = '33333333-3333-4333-8333-333333333333'

const milk = { productId: 101, text: 'AH Halfvolle melk', quantity: 2, sources: ['staple'] }
const rice = { productId: 104, text: 'AH Basmati rijst', quantity: 2, sources: ['stockup'] }
const oil = { productId: null, text: 'Olive oil', quantity: 1, sources: ['recipe'] }
const body = (over = {}) => ({
  weekStart: MONDAY,
  lines: [milk, rice, oil],
  stapleUpdates: [
    { staple_id: STAPLE_MILK, product_id: 101, last_added_on: MONDAY },
    { staple_id: STAPLE_RICE, product_id: 104, last_added_on: MONDAY, covered_until: '2027-01-10' },
    { staple_id: STAPLE_SKIP, product_id: null, skip_next: false },
  ],
  ...over,
})

const OWNER = { householdId: 'hh-1', role: 'owner', ahEnabled: true, sendEnabled: true }

// `calls` records what the flow did, in order. failLines: product ids / texts whose write fails.
function deps({ household = OWNER, list = [], runId = 'run-1', failLines = [], readError = null } = {}) {
  const calls = []
  const d = {
    calls,
    saved: [],
    finished: null,
    getHousehold: async (userId) => { calls.push(['getHousehold', userId]); return household },
    startRun: async (householdId, weekStart, userId) => { calls.push(['startRun', householdId, weekStart, userId]); return runId },
    withToken: async (householdId, fn) => { calls.push(['withToken', householdId]); return fn('access-token') },
    readList: async (token) => { calls.push(['readList', token]); if (readError) throw readError; return list },
    writeListLines: async (token, lines) => {
      calls.push(['writeListLines', token, lines.map(l => l.productId ?? l.text)])
      return lines.map(line => (failLines.includes(line.productId ?? line.text)
        ? { line, ok: false, error: new RetailerError('http', 'AH said no: secret detail', 500) }
        : { line, ok: true }))
    },
    saveStapleUpdates: async (householdId, updates) => { calls.push(['saveStapleUpdates', householdId, updates.map(u => u.staple_id)]); d.saved.push(...updates) },
    finishRun: async (id, result) => { calls.push(['finishRun', id, result.status]); d.finished = { id, ...result } },
  }
  return d
}
const run = (d, raw = body()) => sendWeek(d, { userId: 'u-1', body: raw })
const names = (d) => d.calls.map(c => c[0])

describe('sendWeek: who may send', () => {
  it('refuses a request that fails the checks before anything else', async () => {
    const d = deps()
    await expect(run(d, body({ lines: [] }))).rejects.toMatchObject({ code: 'invalid' })
    expect(d.calls).toEqual([])
  })

  for (const [label, household] of [
    ['someone without a household', null],
    ['a household with the AH switch off', { ...OWNER, ahEnabled: false }],
    ['a household with sending not switched on yet', { ...OWNER, sendEnabled: false }],
    ['a household member who is not the owner', { ...OWNER, role: 'member' }],
  ]) {
    it(`refuses ${label} before touching the token`, async () => {
      const d = deps({ household })
      const error = await run(d).catch(e => e)
      expect(error).toBeInstanceOf(RetailerError)
      expect(error.code).toBe('forbidden')
      expect(error.message).toMatch(/\S/)
      expect(names(d)).toEqual(['getHousehold'])
    })
  }

  it('refuses a second send while one is running, before touching the token', async () => {
    const d = deps({ runId: null })
    await expect(run(d)).rejects.toMatchObject({ code: 'busy' })
    expect(names(d)).toEqual(['getHousehold', 'startRun'])
  })
})

describe('sendWeek: a send', () => {
  it('reads the AH list, writes only what adds something, saves staple dates, then closes the run', async () => {
    const d = deps({ list: [{ productId: 101, text: 'AH Halfvolle melk', quantity: 3, ticked: false }] })
    const result = await run(d)

    expect(d.calls).toEqual([
      ['getHousehold', 'u-1'],
      ['startRun', 'hh-1', MONDAY, 'u-1'],
      ['withToken', 'hh-1'],
      ['readList', 'access-token'],
      ['writeListLines', 'access-token', [104, 'Olive oil']],
      ['saveStapleUpdates', 'hh-1', [STAPLE_MILK, STAPLE_RICE, STAPLE_SKIP]],
      ['finishRun', 'run-1', 'done'],
    ])
    expect(result).toEqual({
      runId: 'run-1',
      status: 'done',
      staplesUpdated: 3,
      lines: [
        { productId: 101, text: 'AH Halfvolle melk', action: null, from: 3, to: 3, sources: ['staple'], outcome: 'already_enough', errorCode: null },
        { productId: 104, text: 'AH Basmati rijst', action: 'add', from: 0, to: 2, sources: ['stockup'], outcome: 'written', errorCode: null },
        { productId: null, text: 'Olive oil', action: 'add', from: 0, to: 1, sources: ['recipe'], outcome: 'written', errorCode: null },
      ],
    })
    expect(d.finished).toEqual({ id: 'run-1', status: 'done', errorCode: null, lines: result.lines })
  })

  it('sends whole lines: set quantity and untick', async () => {
    const d = deps({ list: [{ productId: 104, text: 'AH Basmati rijst', quantity: 5, ticked: true }] })
    const result = await run(d)
    expect(result.lines[1]).toMatchObject({ productId: 104, action: 'untick', from: 0, to: 2, outcome: 'written' })
  })

  it('does not call AH to write when everything is already on the list', async () => {
    const list = [
      { productId: 101, text: 'AH Halfvolle melk', quantity: 2, ticked: false },
      { productId: 104, text: 'AH Basmati rijst', quantity: 4, ticked: false },
      { productId: null, text: 'olive oil', quantity: 1, ticked: false },
    ]
    const d = deps({ list })
    const result = await run(d)
    expect(names(d)).not.toContain('writeListLines')
    expect(result.status).toBe('done')
    expect(result.staplesUpdated).toBe(3)
  })

  it('marks a send with a failed line as partial, and leaves that staple due', async () => {
    const d = deps({ failLines: [104] })
    const result = await run(d)
    expect(result.status).toBe('partial')
    expect(result.lines.find(l => l.productId === 104)).toMatchObject({ outcome: 'failed', errorCode: 'http' })
    expect(d.saved.map(u => u.staple_id)).toEqual([STAPLE_MILK, STAPLE_SKIP])
    expect(result.staplesUpdated).toBe(2)
  })

  it("keeps AH's own error text out of the result and the run log", async () => {
    const d = deps({ failLines: [104] })
    const result = await run(d)
    expect(JSON.stringify(result)).not.toContain('secret detail')
    expect(JSON.stringify(d.finished)).not.toContain('secret detail')
  })

  it('marks a send where every write failed as failed, and saves no staple dates', async () => {
    const d = deps({ failLines: [101, 104, 'Olive oil'] })
    const result = await run(d)
    expect(result.status).toBe('failed')
    expect(names(d)).not.toContain('saveStapleUpdates')
    expect(result.staplesUpdated).toBe(0)
  })

  it('closes the run as failed and passes the error on when AH cannot be read', async () => {
    const d = deps({ readError: new RetailerError('auth', 'refused') })
    await expect(run(d)).rejects.toMatchObject({ code: 'auth' })
    expect(names(d)).toEqual(['getHousehold', 'startRun', 'withToken', 'readList', 'finishRun'])
    expect(d.finished).toEqual({ id: 'run-1', status: 'failed', errorCode: 'auth', lines: [] })
  })

  it('closes the run as failed with an unknown error too', async () => {
    const d = deps({ readError: new Error('boom') })
    await expect(run(d)).rejects.toThrow('boom')
    expect(d.finished).toMatchObject({ status: 'failed', errorCode: 'unexpected' })
  })

  it('uses one AH login for reading and writing', async () => {
    const d = deps()
    await run(d)
    expect(d.calls.filter(c => c[0] === 'withToken')).toHaveLength(1)
  })
})
