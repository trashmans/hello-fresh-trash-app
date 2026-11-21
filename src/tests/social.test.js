import { describe, it, expect } from 'vitest'
import {
  INVITE_DAILY_LIMIT, INVITE_DAYS, SHARE_NOTE_MAX,
  checkInviteEmail, inviteStatus, invitesLeftToday, checkShareNote,
} from '@/lib/social'

// The rules the Social tab shows before calling the database functions, which enforce
// the same rules again (supabase/migrations/…_social.sql).

describe('checkInviteEmail', () => {
  it('cleans up an email: trims and lower-cases it', () => {
    expect(checkInviteEmail('  Jan.de.Vries@Example.NL ')).toEqual({ ok: true, email: 'jan.de.vries@example.nl' })
  })

  it('refuses something that is not an email', () => {
    for (const bad of ['', '   ', 'jan', 'jan@', '@example.nl', 'jan@example', 'jan @example.nl', 'jan@@example.nl', null, undefined, 42]) {
      expect([bad, checkInviteEmail(bad).ok]).toEqual([bad, false])
    }
  })

  it('refuses an email longer than 254 characters', () => {
    const long = `${'a'.repeat(250)}@x.nl`
    expect(checkInviteEmail(long).ok).toBe(false)
  })

  it('says what to fix', () => {
    expect(checkInviteEmail('jan').message).toMatch(/email/i)
  })
})

describe('inviteStatus', () => {
  const NOW = new Date('2026-11-21T12:00:00Z')
  const invite = (over) => ({ created_at: '2026-11-20T12:00:00Z', expires_at: '2026-12-20T12:00:00Z', accepted_at: null, revoked_at: null, ...over })

  it(`lasts ${INVITE_DAYS} days`, () => {
    expect(INVITE_DAYS).toBe(30)
  })

  it('is pending until it is used, revoked or expires', () => {
    expect(inviteStatus(invite(), NOW)).toBe('pending')
  })

  it('is accepted once the person has signed in, even after the expiry date', () => {
    expect(inviteStatus(invite({ accepted_at: '2026-11-21T09:00:00Z', expires_at: '2026-11-21T10:00:00Z' }), NOW)).toBe('accepted')
  })

  it('is revoked when the inviter takes it back', () => {
    expect(inviteStatus(invite({ revoked_at: '2026-11-21T09:00:00Z' }), NOW)).toBe('revoked')
  })

  it('is expired after its expiry time', () => {
    expect(inviteStatus(invite({ expires_at: '2026-11-21T11:59:59Z' }), NOW)).toBe('expired')
  })
})

describe('invitesLeftToday', () => {
  const NOW = new Date('2026-11-21T12:00:00Z')
  const sent = (created_at) => ({ created_at })

  it(`allows ${INVITE_DAILY_LIMIT} invites in 24 hours`, () => {
    expect(invitesLeftToday([], NOW)).toBe(INVITE_DAILY_LIMIT)
    expect(invitesLeftToday([sent('2026-11-21T08:00:00Z'), sent('2026-11-20T13:00:00Z')], NOW)).toBe(INVITE_DAILY_LIMIT - 2)
  })

  it('only counts invites from the last 24 hours, revoked ones included', () => {
    expect(invitesLeftToday([sent('2026-11-20T11:59:00Z'), { ...sent('2026-11-21T10:00:00Z'), revoked_at: '2026-11-21T10:05:00Z' }], NOW)).toBe(INVITE_DAILY_LIMIT - 1)
  })

  it('never goes below zero', () => {
    const many = Array.from({ length: INVITE_DAILY_LIMIT + 2 }, () => sent('2026-11-21T11:00:00Z'))
    expect(invitesLeftToday(many, NOW)).toBe(0)
  })
})

describe('checkShareNote', () => {
  it('allows no note', () => {
    expect(checkShareNote('')).toEqual({ ok: true, note: null })
    expect(checkShareNote('   ')).toEqual({ ok: true, note: null })
    expect(checkShareNote(undefined)).toEqual({ ok: true, note: null })
  })

  it('trims a note and keeps line breaks', () => {
    expect(checkShareNote('  Doubled the garlic.\nWorth it. ')).toEqual({ ok: true, note: 'Doubled the garlic.\nWorth it.' })
  })

  it(`refuses a note over ${SHARE_NOTE_MAX} characters`, () => {
    expect(SHARE_NOTE_MAX).toBe(280)
    expect(checkShareNote('a'.repeat(SHARE_NOTE_MAX)).ok).toBe(true)
    const tooLong = checkShareNote('a'.repeat(SHARE_NOTE_MAX + 1))
    expect(tooLong.ok).toBe(false)
    expect(tooLong.message).toMatch(/280/)
  })
})
