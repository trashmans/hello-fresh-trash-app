// Fetching a page or photo from a link someone pasted (docs/adr/0009), without letting the
// link reach anything but the public web (no SSRF):
//   - only https links that pass checkRecipeUrl() (no IP literals, local names, logins, ports);
//   - every address the host name resolves to must be public (isPrivateAddress), checked
//     before each request and again for every redirect (at most 3, followed by hand);
//   - only the expected content types, at most maxBytes, within timeoutMs overall.
// Remaining risk: the runtime resolves the name again when it connects (DNS rebinding);
// the hosting network does not reach our database or other private services by address.

import { checkRecipeUrl, isPrivateAddress } from './recipeLink.ts'

export class LinkError extends Error {
  constructor(public code: string) { super(code) }
}

const USER_AGENT = 'Mozilla/5.0 (compatible; HelloFreshTrash/1.0; personal recipe import)'
const MAX_REDIRECTS = 3

// deno-lint-ignore no-explicit-any
const denoDns = (globalThis as any).Deno?.resolveDns as ((name: string, type: string) => Promise<string[]>) | undefined

async function resolveWithDoh(host: string, type: 'A' | 'AAAA'): Promise<string[]> {
  const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${type}`, {
    headers: { Accept: 'application/dns-json' },
    signal: AbortSignal.timeout(5000),
  })
  if (!res.ok) { await res.body?.cancel(); return [] }
  const data = await res.json()
  // Type 1 = A, 28 = AAAA; CNAME answers (5) are skipped, their targets follow in the list.
  return (data?.Answer ?? []).filter((a: { type: number }) => a.type === (type === 'A' ? 1 : 28)).map((a: { data: string }) => a.data)
}

async function resolve(host: string, type: 'A' | 'AAAA'): Promise<string[]> {
  try {
    return denoDns ? await denoDns(host, type) : await resolveWithDoh(host, type)
  } catch {
    return []
  }
}

async function assertPublicHost(host: string) {
  const [v4, v6] = await Promise.all([resolve(host, 'A'), resolve(host, 'AAAA')])
  const addresses = [...v4, ...v6]
  if (addresses.length === 0) throw new LinkError('dns')
  if (addresses.some(isPrivateAddress)) throw new LinkError('private_address')
}

async function readLimited(res: Response, maxBytes: number): Promise<Uint8Array> {
  const reader = res.body?.getReader()
  if (!reader) return new Uint8Array()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > maxBytes) { await reader.cancel(); throw new LinkError('too_large') }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) { out.set(c, offset); offset += c.length }
  return out
}

export interface FetchedLink { url: string; type: string; bytes: Uint8Array }

/** Fetches a public https link. Throws LinkError (code: bad_url, dns, private_address, http_NNN, wrong_type, too_large, too_many_redirects, timeout). */
export async function safeFetch(
  rawUrl: string,
  { accept, types, maxBytes, timeoutMs = 10_000 }: { accept: string; types: string[]; maxBytes: number; timeoutMs?: number },
): Promise<FetchedLink> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    let url = rawUrl
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const check = checkRecipeUrl(url)
      if (!check.ok) throw new LinkError('bad_url')
      url = check.url
      await assertPublicHost(new URL(url).hostname)

      const res = await fetch(url, {
        redirect: 'manual',
        headers: { 'User-Agent': USER_AGENT, Accept: accept, 'Accept-Language': 'en,nl;q=0.8' },
        signal: controller.signal,
      })
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location')
        await res.body?.cancel()
        if (!location) throw new LinkError(`http_${res.status}`)
        url = new URL(location, url).href
        continue
      }
      if (!res.ok) { await res.body?.cancel(); throw new LinkError(`http_${res.status}`) }
      const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
      if (!types.includes(type)) { await res.body?.cancel(); throw new LinkError('wrong_type') }
      return { url, type, bytes: await readLimited(res, maxBytes) }
    }
    throw new LinkError('too_many_redirects')
  } catch (err) {
    if (err instanceof LinkError) throw err
    if (controller.signal.aborted) throw new LinkError('timeout')
    throw new LinkError('fetch_failed')
  } finally {
    clearTimeout(timer)
  }
}
