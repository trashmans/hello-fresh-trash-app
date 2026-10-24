// Decides which household staples go on this week's list.
//
// Dates are plain 'YYYY-MM-DD' strings in the household's own calendar
// (its time_zone), never Date objects with a time. All arithmetic is done
// in UTC on those calendar dates, so daylight-saving changes and a server
// running in UTC cannot move a staple into the wrong week.
//
// Weeks run Monday to Sunday. Cadence is counted in whole weeks: a staple
// added on any day of a week counts as added "that week".
//
// Order of checks for one staple:
//   1. inactive                         → not due
//   2. skip_next                        → not due this week (flag cleared after the run)
//   3. covered_until on/after Sunday    → not due (bonus stock lasts the week)
//   4. covered_until within this week   → due ("running_out")
//   5. never added before               → due ("first_time")
//   6. cadence_weeks since last added   → due ("cadence"), otherwise "not_yet"
// A covered_until date before this week is stale and ignored.

const DAY_MS = 24 * 60 * 60 * 1000
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

// 'YYYY-MM-DD' → UTC midnight in ms, or null if malformed or not a real date.
function parseDate(text) {
  if (typeof text !== 'string') return null
  const match = text.match(DATE_PATTERN)
  if (!match) return null
  const [, y, m, d] = match.map(Number)
  const ms = Date.UTC(y, m - 1, d)
  const check = new Date(ms)
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null
  return ms
}

function formatDate(ms) {
  return new Date(ms).toISOString().slice(0, 10)
}

// Monday of the week containing ms. getUTCDay(): 0 = Sunday … 6 = Saturday.
function mondayOf(ms) {
  const daysSinceMonday = (new Date(ms).getUTCDay() + 6) % 7
  return ms - daysSinceMonday * DAY_MS
}

/** The Monday ('YYYY-MM-DD') of the week containing the given date, or null if the date is invalid. */
export function weekStartOf(dateText) {
  const ms = parseDate(dateText)
  return ms == null ? null : formatDate(mondayOf(ms))
}

/**
 * Whether one staple is due in the week containing runDate.
 * Returns { due: boolean, reason } where reason is one of:
 * 'inactive', 'skipped', 'covered', 'running_out', 'first_time', 'cadence', 'not_yet'.
 * Throws if runDate is not a valid 'YYYY-MM-DD' date.
 */
export function checkStaple(staple, runDate) {
  const runMs = parseDate(runDate)
  if (runMs == null) throw new Error(`Invalid run date: ${runDate}`)
  const weekStart = mondayOf(runMs)
  const weekEnd = weekStart + 6 * DAY_MS

  if (staple.active === false) return { due: false, reason: 'inactive' }
  if (staple.skip_next) return { due: false, reason: 'skipped' }

  const coveredUntil = parseDate(staple.covered_until)
  if (coveredUntil != null && coveredUntil >= weekStart) {
    return coveredUntil >= weekEnd
      ? { due: false, reason: 'covered' }
      : { due: true, reason: 'running_out' }
  }

  const lastAdded = parseDate(staple.last_added_on)
  if (lastAdded == null) return { due: true, reason: 'first_time' }

  const cadence = staple.cadence_weeks > 0 ? staple.cadence_weeks : 1
  const weeksSince = Math.round((weekStart - mondayOf(lastAdded)) / (7 * DAY_MS))
  return weeksSince >= cadence
    ? { due: true, reason: 'cadence' }
    : { due: false, reason: 'not_yet' }
}

/**
 * Plans the staples for the week containing runDate.
 * Returns {
 *   due:       [{ staple_id, quantity, reason }]  — in the order given
 *   clearSkip: [staple_id]                        — skip_next flags to reset after the run
 * }
 */
export function planDueStaples(staples, runDate) {
  const due = []
  const clearSkip = []

  for (const staple of staples) {
    const { due: isDue, reason } = checkStaple(staple, runDate)
    if (isDue) {
      due.push({ staple_id: staple.id, quantity: Math.max(1, staple.quantity ?? 1), reason })
    } else if (reason === 'skipped') {
      clearSkip.push(staple.id)
    }
  }

  return { due, clearSkip }
}
