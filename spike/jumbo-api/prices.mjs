#!/usr/bin/env node
// Jumbo price spike (phase J1). Throwaway, run by hand; nothing here is part of the app.
//
// Question: can we look up Jumbo product prices by name, reliably, without an account?
// It loads Jumbo's public product search page for a few terms — what a browser does — and
// reports which machine-readable data the page carries (schema.org JSON-LD, embedded app
// state) and the product fields found in it. Raw pages are saved in out/ (git-ignored) so
// the findings can be checked without asking Jumbo again.
//
// Polite by design: one page per term, 3 seconds apart, at most 5 terms, no login, no
// basket, no hidden API calls. Check Jumbo's terms of use before going further.
//
//   node spike/jumbo-api/prices.mjs                 # melk, olijfolie, kipfilet
//   node spike/jumbo-api/prices.mjs "basmati rijst" knoflook
//   node spike/jumbo-api/prices.mjs --product https://www.jumbo.com/producten/<name>-<sku>
//
// Round 1 found the search page carries only one (sponsored) product; the browser loads
// the rest later. Round 2 (--product) checks whether a product's own page carries its
// price, offer and pack size, so a product found another way (e.g. a Google search, as
// for AH) could be priced from its page.

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'out')
const args = process.argv.slice(2)
const productMode = args[0] === '--product'
const terms = productMode
  ? args.slice(1).filter((u) => /^https:\/\/www\.jumbo\.com\/producten\//.test(u)).slice(0, 5)
  : (args.length ? args : ['melk', 'olijfolie', 'kipfilet']).slice(0, 5)
if (productMode && terms.length === 0) { console.log('Give one to five https://www.jumbo.com/producten/… links.'); process.exit(1) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
mkdirSync(OUT, { recursive: true })

function jsonLd(html) {
  const out = []
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { out.push(JSON.parse(m[1])) } catch { /* skip */ }
  }
  return out
}

// Embedded app state: Next.js, Nuxt or Apollo, whichever the page uses.
function appState(html) {
  const found = {}
  const next = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i)
  if (next) { try { found.next = JSON.parse(next[1]) } catch { found.next = 'unparsable' } }
  if (/window\.__NUXT__/.test(html)) found.nuxt = 'present (script, not JSON)'
  const nuxtData = html.match(/<script[^>]*id=["']__NUXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i)
  if (nuxtData) { try { found.nuxtData = devalue(JSON.parse(nuxtData[1])) } catch { found.nuxtData = 'unparsable' } }
  if (/__APOLLO_STATE__/.test(html)) found.apollo = 'present'
  return found
}

// Nuxt 3 sends its data as one flat array where objects point to other entries by index
// ("devalue"). This rebuilds the real objects, unwrapping Ref/Reactive markers.
function devalue(arr) {
  const memo = new Map()
  const build = (i, depth = 0) => {
    if (typeof i !== 'number' || depth > 40) return i
    if (memo.has(i)) return memo.get(i)
    const v = arr[i]
    if (Array.isArray(v)) {
      if (typeof v[0] === 'string' && /^(Reactive|ShallowReactive|Ref|ShallowRef|EmptyRef|EmptyShallowRef|Set|Map|Date|NuxtError)$/.test(v[0])) return build(v[1], depth + 1)
      const out = []; memo.set(i, out)
      for (const x of v) out.push(build(x, depth + 1))
      return out
    }
    if (v && typeof v === 'object') {
      const out = {}; memo.set(i, out)
      for (const [k, x] of Object.entries(v)) out[k] = build(x, depth + 1)
      return out
    }
    return v
  }
  return build(0)
}

// Walks any JSON for objects that look like products (a title and a price somewhere).
function productsIn(node, out = [], depth = 0) {
  if (!node || typeof node !== 'object' || depth > 25 || out.length >= 10) return out
  if (Array.isArray(node)) { for (const n of node) productsIn(n, out, depth + 1); return out }
  const title = node.title ?? node.name
  const price = node.price ?? node.prices ?? node.offers
  if (typeof title === 'string' && price != null && (node.id ?? node.sku ?? node['@type'])) {
    out.push({
      id: node.id ?? node.sku ?? null,
      title,
      price: JSON.stringify(price).slice(0, 160),
      size: node.quantity ?? node.packSize ?? node.subtitle ?? null,
      image: JSON.stringify(node.image ?? node.imageInfo ?? null).slice(0, 120),
      promo: JSON.stringify(node.promotions ?? node.promotion ?? null).slice(0, 120),
      keys: Object.keys(node).slice(0, 25).join(','),
    })
    return out
  }
  for (const v of Object.values(node)) productsIn(v, out, depth + 1)
  return out
}

for (const [i, term] of terms.entries()) {
  if (i > 0) await sleep(3000)
  const url = productMode ? term : `https://www.jumbo.com/producten/?searchTerms=${encodeURIComponent(term)}`
  const started = Date.now()
  let res
  try {
    res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15', 'accept-language': 'nl-NL,nl;q=0.9' } })
  } catch (err) {
    console.log(`\n== ${term}: request failed: ${err.message}`)
    continue
  }
  const html = await res.text()
  const file = join(OUT, `${productMode ? 'product' : 'search'}-${term.replace(/^https:\/\/www\.jumbo\.com\/producten\//, '').replace(/[^a-z0-9]+/gi, '_').slice(0, 60)}.html`)
  writeFileSync(file, html)
  console.log(`\n== ${term}: HTTP ${res.status}, ${html.length} bytes, ${Date.now() - started} ms → ${file}`)
  if (res.status !== 200) { console.log(html.slice(0, 300)); continue }
  if (/captcha|cf-chl|akamai|access denied/i.test(html.slice(0, 5000))) console.log('   Looks like a bot check or block page.')

  const ld = jsonLd(html)
  const state = appState(html)
  console.log(`   JSON-LD blocks: ${ld.length}; app state: ${Object.keys(state).join(', ') || 'none found'}`)
  const products = [...productsIn(ld), ...productsIn(state)].slice(0, 5)
  if (!products.length) console.log('   No product objects found in the page data (may be loaded later by the browser).')
  for (const p of products) {
    console.log(`   • ${p.title}  [id ${p.id}]  size ${p.size ?? '?'}`)
    console.log(`     price ${p.price}`)
    console.log(`     promo ${p.promo}  image ${p.image}`)
    console.log(`     fields: ${p.keys}`)
  }
}
console.log('\nDone. Paste this output into the chat (or keep it for FINDINGS.md).')
