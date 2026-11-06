// Local trial of the AH weekly shop: plans this week's staples with the app's real
// planner (src/lib/planWeek.js) and, only after you confirm, adds them to your AH
// shopping list. Runs on your laptop only; nothing in the app or database changes.
//
//   node spike/ah-api/weekly.mjs plan    dry run: shows what it would add or raise
//   node spike/ah-api/weekly.mjs send    same plan, asks, then writes to your AH list
//
// Needs Node 22.15+ and AH tokens from: node spike/ah-api/spike.mjs login
// Your staples:   spike/ah-api/staples.json      (copy staples.example.json; gitignored)
// Run history:    spike/ah-api/weekly-state.json (written after a successful send; gitignored)
//
// Uses only what the spike proved (FINDINGS.md): token refresh, product search
// (with bonus fields), reading the shopping list, and PATCHing list items.
// It never removes or lowers anything on your list (see src/lib/listDiff.js).

import { registerHooks } from 'node:module'
import { readFile, writeFile } from 'node:fs/promises'
import { createInterface } from 'node:readline/promises'
import { stdin, stdout, argv, exit } from 'node:process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

// The app's src/lib files import each other without ".js" (Vite style). Node needs
// the extension, so add it for relative imports that would otherwise not resolve.
registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context)
    } catch (err) {
      if (err?.code === 'ERR_MODULE_NOT_FOUND' && /^\.\.?\//.test(specifier) && !/\.[cm]?js$/.test(specifier)) {
        return nextResolve(`${specifier}.js`, context)
      }
      throw err
    }
  },
})
const { planWeek } = await import('../../src/lib/planWeek.js')
const { diffList } = await import('../../src/lib/listDiff.js')

const DIR = path.dirname(fileURLToPath(import.meta.url))
const TOKEN_FILE = path.join(DIR, '.tokens.json')
const STAPLES_FILE = path.join(DIR, 'staples.json')
const STATE_FILE = path.join(DIR, 'weekly-state.json')
const TIME_ZONE = 'Europe/Amsterdam'

const API = 'https://api.ah.nl'
const CLIENT_ID = 'appie-ios'
const LIST_PATH = '/mobile-services/shoppinglist/v2/items'
const HEADERS = {
  'User-Agent': 'Appie/9.28 (iPhone17,3; iPhone; CPU OS 26_1 like Mac OS X)',
  'x-client-name': 'appie-ios',
  'x-client-version': '9.28',
  'x-application': 'AHWEBSHOP',
  Accept: 'application/json',
  'Content-Type': 'application/json',
}

// ---------- AH API (same calls as spike.mjs) ----------

async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')) } catch (err) {
    if (err.code === 'ENOENT') return fallback
    throw new Error(`Could not read ${path.basename(file)}: ${err.message}`)
  }
}
const writeJson = (file, data, mode) => writeFile(file, JSON.stringify(data, null, 2) + '\n', mode ? { mode } : undefined)

async function ah(method, p, { body, token } = {}) {
  const headers = { ...HEADERS }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(API + p, { method, headers, body: body ? JSON.stringify(body) : undefined })
  const text = await res.text()
  let data
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  if (!res.ok) {
    const detail = typeof data === 'string' ? data : JSON.stringify(data)
    throw new Error(`${method} ${p.split('?')[0]} → HTTP ${res.status}: ${(detail ?? '').slice(0, 300)}`)
  }
  return data
}

async function getToken() {
  const t = await readJson(TOKEN_FILE, null)
  if (!t?.refreshToken) throw new Error('No AH tokens yet — run: node spike/ah-api/spike.mjs login')
  if (t.expiresAt && Date.now() < t.expiresAt - 60_000) return t.accessToken
  // AH rotates the refresh token on every refresh, so the new one must be saved.
  const r = await ah('POST', '/mobile-auth/v1/auth/token/refresh', { body: { clientId: CLIENT_ID, refreshToken: t.refreshToken } })
  const next = {
    ...t,
    accessToken: r.access_token,
    refreshToken: r.refresh_token ?? t.refreshToken,
    expiresAt: r.expires_in ? Date.now() + r.expires_in * 1000 : null,
    expiresInSeconds: r.expires_in ?? null,
    obtainedAt: new Date().toISOString(),
  }
  await writeJson(TOKEN_FILE, next, 0o600)
  return next.accessToken
}

async function search(term, token, size = 10) {
  const q = new URLSearchParams({ query: term, sortOn: 'RELEVANCE', page: '0', size: String(size) })
  return (await ah('GET', `/mobile-services/product/search/v2?${q}`, { token }))?.products ?? []
}

async function readList(token) {
  return (await ah('GET', LIST_PATH, { token }))?.items ?? []
}

// ---------- helpers ----------

// Today's date in the household's time zone, as 'YYYY-MM-DD'.
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(new Date())
const eur = (n) => (n == null ? '?' : `€${Number(n).toFixed(2)}`)
const orderable = (p) => p.isOrderable !== false && p.availableOnline !== false

async function confirm(question) {
  const rl = createInterface({ input: stdin, output: stdout })
  const answer = (await rl.question(`${question} [y/N] `)).trim().toLowerCase()
  rl.close()
  return answer === 'y' || answer === 'yes'
}

// Finds each staple's AH product: the pinned productId if given (it must appear in the
// search results), otherwise the first orderable result for the search term.
async function resolveProducts(staples, token) {
  const products = {}
  const found = {}
  for (const s of staples) {
    if (s.active === false) continue
    let results = []
    // A pinned product only has to appear somewhere in the results, so look further down.
    try { results = await search(s.search, token, s.productId != null ? 30 : 10) } catch (err) { console.log(`  ⚠️  search failed for "${s.search}": ${err.message}`) }
    const p = s.productId != null
      ? results.find((r) => String(r.webshopId) === String(s.productId))
      : results.find(orderable)
    if (!p) continue
    found[s.id] = p
    products[s.id] = {
      externalId: Number(p.webshopId),
      salesUnitSize: p.salesUnitSize ?? null,
      mechanism: p.isBonus ? (p.bonusMechanism ?? null) : null,
    }
  }
  return { products, found }
}

const REASON_TEXT = {
  stock_up: 'on bonus — stocking up', first_time: 'first time', cadence: 'due', running_out: 'bonus stock runs out this week',
  not_yet: 'not due yet', covered: 'covered by bonus stock', skipped: 'skipped this week', inactive: 'inactive',
  missing_product: 'NO PRODUCT FOUND — fix search or productId',
}

// ---------- plan ----------

async function buildPlan() {
  const config = await readJson(STAPLES_FILE, null)
  if (!config) throw new Error('No staples.json — copy spike/ah-api/staples.example.json to staples.json and edit it')
  const state = await readJson(STATE_FILE, { staples: {} })
  const runDate = today()
  const token = await getToken()

  // Planner staple rows: config + what previous sends recorded (last_added_on, covered_until).
  const staples = (config.staples ?? []).map((s, i) => {
    const id = s.id ?? `staple-${i + 1}`
    return {
      id, name: s.name ?? s.search, search: s.search, productId: s.productId ?? null,
      product_id: id,
      quantity: s.quantity ?? 1,
      cadence_weeks: s.everyWeeks ?? 1,
      perishable: s.perishable !== false,
      max_weeks_stock: s.maxWeeksStock ?? null,
      active: s.active !== false,
      skip_next: Boolean(s.skipThisWeek),
      last_added_on: state.staples?.[id]?.last_added_on ?? null,
      covered_until: state.staples?.[id]?.covered_until ?? null,
    }
  })

  console.log(`Run date ${runDate} (${TIME_ZONE}). Looking up ${staples.filter((s) => s.active).length} staples on AH…`)
  const { products, found } = await resolveProducts(staples, token)
  const plan = planWeek({ runDate, staples, products })

  // Extra free-text lines added every run (e.g. "bananen").
  const extras = (config.extras ?? []).filter((t) => typeof t === 'string' && t.trim())
  const target = [...plan.lines, ...extras.map((text) => ({ productId: null, text: text.trim(), packs: 1, sources: ['extra'] }))]

  const listItems = await readList(token)
  const current = listItems.map((i) => {
    const pid = i.productDetails?.product?.webshopId ?? i.productId
    return { productId: pid ? Number(pid) : null, text: i.description ?? '', quantity: i.quantity ?? 0, ticked: Boolean(i.strikedthrough) }
  })
  const changes = diffList(target, current)

  console.log(`\nStaples for the week of ${plan.weekStart}:`)
  for (const d of plan.stapleDecisions) {
    const s = staples.find((x) => x.id === d.staple_id)
    const p = found[d.staple_id]
    const mark = d.included ? `✅ ${String(d.packs).padStart(2)} ×` : '   ·   '
    const product = p ? `${p.title} (${p.salesUnitSize ?? '?'}, ${eur(p.currentPrice ?? p.priceBeforeBonus)}${p.isBonus ? `, BONUS ${p.bonusMechanism ?? ''}` : ''}) [id ${p.webshopId}]` : ''
    console.log(`${mark} ${s.name} — ${REASON_TEXT[d.reason] ?? d.reason}${product ? `\n          ${product}` : ''}`)
  }
  if (extras.length) console.log(`Extras: ${extras.join(', ')}`)

  const names = Object.fromEntries(Object.values(found).map((p) => [Number(p.webshopId), p.title]))
  console.log(`\nChanges to your AH list (${changes.length}):`)
  if (!changes.length) console.log('  none — your list already has everything')
  for (const c of changes) {
    const what = c.productId != null ? (names[c.productId] ?? `product ${c.productId}`) : `"${c.text}"`
    const how = c.action === 'add' ? `add ${c.to}` : c.action === 'untick' ? `untick, set to ${c.to}` : `raise ${c.from} → ${c.to}`
    console.log(`  • ${what}: ${how}`)
  }
  return { plan, changes, names, state, staples, token, target }
}

// ---------- send ----------

function listItemFor(change, names) {
  if (change.productId != null) {
    const title = names[change.productId] ?? String(change.productId)
    return { description: title, productId: change.productId, quantity: change.to, type: 'SHOPPABLE', originCode: 'PRD', searchTerm: title, strikeThrough: false }
  }
  return { description: change.text, quantity: change.to, type: 'SHOPPABLE', originCode: 'TXT', strikeThrough: false }
}

async function cmdSend() {
  const { plan, changes, names, state, token, target } = await buildPlan()
  if (!changes.length) return saveState(plan, state, 'Nothing to send.')
  if (!(await confirm(`\nSend these ${changes.length} changes to your AH list?`))) {
    console.log('Nothing sent.')
    return
  }

  let failed = 0
  for (const c of changes) {
    try {
      await ah('PATCH', LIST_PATH, { token, body: { items: [listItemFor(c, names)] } })
    } catch (err) {
      failed++
      console.log(`  ❌ ${names[c.productId] ?? c.text}: ${err.message}`)
    }
  }

  // Check: diffing again against the updated list should find nothing left to do.
  const after = (await readList(token)).map((i) => {
    const pid = i.productDetails?.product?.webshopId ?? i.productId
    return { productId: pid ? Number(pid) : null, text: i.description ?? '', quantity: i.quantity ?? 0, ticked: Boolean(i.strikedthrough) }
  })
  const remaining = diffList(target, after)

  if (failed || remaining.length) {
    console.log(`\n⚠️  ${failed} change(s) failed and ${remaining.length} still missing on the list. Run history NOT saved — run send again (it's safe to repeat).`)
    exit(1)
  }
  await saveState(plan, state, `\n✅ Sent ${changes.length} changes; your AH list now has everything planned.`)
  console.log('Open the AH app → shopping list → Online bestellen to pick a pickup time and pay.')
}

async function saveState(plan, state, message) {
  const next = { ...state, staples: { ...(state.staples ?? {}) }, lastRun: plan.weekStart }
  for (const u of plan.stapleUpdates) {
    const prev = next.staples[u.staple_id] ?? {}
    next.staples[u.staple_id] = {
      ...prev,
      ...(u.last_added_on !== undefined ? { last_added_on: u.last_added_on } : {}),
      ...(u.covered_until !== undefined ? { covered_until: u.covered_until } : {}),
    }
  }
  await writeJson(STATE_FILE, next)
  console.log(message)
}

// ---------- main ----------

const commands = { plan: () => buildPlan().then(() => console.log('\nDry run only — nothing was sent. Use "send" to write to your AH list.')), send: cmdSend }
const [cmd] = argv.slice(2)
if (!commands[cmd]) {
  console.log('Usage: node spike/ah-api/weekly.mjs plan | send')
  exit(cmd ? 1 : 0)
}
try {
  await commands[cmd]()
} catch (err) {
  console.error(`\n❌ ${err.message}`)
  exit(1)
}
