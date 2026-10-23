#!/usr/bin/env node
// Albert Heijn API spike — zero dependencies, Node 18+.
// Usage: node spike/ah-api/spike.mjs <command>   (see README.md)
//
// Uses AH's unofficial mobile API (endpoints from github.com/gwillem/appie-go).
// Tokens are stored in spike/ah-api/.tokens.json (gitignored). Your AH password
// never passes through this script — you log in in your own browser.

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createInterface } from 'node:readline/promises'
import { stdin, stdout, argv, exit } from 'node:process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const TOKEN_FILE = path.join(DIR, '.tokens.json')
const OUT_DIR = path.join(DIR, 'out')

const API = 'https://api.ah.nl'
const LOGIN = 'https://login.ah.nl'
const CLIENT_ID = 'appie-ios'
const HEADERS = {
  'User-Agent': 'Appie/9.28 (iPhone17,3; iPhone; CPU OS 26_1 like Mac OS X)',
  'x-client-name': 'appie-ios',
  'x-client-version': '9.28',
  'x-application': 'AHWEBSHOP',
  Accept: 'application/json',
  'Content-Type': 'application/json',
}
const DEFAULT_TEST_SEARCH = 'AH halfvolle melk'
const TEST_LABEL = 'HFT spike test item'

// ---------- helpers ----------

async function loadTokens() {
  try { return JSON.parse(await readFile(TOKEN_FILE, 'utf8')) } catch { return null }
}
async function saveTokens(t) {
  await writeFile(TOKEN_FILE, JSON.stringify(t, null, 2), { mode: 0o600 })
}
async function saveOut(name, data) {
  await mkdir(OUT_DIR, { recursive: true })
  await writeFile(path.join(OUT_DIR, `${name}.json`), JSON.stringify(data, null, 2))
}

async function ah(method, p, { body, token, headers = {} } = {}) {
  const h = { ...HEADERS, ...headers }
  if (token) h.Authorization = `Bearer ${token}`
  const res = await fetch(API + p, { method, headers: h, body: body ? JSON.stringify(body) : undefined })
  const text = await res.text()
  let data
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  if (!res.ok) {
    const detail = typeof data === 'string' ? data : JSON.stringify(data)
    const err = new Error(`${method} ${p} → HTTP ${res.status}: ${(detail ?? '').slice(0, 400)}`)
    err.status = res.status
    throw err
  }
  return data
}

function tokensFrom(r, prev = {}) {
  return {
    accessToken: r.access_token,
    refreshToken: r.refresh_token ?? prev.refreshToken,
    memberId: r.member_id ?? prev.memberId ?? null,
    expiresAt: r.expires_in ? Date.now() + r.expires_in * 1000 : null,
    expiresInSeconds: r.expires_in ?? null,
    obtainedAt: new Date().toISOString(),
  }
}

async function refreshTokens(t) {
  t ??= await loadTokens()
  if (!t?.refreshToken) throw new Error('No refresh token — run: node spike/ah-api/spike.mjs login')
  const r = await ah('POST', '/mobile-auth/v1/auth/token/refresh', {
    body: { clientId: CLIENT_ID, refreshToken: t.refreshToken },
  })
  const next = tokensFrom(r, t)
  await saveTokens(next)
  return { next, rotated: next.refreshToken !== t.refreshToken }
}

async function getToken() {
  const t = await loadTokens()
  if (!t) throw new Error('No tokens yet — run: node spike/ah-api/spike.mjs login')
  if (!t.expiresAt || Date.now() > t.expiresAt - 60_000) {
    const { next } = await refreshTokens(t)
    return next.accessToken
  }
  return t.accessToken
}

const eur = (n) => (n == null ? '?' : `€${Number(n).toFixed(2)}`)
function fmtProduct(p) {
  const price = p.currentPrice || p.priceBeforeBonus
  let s = `${String(p.webshopId).padEnd(8)} ${p.title} | ${p.salesUnitSize ?? ''} | ${eur(price)}`
  if (p.isBonus) s += `  BONUS: ${p.bonusMechanism ?? '?'} (was ${eur(p.priceBeforeBonus)})`
  if (p.isOrderable === false || p.availableOnline === false) s += '  [NOT ORDERABLE]'
  return s
}

async function confirm(q) {
  const rl = createInterface({ input: stdin, output: stdout })
  const a = (await rl.question(`${q} [y/N] `)).trim().toLowerCase()
  rl.close()
  return a === 'y' || a === 'yes'
}

const pass = (m) => console.log(`  ✅ ${m}`)
const fail = (m) => console.log(`  ❌ ${m}`)

// ---------- commands ----------

async function cmdLogin() {
  const url = `${LOGIN}/login?client_id=${CLIENT_ID}&response_type=code&redirect_uri=appie://login-exit`
  console.log(`
1. In Chrome, open a NEW tab, open DevTools (Cmd+Option+I) and click the Console tab.
   Leave DevTools open — do NOT paste anything into the Console.
2. Paste this URL into Chrome's ADDRESS BAR (top of the window) and log in to AH:

   ${url}

3. After login, the Console shows a red error like:
     Failed to launch 'appie://login-exit?code=XXXX' ...
   (No error? Network tab → tick "Preserve log" → log in again → find the
   request redirecting to appie://login-exit and copy its Location header.)
4. Copy the appie://... URL from that error and paste it HERE in the terminal.
   Be quick — the code expires within a few minutes.
`)
  const rl = createInterface({ input: stdin, output: stdout })
  const answer = (await rl.question('Paste here: ')).trim()
  rl.close()
  const code = answer.match(/code=([^&\s'"]+)/)?.[1] ?? answer
  if (!code) throw new Error('No code found in input')

  const r = await ah('POST', '/mobile-auth/v1/auth/token', { body: { clientId: CLIENT_ID, code } })
  const t = tokensFrom(r)
  await saveTokens(t)
  console.log('\nLogin result:')
  t.accessToken ? pass('Access token received') : fail('No access token in response')
  t.refreshToken ? pass('Refresh token received') : fail('No refresh token in response')
  console.log(`  Access token lifetime: ${t.expiresInSeconds ? Math.round(t.expiresInSeconds / 60) + ' min' : 'unknown'}`)
  console.log(`  Saved to ${path.relative(process.cwd(), TOKEN_FILE)}`)
}

async function cmdRefresh() {
  console.log('Token refresh:')
  const { next, rotated } = await refreshTokens()
  pass('Refresh succeeded')
  console.log(`  New access token lifetime: ${next.expiresInSeconds ? Math.round(next.expiresInSeconds / 60) + ' min' : 'unknown'}`)
  console.log(`  Refresh token rotated: ${rotated ? 'yes (must save the new one each time)' : 'no (same token reusable)'}`)
}

async function search(term, token, size = 10) {
  const q = new URLSearchParams({ query: term, sortOn: 'RELEVANCE', page: '0', size: String(size) })
  return ah('GET', `/mobile-services/product/search/v2?${q}`, { token })
}

async function cmdSearch(term = DEFAULT_TEST_SEARCH) {
  const token = await getToken()
  console.log(`Product search: "${term}"`)
  const r = await search(term, token)
  await saveOut('search', r)
  const products = r.products ?? []
  products.length ? pass(`${products.length} results (of ${r.page?.totalElements ?? '?'})`) : fail('No results')
  for (const p of products) console.log('  ' + fmtProduct(p))
  const bonusCount = products.filter((p) => p.isBonus).length
  console.log(`  ${bonusCount} of these are on bonus. Raw response: spike/ah-api/out/search.json`)
}

async function cmdBonus() {
  const token = await getToken()
  console.log('Bonus info:')
  const meta = await ah('GET', '/mobile-services/bonuspage/v3/metadata', { token })
  await saveOut('bonus-metadata', meta)
  const periods = meta.periods ?? []
  periods.length ? pass(`${periods.length} bonus period(s) visible`) : fail('No bonus periods in metadata')
  for (const p of periods) console.log(`  Period: ${p.bonusStartDate} → ${p.bonusEndDate}`)

  const today = new Date().toISOString().slice(0, 10)
  const q = new URLSearchParams({ application: 'AHWEBSHOP', date: today })
  const spot = await ah('GET', `/mobile-services/bonuspage/v2/section/spotlight?${q}`, { token })
  await saveOut('bonus-spotlight', spot)
  const items = spot.bonusGroupOrProducts ?? []
  items.length ? pass(`Spotlight section: ${items.length} entries`) : fail('Spotlight section empty')
  for (const it of items.slice(0, 10)) {
    if (it.bonusGroup) {
      const g = it.bonusGroup
      console.log(`  [group ${g.id}] ${g.segmentDescription} — ${g.discountDescription ?? ''}`)
    } else if (it.product) {
      console.log('  ' + fmtProduct(it.product))
    }
  }
  console.log('  Raw responses: spike/ah-api/out/bonus-*.json')
}

async function getCart(token) {
  try {
    const r = await ah('GET', '/mobile-services/order/v1/summaries/active?sortBy=DEFAULT', { token })
    return Array.isArray(r) ? r[0] : r
  } catch (e) {
    if (e.status === 404) return null // no open order yet = empty cart
    throw e
  }
}
const orderHeaders = (o) => (o?.id ? { 'appie-current-order-id': String(o.id) } : {})
const qtyInCart = (o, pid) =>
  (o?.orderedProducts ?? []).find((i) => String(i.product?.webshopId) === String(pid))?.quantity ?? 0

async function setCartQty(token, order, productId, quantity) {
  return ah('PUT', '/mobile-services/order/v1/items?sortBy=DEFAULT', {
    token,
    headers: orderHeaders(order),
    body: { items: [{ productId: Number(productId), quantity, originCode: 'PRD', description: '', strikethrough: false }] },
  })
}

async function cmdCart() {
  const token = await getToken()
  console.log('Cart (active order):')
  const o = await getCart(token)
  await saveOut('cart', o)
  if (!o) return console.log('  ℹ️  No open order (cart is empty). Run cart-test to see if adding an item creates one.')
  pass(`Order ${o.id} — state ${o.state}, type ${o.shoppingType}`)
  const tp = o.totalPrice ?? {}
  console.log(`  Total: ${eur(tp.priceTotalPayable ?? tp.priceAfterDiscount)} (discount ${eur(tp.priceDiscount)})`)
  const d = o.deliveryInformation
  if (d) console.log(`  Slot: ${d.deliveryDate ?? 'none'} ${d.deliveryStartTime ?? ''}-${d.deliveryEndTime ?? ''}`)
  const items = o.orderedProducts ?? []
  console.log(`  ${items.length} line(s):`)
  for (const i of items) console.log(`    ${i.quantity} × ${i.product?.webshopId} ${i.product?.title}`)
}

async function pickTestProduct(token, pid) {
  if (pid) return { webshopId: pid, title: `product ${pid}` }
  const r = await search(DEFAULT_TEST_SEARCH, token, 5)
  const p = (r.products ?? []).find((x) => x.isOrderable !== false)
  if (!p) throw new Error(`No orderable product found for "${DEFAULT_TEST_SEARCH}"`)
  return p
}

async function cmdCartTest(pid) {
  const token = await getToken()
  const p = await pickTestProduct(token, pid)
  console.log(`Cart write test with: ${p.webshopId} ${p.title}`)
  console.log('  (adds 1, verifies, then restores the original quantity)')

  const before = await getCart(token)
  const q0 = qtyInCart(before, p.webshopId)
  console.log(`  Quantity before: ${q0}`)
  let restored = false
  try {
    await setCartQty(token, before, p.webshopId, q0 + 1)
    const mid = await getCart(token)
    const q1 = qtyInCart(mid, p.webshopId)
    q1 === q0 + 1 ? pass(`Add worked (now ${q1})`) : fail(`Expected ${q0 + 1}, cart shows ${q1}`)
    await saveOut('cart-after-add', mid)

    await setCartQty(token, mid, p.webshopId, q0)
    const after = await getCart(token)
    const q2 = qtyInCart(after, p.webshopId)
    restored = q2 === q0
    restored ? pass(`Restore worked (back to ${q2})`) : fail(`Expected ${q0}, cart shows ${q2}`)
  } finally {
    if (!restored) console.log(`  ⚠️  Check your AH cart: ${p.title} should be quantity ${q0}`)
  }
}

async function cmdList() {
  const token = await getToken()
  console.log('Shopping list read:')
  const attempts = [
    ['list-items', '/mobile-services/shoppinglist/v2/items'],
    ['list-lists', '/mobile-services/lists/v3/lists?productId=1'],
  ]
  for (const [name, p] of attempts) {
    try {
      const r = await ah('GET', p, { token })
      await saveOut(name, r)
      const n = Array.isArray(r) ? r.length : Array.isArray(r?.items) ? r.items.length : '?'
      pass(`GET ${p} → ok (${n} entries) — out/${name}.json`)
    } catch (e) {
      fail(e.message)
    }
  }
}

async function addToList(token, item) {
  return ah('PATCH', '/mobile-services/shoppinglist/v2/items', { token, body: { items: [item] } })
}

async function cmdListTest(pid) {
  const token = await getToken()
  const p = await pickTestProduct(token, pid)
  console.log('Shopping list write test:')
  console.log(`  Adds a free-text line "${TEST_LABEL}" and 1 × ${p.title}.`)
  console.log('  You will need to delete both from the AH app afterwards.')
  try {
    await addToList(token, { description: TEST_LABEL, quantity: 1, type: 'SHOPPABLE', originCode: 'PRD', strikeThrough: false })
    pass('Free-text item added')
  } catch (e) { fail(`Free-text add: ${e.message}`) }
  try {
    await addToList(token, {
      description: p.title, productId: Number(p.webshopId), quantity: 1, type: 'SHOPPABLE',
      originCode: 'PRD', searchTerm: p.title, strikeThrough: false,
    })
    pass('Product item added')
  } catch (e) { fail(`Product add: ${e.message}`) }
  await cmdList()
  console.log('  → Open the AH app/site and confirm both items appear on your list, then delete them.')
}

async function cmdAll() {
  const steps = [['Refresh', cmdRefresh], ['Search', () => cmdSearch()], ['Bonus', cmdBonus], ['Cart read', cmdCart], ['List read', cmdList]]
  for (const [name, fn] of steps) {
    console.log(`\n=== ${name} ===`)
    try { await fn() } catch (e) { fail(e.message) }
  }
  console.log('\n=== Write tests ===')
  if (await confirm('Run cart write test (adds 1 test item, then restores)?')) {
    try { await cmdCartTest() } catch (e) { fail(e.message) }
  }
  if (await confirm('Run shopping list write test (adds 2 items you delete manually)?')) {
    try { await cmdListTest() } catch (e) { fail(e.message) }
  }
  console.log('\nDone. Paste this output to Claude, or fill in FINDINGS.md.')
}

// ---------- spike part 2: edit / tick / remove list items ----------

const LIST_PATH = '/mobile-services/shoppinglist/v2/items'

async function readList(token) {
  const r = await ah('GET', LIST_PATH, { token })
  return r?.items ?? []
}
const itemPid = (i) => i.productDetails?.product?.webshopId ?? i.productId
const linesFor = (items, pid) => items.filter((i) => String(itemPid(i)) === String(pid))
const describe = (lines) =>
  lines.length
    ? lines.map((l) => `qty ${l.quantity}${l.strikedthrough ? ' TICKED' : ''} [listItemId ${l.listItemId}]`).join('  +  ')
    : 'not on list'

async function pickProductNotOnList(token, items) {
  for (const term of ['AH Bananen', 'AH Komkommer', 'AH Citroenen']) {
    const r = await search(term, token, 10)
    const p = (r.products ?? []).find((x) => x.isOrderable !== false && !linesFor(items, x.webshopId).length)
    if (p) return p
  }
  throw new Error('Could not find a test product that is not already on your list')
}

async function cmdListEditTest() {
  const token = await getToken()
  const p = await pickProductNotOnList(token, await readList(token))
  const pid = Number(p.webshopId)
  const item = (quantity, extra = {}) => ({
    description: p.title, productId: pid, quantity, type: 'SHOPPABLE',
    originCode: 'PRD', searchTerm: p.title, strikeThrough: false, ...extra,
  })
  const results = {}
  console.log(`List edit test with: ${pid} ${p.title} (not on your list yet)\n`)

  // Runs one API call, then re-reads the list and shows the test product's line(s)
  async function step(label, call) {
    console.log(label)
    let callError = null
    try { await call() } catch (e) { callError = e.message; fail(`call failed: ${e.message}`) }
    const lines = linesFor(await readList(token), pid)
    console.log(`  → list now: ${describe(lines)}`)
    return { lines, callError }
  }

  // 0. Add
  let s = await step('0. Add 1', () => addToList(token, item(1)))
  if (!s.lines.length) return fail('Add did not work — stopping.')

  // 1. Re-send with a new quantity
  s = await step('1. Re-send same product with quantity 3', () => addToList(token, item(3)))
  results.resend =
    s.lines.length > 1 ? 'creates a DUPLICATE line'
    : s.lines[0]?.quantity === 3 ? 'SETS the quantity'
    : s.lines[0]?.quantity === 4 ? 'ADDS to the quantity'
    : `unexpected (${describe(s.lines)})`
  console.log(`  = Re-sending ${results.resend}\n`)

  // 2. Same, but include listItemId
  const id = s.lines[0]?.listItemId
  s = await step(`2. Re-send with listItemId ${id} and quantity 2`, () => addToList(token, item(2, { listItemId: id })))
  results.resendWithId =
    s.lines.length === 1 && s.lines[0].quantity === 2 ? 'SETS the quantity' : `no clean update (${describe(s.lines)})`
  console.log(`  = With listItemId: ${results.resendWithId}\n`)

  // 3. Tick (two possible field names)
  const qty = s.lines[0]?.quantity ?? 1
  s = await step('3a. Tick via strikeThrough: true', () => addToList(token, item(qty, { strikeThrough: true, listItemId: s.lines[0]?.listItemId })))
  results.tick = s.lines.some((l) => l.strikedthrough) ? 'strikeThrough: true' : null
  if (!results.tick) {
    s = await step('3b. Tick via strikedthrough: true', () => addToList(token, item(qty, { strikedthrough: true, listItemId: s.lines[0]?.listItemId })))
    results.tick = s.lines.some((l) => l.strikedthrough) ? 'strikedthrough: true' : 'NOT WORKING'
  }
  console.log(`  = Tick works with: ${results.tick}\n`)

  // 4. Untick
  if (results.tick !== 'NOT WORKING') {
    const field = results.tick.split(':')[0]
    s = await step(`4. Untick via ${field}: false`, () => addToList(token, item(qty, { [field]: false, listItemId: s.lines[0]?.listItemId })))
    results.untick = s.lines.length && s.lines.every((l) => !l.strikedthrough) ? `${field}: false` : 'NOT WORKING'
    console.log(`  = Untick: ${results.untick}\n`)
  }

  // 5. Remove — try methods until the product is gone
  const removers = [
    ['PATCH quantity 0', (l) => addToList(token, item(0))],
    ['PATCH quantity 0 + listItemId', (l) => addToList(token, item(0, { listItemId: l.listItemId }))],
    ['DELETE body {items:[{listItemId}]}', (l) => ah('DELETE', LIST_PATH, { token, body: { items: [{ listItemId: l.listItemId }] } })],
    ['DELETE /items/{listItemId}', (l) => ah('DELETE', `${LIST_PATH}/${l.listItemId}`, { token })],
  ]
  results.remove = 'NOT WORKING'
  for (const [name, fn] of removers) {
    const current = linesFor(await readList(token), pid)
    if (!current.length) break
    s = await step(`5. Remove via ${name}`, async () => { for (const l of current) await fn(l) })
    if (!s.lines.length) { results.remove = name; results.removeFn = fn; break }
  }
  console.log(`  = Remove works with: ${results.remove}\n`)

  // 6. Clean up the Part 1 free-text line, if present
  const leftover = (await readList(token)).filter((i) => i.description === TEST_LABEL)
  if (leftover.length && results.removeFn) {
    console.log(`6. Remove leftover "${TEST_LABEL}" line(s) via ${results.remove}`)
    for (const l of leftover) { try { await results.removeFn(l) } catch (e) { fail(e.message) } }
    const still = (await readList(token)).filter((i) => i.description === TEST_LABEL)
    still.length ? fail('Free-text line still there') : pass('Free-text line removed')
  }

  await saveOut('list-after-edit-test', await readList(token))
  delete results.removeFn
  console.log('\n=== Summary ===')
  console.log(JSON.stringify(results, null, 2))
  if (linesFor(await readList(token), pid).length) console.log(`⚠️  Delete ${p.title} from your AH list by hand.`)
}

async function cmdTextRemoveTest() {
  const token = await getToken()
  const find = async () => (await readList(token)).filter((i) => i.description === TEST_LABEL)
  let lines = await find()
  if (!lines.length) {
    await addToList(token, { description: TEST_LABEL, quantity: 1, type: 'SHOPPABLE', originCode: 'PRD', strikeThrough: false })
    lines = await find()
    console.log(`Added a fresh "${TEST_LABEL}" line to test with.`)
  }
  console.log(`Free-text line: ${describe(lines)}  originCode ${lines[0]?.originCode}`)
  const base = { description: TEST_LABEL, type: 'SHOPPABLE', strikeThrough: false }
  const tries = [
    ['PATCH description + quantity 0', (l) => addToList(token, { ...base, originCode: 'PRD', quantity: 0 })],
    ['PATCH description + quantity 0 + originCode TXT', (l) => addToList(token, { ...base, originCode: 'TXT', quantity: 0 })],
    ['PATCH listItemId + quantity 0', (l) => addToList(token, { ...base, originCode: l.originCode, quantity: 0, listItemId: l.listItemId })],
    ['DELETE /items/{listItemId}', (l) => ah('DELETE', `${LIST_PATH}/${l.listItemId}`, { token })],
  ]
  for (const [name, fn] of tries) {
    lines = await find()
    if (!lines.length) break
    console.log(`\nRemove via ${name}`)
    for (const l of lines) { try { await fn(l) } catch (e) { fail(e.message) } }
    const after = await find()
    console.log(`  → ${after.length ? describe(after) : 'gone'}`)
    if (!after.length) { pass(`Free-text removal works with: ${name}`); return }
  }
  fail('No method removed the free-text line — delete it by hand in the AH app.')
}

const commands = {
  login: cmdLogin, refresh: cmdRefresh, search: cmdSearch, bonus: cmdBonus,
  cart: cmdCart, 'cart-test': cmdCartTest, list: cmdList, 'list-test': cmdListTest, 'list-edit-test': cmdListEditTest, 'text-remove-test': cmdTextRemoveTest, all: cmdAll,
}

const [cmd, ...args] = argv.slice(2)
if (!commands[cmd]) {
  console.log(`Commands: ${Object.keys(commands).join(', ')}\nStart with: node spike/ah-api/spike.mjs login`)
  exit(cmd ? 1 : 0)
}
try {
  await commands[cmd](args.join(' ') || undefined)
} catch (e) {
  console.error(`\n❌ ${e.message}`)
  exit(1)
}
