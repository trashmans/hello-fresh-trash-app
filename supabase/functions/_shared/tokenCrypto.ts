// Envelope encryption for retailer refresh tokens (docs/adr/0003-retailer-token-handling.md).
//
//   data key    32 random bytes, one per retailer account. Encrypts that account's token.
//   master key  one per Supabase project, from the RETAILER_TOKEN_KEY_V<n> function secret.
//               Encrypts ("wraps") every data key. Never stored in the database.
//
// Both layers are AES-256-GCM via Web Crypto (built into Deno and Node), with a fresh random
// 12-byte IV every time. The account id is bound in as associated data on both layers, so a
// sealed token or wrapped key copied into another account's row fails to decrypt. The wrapped
// key is also bound to its key version, so a row can't be relabelled to another master key.
//
// Pure: no database, no network. Plain tokens and keys exist only in memory during a call,
// and raw data-key bytes are zeroed as soon as they've been imported or wrapped.
//
// Stored per account (private.retailer_accounts, bytea columns):
//   tokenCiphertext + tokenIv     refresh token, encrypted with the data key
//   wrappedKey + wrappedKeyIv     data key, encrypted with master key `keyVersion`
//   keyVersion                    which RETAILER_TOKEN_KEY_V<n> wrapped the data key

export class TokenCryptoError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TokenCryptoError'
  }
}

export interface SealedToken {
  tokenCiphertext: Uint8Array
  tokenIv: Uint8Array
  wrappedKey: Uint8Array
  wrappedKeyIv: Uint8Array
  keyVersion: number
}

/** Master keys by version: { 1: '<base64 of 32 bytes>', 2: '…' }. */
export type MasterKeys = Record<number, string>

const KEY_BYTES = 32
const IV_BYTES = 12
const MAX_KEY_VERSION = 9
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const subtle = () => globalThis.crypto.subtle

const tokenAad = (accountId: string) => encoder.encode(`token:${accountId}`)
const keyAad = (accountId: string, version: number) => encoder.encode(`key:${accountId}:v${version}`)

function requireText(value: unknown, what: string): string {
  if (typeof value !== 'string' || value === '') throw new TokenCryptoError(`${what} is required`)
  return value
}

function requireBytes(value: unknown, what: string): Uint8Array {
  if (!(value instanceof Uint8Array) || value.length === 0) throw new TokenCryptoError(`${what} is missing`)
  return value
}

function masterKeyBytes(keys: MasterKeys, version: number): Uint8Array {
  if (!Number.isInteger(version) || version < 1 || version > MAX_KEY_VERSION) {
    throw new TokenCryptoError(`Invalid master key version ${version}`)
  }
  const b64 = keys?.[version]
  if (!b64) throw new TokenCryptoError(`Master key version ${version} is not configured (RETAILER_TOKEN_KEY_V${version})`)
  if (typeof b64 !== 'string' || !BASE64.test(b64)) {
    throw new TokenCryptoError(`Master key version ${version} is not valid base64`)
  }
  let raw: Uint8Array
  try {
    raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
  } catch {
    throw new TokenCryptoError(`Master key version ${version} is not valid base64`)
  }
  if (raw.length !== KEY_BYTES) {
    raw.fill(0)
    throw new TokenCryptoError(`Master key version ${version} must be 32 bytes (base64), got ${raw.length}`)
  }
  return raw
}

async function importAesKey(raw: Uint8Array): Promise<CryptoKey> {
  try {
    return await subtle().importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
  } finally {
    raw.fill(0)
  }
}

const masterKey = (keys: MasterKeys, version: number) => importAesKey(masterKeyBytes(keys, version))

async function encrypt(key: CryptoKey, data: Uint8Array, aad: Uint8Array) {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const ciphertext = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, data))
  return { ciphertext, iv }
}

async function decrypt(key: CryptoKey, ciphertext: Uint8Array, iv: Uint8Array, aad: Uint8Array): Promise<Uint8Array> {
  try {
    return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, ciphertext))
  } catch {
    // GCM gives no detail on purpose; any of these produce the same failure.
    throw new TokenCryptoError('Could not decrypt: wrong master key, wrong account, or the stored data was changed')
  }
}

// Decrypts the wrapped data key; the raw bytes are returned only to callers that zero them.
async function unwrapRaw(sealed: SealedToken, accountId: string, keys: MasterKeys): Promise<Uint8Array> {
  const master = await masterKey(keys, sealed.keyVersion)
  return decrypt(
    master,
    requireBytes(sealed.wrappedKey, 'wrappedKey'),
    requireBytes(sealed.wrappedKeyIv, 'wrappedKeyIv'),
    keyAad(accountId, sealed.keyVersion),
  )
}

const unwrapDataKey = async (sealed: SealedToken, accountId: string, keys: MasterKeys) =>
  importAesKey(await unwrapRaw(sealed, accountId, keys))

/** Linking an account: new data key, encrypts the token with it, wraps it with master key `keyVersion`. */
export async function sealNewToken(token: string, accountId: string, keys: MasterKeys, keyVersion: number): Promise<SealedToken> {
  requireText(token, 'Token')
  requireText(accountId, 'Account id')
  const master = await masterKey(keys, keyVersion)

  const raw = globalThis.crypto.getRandomValues(new Uint8Array(KEY_BYTES))
  let wrapped
  try {
    wrapped = await encrypt(master, raw, keyAad(accountId, keyVersion))
  } catch (err) {
    raw.fill(0)
    throw err
  }
  const dataKey = await importAesKey(raw) // zeroes raw
  const sealedToken = await encrypt(dataKey, encoder.encode(token), tokenAad(accountId))

  return {
    tokenCiphertext: sealedToken.ciphertext,
    tokenIv: sealedToken.iv,
    wrappedKey: wrapped.ciphertext,
    wrappedKeyIv: wrapped.iv,
    keyVersion,
  }
}

/** Every AH call: unwraps the data key and returns the plain refresh token. */
export async function openToken(sealed: SealedToken, accountId: string, keys: MasterKeys): Promise<string> {
  requireText(accountId, 'Account id')
  const dataKey = await unwrapDataKey(sealed, accountId, keys)
  const plain = await decrypt(
    dataKey,
    requireBytes(sealed.tokenCiphertext, 'tokenCiphertext'),
    requireBytes(sealed.tokenIv, 'tokenIv'),
    tokenAad(accountId),
  )
  return decoder.decode(plain)
}

/** After AH rotates the refresh token: same data key, new ciphertext and IV. */
export async function resealToken(newToken: string, sealed: SealedToken, accountId: string, keys: MasterKeys): Promise<SealedToken> {
  requireText(newToken, 'Token')
  requireText(accountId, 'Account id')
  const dataKey = await unwrapDataKey(sealed, accountId, keys)
  const next = await encrypt(dataKey, encoder.encode(newToken), tokenAad(accountId))
  return { ...sealed, tokenCiphertext: next.ciphertext, tokenIv: next.iv }
}

/** Master key rotation: re-wraps the data key with `toVersion`. The token ciphertext is untouched. */
export async function rewrapDataKey(sealed: SealedToken, accountId: string, keys: MasterKeys, toVersion: number): Promise<SealedToken> {
  requireText(accountId, 'Account id')
  const newMaster = await masterKey(keys, toVersion)
  const raw = await unwrapRaw(sealed, accountId, keys)
  try {
    const wrapped = await encrypt(newMaster, raw, keyAad(accountId, toVersion))
    return { ...sealed, wrappedKey: wrapped.ciphertext, wrappedKeyIv: wrapped.iv, keyVersion: toVersion }
  } finally {
    raw.fill(0)
  }
}

/** Reads RETAILER_TOKEN_KEY_V1 … V9 with the given getter, e.g. (name) => Deno.env.get(name). */
export function masterKeysFromEnv(get: (name: string) => string | undefined): MasterKeys {
  const keys: MasterKeys = {}
  for (let version = 1; version <= MAX_KEY_VERSION; version++) {
    const value = get(`RETAILER_TOKEN_KEY_V${version}`)
    if (value) keys[version] = value
  }
  return keys
}
