// @vitest-environment node
// Web Crypto (crypto.subtle) is built into Node and Deno; jsdom's crypto lacks it,
// so this file runs in the plain Node environment.
import { describe, it, expect } from 'vitest'
import {
  sealNewToken, openToken, resealToken, rewrapDataKey, masterKeysFromEnv, TokenCryptoError,
} from '../../supabase/functions/_shared/tokenCrypto.ts'

const randomKey = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
const V1 = randomKey()
const V2 = randomKey()
const KEYS = { 1: V1 }
const ACCOUNT = '7f9c1e2a-0000-4000-8000-000000000001'
const OTHER_ACCOUNT = '7f9c1e2a-0000-4000-8000-000000000002'
const TOKEN = 'ah-refresh-token-example-1234567890'

// Flip one bit in a copy of a byte array.
const flip = (bytes, at = 0) => { const copy = new Uint8Array(bytes); copy[at] ^= 1; return copy }

describe('sealNewToken / openToken', () => {
  it('round-trips a token', async () => {
    const sealed = await sealNewToken(TOKEN, ACCOUNT, KEYS, 1)
    expect(await openToken(sealed, ACCOUNT, KEYS)).toBe(TOKEN)
  })

  it('stores only ciphertext: the plain token is not in any field', async () => {
    const sealed = await sealNewToken(TOKEN, ACCOUNT, KEYS, 1)
    const text = new TextDecoder().decode(sealed.tokenCiphertext)
    expect(text).not.toContain(TOKEN)
    expect(sealed.keyVersion).toBe(1)
    expect(sealed.tokenIv).toHaveLength(12)
    expect(sealed.wrappedKeyIv).toHaveLength(12)
  })

  it('uses a fresh IV and data key every time', async () => {
    const a = await sealNewToken(TOKEN, ACCOUNT, KEYS, 1)
    const b = await sealNewToken(TOKEN, ACCOUNT, KEYS, 1)
    expect(a.tokenIv).not.toEqual(b.tokenIv)
    expect(a.wrappedKeyIv).not.toEqual(b.wrappedKeyIv)
    expect(a.tokenCiphertext).not.toEqual(b.tokenCiphertext)
    expect(a.wrappedKey).not.toEqual(b.wrappedKey)
  })

  it('fails with the wrong master key', async () => {
    const sealed = await sealNewToken(TOKEN, ACCOUNT, KEYS, 1)
    await expect(openToken(sealed, ACCOUNT, { 1: V2 })).rejects.toThrow(TokenCryptoError)
  })

  it('fails for a different account id (a sealed token copied to another row)', async () => {
    const sealed = await sealNewToken(TOKEN, ACCOUNT, KEYS, 1)
    await expect(openToken(sealed, OTHER_ACCOUNT, KEYS)).rejects.toThrow(TokenCryptoError)
  })

  it('fails when the wrapped data key is swapped in from another account', async () => {
    const mine = await sealNewToken(TOKEN, ACCOUNT, KEYS, 1)
    const theirs = await sealNewToken('their-token', OTHER_ACCOUNT, KEYS, 1)
    const mixed = { ...mine, wrappedKey: theirs.wrappedKey, wrappedKeyIv: theirs.wrappedKeyIv }
    await expect(openToken(mixed, ACCOUNT, KEYS)).rejects.toThrow(TokenCryptoError)
  })

  it('fails when any stored field is tampered with', async () => {
    const sealed = await sealNewToken(TOKEN, ACCOUNT, KEYS, 1)
    for (const field of ['tokenCiphertext', 'tokenIv', 'wrappedKey', 'wrappedKeyIv']) {
      await expect(openToken({ ...sealed, [field]: flip(sealed[field]) }, ACCOUNT, KEYS)).rejects.toThrow(TokenCryptoError)
    }
  })

  it('fails clearly when the master key version is not configured', async () => {
    const sealed = await sealNewToken(TOKEN, ACCOUNT, KEYS, 1)
    await expect(openToken({ ...sealed, keyVersion: 3 }, ACCOUNT, KEYS)).rejects.toThrow(/version 3/)
    await expect(sealNewToken(TOKEN, ACCOUNT, KEYS, 2)).rejects.toThrow(/version 2/)
  })

  it('rejects a master key that is not 32 bytes of base64', async () => {
    await expect(sealNewToken(TOKEN, ACCOUNT, { 1: btoa('too short') }, 1)).rejects.toThrow(/32 bytes/)
    await expect(sealNewToken(TOKEN, ACCOUNT, { 1: 'not base64 !!' }, 1)).rejects.toThrow(TokenCryptoError)
  })

  it('rejects an empty token or account id', async () => {
    await expect(sealNewToken('', ACCOUNT, KEYS, 1)).rejects.toThrow(TokenCryptoError)
    await expect(sealNewToken(TOKEN, '', KEYS, 1)).rejects.toThrow(TokenCryptoError)
  })
})

describe('resealToken (after AH rotates the refresh token)', () => {
  it('encrypts the new token with the same data key and a fresh IV', async () => {
    const sealed = await sealNewToken(TOKEN, ACCOUNT, KEYS, 1)
    const next = await resealToken('rotated-token', sealed, ACCOUNT, KEYS)
    expect(await openToken(next, ACCOUNT, KEYS)).toBe('rotated-token')
    expect(next.wrappedKey).toEqual(sealed.wrappedKey)
    expect(next.wrappedKeyIv).toEqual(sealed.wrappedKeyIv)
    expect(next.tokenIv).not.toEqual(sealed.tokenIv)
    expect(next.keyVersion).toBe(1)
  })

  it('refuses to reseal with the wrong account id', async () => {
    const sealed = await sealNewToken(TOKEN, ACCOUNT, KEYS, 1)
    await expect(resealToken('rotated-token', sealed, OTHER_ACCOUNT, KEYS)).rejects.toThrow(TokenCryptoError)
  })
})

describe('rewrapDataKey (master key rotation V1 → V2)', () => {
  it('re-wraps the data key with V2 and leaves the token ciphertext untouched', async () => {
    const sealed = await sealNewToken(TOKEN, ACCOUNT, KEYS, 1)
    const both = { 1: V1, 2: V2 }
    const rewrapped = await rewrapDataKey(sealed, ACCOUNT, both, 2)
    expect(rewrapped.keyVersion).toBe(2)
    expect(rewrapped.tokenCiphertext).toEqual(sealed.tokenCiphertext)
    expect(rewrapped.tokenIv).toEqual(sealed.tokenIv)
    expect(rewrapped.wrappedKey).not.toEqual(sealed.wrappedKey)
    // After rotation V1 can be removed: V2 alone opens it.
    expect(await openToken(rewrapped, ACCOUNT, { 2: V2 })).toBe(TOKEN)
    await expect(openToken(rewrapped, ACCOUNT, { 1: V1 })).rejects.toThrow(TokenCryptoError)
  })
})

describe('masterKeysFromEnv', () => {
  it('reads RETAILER_TOKEN_KEY_V1, _V2, … into { version: key }', () => {
    const env = { RETAILER_TOKEN_KEY_V1: V1, RETAILER_TOKEN_KEY_V2: V2, OTHER_SECRET: 'x' }
    expect(masterKeysFromEnv((name) => env[name])).toEqual({ 1: V1, 2: V2 })
  })

  it('returns an empty object when no key is set', () => {
    expect(masterKeysFromEnv(() => undefined)).toEqual({})
  })
})
