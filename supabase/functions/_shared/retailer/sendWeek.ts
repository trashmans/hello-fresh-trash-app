// Send to AH (rollout phase 6, docs/adr/0005): one send of this week's preview to the
// household's real AH list.
//
// sendWeek() runs, in this order:
//   1. checkSendRequest() on the browser's request (sendPlan.ts)                → 'invalid'
//   2. who may send: a member of a household with ah_enabled and send_enabled,
//      and (for now) only the household owner                                   → 'forbidden'
//   3. start a run; only one may run per household at a time                    → 'busy'
//   4. with one AH login: read the list as it is now, planWrites() against it,
//      and write only those lines (one request per line; a failed line doesn't
//      stop the others; never removes or lowers)
//   5. save staple dates only for staples whose line is on the list afterwards
//   6. close the run with every line's outcome (error codes only, never AH's text)
// A failure in step 4 closes the run as failed and is passed on. The database and AH sit
// behind SendWeekDeps so this is testable without either.

import { applicableStapleUpdates, checkSendRequest, lineKey, planWrites } from './sendPlan.ts'
import type { LineOutcome, Source, StapleUpdate } from './sendPlan.ts'
import { RetailerError } from './types.ts'
import type { ListLine, RetailerListItem, WriteResult } from './types.ts'

export type RunStatus = 'done' | 'partial' | 'failed'

export interface RunLine {
  productId: number | null
  text: string
  action: 'add' | 'increase' | 'untick' | null // null: already on the list, nothing written
  from: number
  to: number
  sources: Source[]
  outcome: LineOutcome
  errorCode: string | null
}

export interface SendWeekDeps {
  getHousehold(userId: string): Promise<{ householdId: string; role: string; ahEnabled: boolean; sendEnabled: boolean } | null>
  /** Starts a run; returns its id, or null when another send for the household is still running. */
  startRun(householdId: string, weekStart: string, userId: string): Promise<string | null>
  /** Runs fn with a fresh access token for the household's account (withAccessToken). */
  withToken<T>(householdId: string, fn: (accessToken: string) => Promise<T>): Promise<T>
  readList(accessToken: string): Promise<RetailerListItem[]>
  writeListLines(accessToken: string, lines: ListLine[]): Promise<WriteResult[]>
  /** Saves the planner's staple fields, only for staples of this household. */
  saveStapleUpdates(householdId: string, updates: StapleUpdate[]): Promise<void>
  finishRun(runId: string, result: { status: RunStatus; errorCode: string | null; lines: RunLine[] }): Promise<void>
}

export interface SendResult {
  runId: string
  status: RunStatus
  staplesUpdated: number
  lines: RunLine[]
}

export async function sendWeek(deps: SendWeekDeps, { userId, body }: { userId: string; body: unknown }): Promise<SendResult> {
  const check = checkSendRequest(body)
  if (!check.ok) throw new RetailerError('invalid', check.message)
  const { weekStart, lines, stapleUpdates } = check.request

  const household = await deps.getHousehold(userId)
  if (!household || !household.ahEnabled) {
    throw new RetailerError('forbidden', 'Supermarket features are not switched on for your household.')
  }
  if (!household.sendEnabled) {
    throw new RetailerError('forbidden', 'Sending to AH is not switched on for your household yet. Use the preview for now.')
  }
  if (household.role !== 'owner') {
    throw new RetailerError('forbidden', 'For now only the household owner can send to AH.')
  }

  const runId = await deps.startRun(household.householdId, weekStart, userId)
  if (!runId) throw new RetailerError('busy', 'A send to AH is already running for your household. Wait a moment and refresh.')

  let planned: { writes: ReturnType<typeof planWrites>['writes']; skipped: ReturnType<typeof planWrites>['skipped']; results: WriteResult[] }
  try {
    planned = await deps.withToken(household.householdId, async (token) => {
      const current = await deps.readList(token)
      const { writes, skipped } = planWrites(lines, current)
      const results = writes.length > 0
        ? await deps.writeListLines(token, writes.map(({ productId, text, quantity }) => ({ productId, text, quantity })))
        : []
      return { writes, skipped, results }
    })
  } catch (err) {
    await deps.finishRun(runId, { status: 'failed', errorCode: err instanceof RetailerError ? err.code : 'unexpected', lines: [] })
    throw err
  }

  // Every requested line's outcome, in the order they were sent.
  const written = new Map(planned.writes.map((w, i) => [lineKey(w.productId, w.text), { write: w, result: planned.results[i] }]))
  const already = new Map(planned.skipped.map((s) => [lineKey(s.productId, s.text), s]))
  const outcomes = new Map<string, LineOutcome>()
  const runLines: RunLine[] = lines.map((line) => {
    const key = lineKey(line.productId, line.text)
    const w = written.get(key)
    if (w) {
      const ok = w.result?.ok === true
      outcomes.set(key, ok ? 'written' : 'failed')
      return {
        productId: line.productId, text: line.text, action: w.write.action, from: w.write.from, to: w.write.quantity,
        sources: line.sources, outcome: ok ? 'written' : 'failed',
        errorCode: ok ? null : (w.result?.error instanceof RetailerError ? w.result.error.code : 'unexpected'),
      }
    }
    const s = already.get(key)
    outcomes.set(key, 'already_enough')
    return {
      productId: line.productId, text: line.text, action: null, from: s?.quantity ?? line.quantity, to: s?.quantity ?? line.quantity,
      sources: line.sources, outcome: 'already_enough', errorCode: null,
    }
  })

  const failed = runLines.filter((l) => l.outcome === 'failed').length
  let status: RunStatus = failed === 0 ? 'done' : failed === runLines.length ? 'failed' : 'partial'
  let errorCode: string | null = null

  const updates = applicableStapleUpdates(stapleUpdates, outcomes)
  let staplesUpdated = 0
  if (updates.length > 0) {
    try {
      await deps.saveStapleUpdates(household.householdId, updates)
      staplesUpdated = updates.length
    } catch {
      // The AH list was changed; only the staple dates are missing. Say so instead of failing.
      if (status === 'done') status = 'partial'
      errorCode = 'staples_not_saved'
    }
  }

  await deps.finishRun(runId, { status, errorCode, lines: runLines })
  return { runId, status, staplesUpdated, lines: runLines }
}
