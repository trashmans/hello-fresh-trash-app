import { describe, it, expect } from 'vitest'
import { AH_LOGIN_URL, linkStatusView, checkPastedLink, formatLinkDate } from '@/lib/ahLink'

describe('AH_LOGIN_URL', () => {
  it('is the AH app login page that redirects to appie://login-exit', () => {
    expect(AH_LOGIN_URL).toBe('https://login.ah.nl/login?client_id=appie-ios&response_type=code&redirect_uri=appie://login-exit')
  })
})

describe('linkStatusView', () => {
  const linked = { state: 'linked', linkedAt: '2026-11-06T10:00:00Z', lastRefreshAt: null }

  it('households without the AH switch see it as not available, with no link form', () => {
    for (const status of [null, linked, { state: 'not_linked' }]) {
      expect(linkStatusView(status, { ahEnabled: false })).toMatchObject({ state: 'unavailable', showLinkForm: false })
    }
    expect(linkStatusView({ state: 'not_linked' }, { ahEnabled: false }).showUnlink).toBe(false)
  })

  it('an existing link can still be removed after the switch is turned off', () => {
    expect(linkStatusView(linked, { ahEnabled: false }).showUnlink).toBe(true)
  })

  it('not linked shows the link form', () => {
    expect(linkStatusView({ state: 'not_linked' }, { ahEnabled: true })).toMatchObject({ state: 'not_linked', showLinkForm: true, showUnlink: false })
  })

  it('linked shows unlink, not the form', () => {
    expect(linkStatusView(linked, { ahEnabled: true })).toMatchObject({ state: 'linked', showLinkForm: false, showUnlink: true })
  })

  it('relink needed shows the form again and still allows unlinking', () => {
    expect(linkStatusView({ state: 'relink_needed' }, { ahEnabled: true })).toMatchObject({ state: 'relink_needed', showLinkForm: true, showUnlink: true })
  })

  it('every view has a title and a description', () => {
    for (const [status, ahEnabled] of [[null, false], [{ state: 'not_linked' }, true], [linked, true], [{ state: 'relink_needed' }, true]]) {
      const view = linkStatusView(status, { ahEnabled })
      expect(view.title.length).toBeGreaterThan(0)
      expect(view.description.length).toBeGreaterThan(0)
    }
  })

  it('an unknown or missing status is treated as not linked', () => {
    expect(linkStatusView(null, { ahEnabled: true }).state).toBe('not_linked')
    expect(linkStatusView({ state: 'weird' }, { ahEnabled: true }).state).toBe('not_linked')
  })
})

describe('checkPastedLink', () => {
  it('is quietly not ready while empty', () => {
    expect(checkPastedLink('')).toEqual({ ok: false, message: null })
    expect(checkPastedLink('   ')).toEqual({ ok: false, message: null })
  })

  it('accepts the appie link, a whole console error, or a bare code', () => {
    expect(checkPastedLink('appie://login-exit?code=Abc123def456').ok).toBe(true)
    expect(checkPastedLink("Failed to launch 'appie://login-exit?code=Abc123def456' because …").ok).toBe(true)
    expect(checkPastedLink('Abc123-def_456.ghi').ok).toBe(true)
  })

  it('explains when the login page link was pasted', () => {
    const r = checkPastedLink(AH_LOGIN_URL)
    expect(r.ok).toBe(false)
    expect(r.message).toMatch(/login page/i)
  })

  it('explains anything else', () => {
    const r = checkPastedLink('hello there')
    expect(r.ok).toBe(false)
    expect(r.message).toMatch(/appie:\/\/login-exit/)
  })
})

describe('formatLinkDate', () => {
  it('formats a timestamp as a short date', () => {
    expect(formatLinkDate('2026-11-06T10:00:00Z', 'en-GB')).toBe('6 Nov 2026')
  })

  it('returns null for missing or invalid dates', () => {
    expect(formatLinkDate(null)).toBeNull()
    expect(formatLinkDate('not a date')).toBeNull()
  })
})
