// Rules for the Social tab (invites, friends, recipe shares), checked in the browser
// before calling the database functions, which enforce the same rules again
// (supabase/migrations/20261121000002_social.sql). Pure: no I/O.

/** Invites one person may send per 24 hours (revoked ones count too). */
export const INVITE_DAILY_LIMIT = 5
/** Days an unused invite stays valid; it is deleted after that. */
export const INVITE_DAYS = 30
/** Longest note on a shared recipe. */
export const SHARE_NOTE_MAX = 280

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DAY_MS = 24 * 60 * 60 * 1000

/** → { ok: true, email } (trimmed, lower case) or { ok: false, message }. */
export function checkInviteEmail(raw) {
  const email = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  if (!EMAIL.test(email) || email.length > 254) {
    return { ok: false, message: 'Enter an email address, like name@example.com.' }
  }
  return { ok: true, email }
}

/** 'accepted' | 'revoked' | 'expired' | 'pending' for an invites row at time now. */
export function inviteStatus(invite, now = new Date()) {
  if (invite?.accepted_at) return 'accepted'
  if (invite?.revoked_at) return 'revoked'
  if (new Date(invite?.expires_at).getTime() <= now.getTime()) return 'expired'
  return 'pending'
}

/** How many more invites the user may send now, from the invites they sent (any status). */
export function invitesLeftToday(sent, now = new Date()) {
  const since = now.getTime() - DAY_MS
  const recent = (sent ?? []).filter((i) => new Date(i.created_at).getTime() > since).length
  return Math.max(0, INVITE_DAILY_LIMIT - recent)
}

/** → { ok: true, note } (trimmed, null when empty) or { ok: false, message }. */
export function checkShareNote(raw) {
  const note = typeof raw === 'string' ? raw.trim() : ''
  if (note.length > SHARE_NOTE_MAX) {
    return { ok: false, message: `Keep the note under ${SHARE_NOTE_MAX} characters.` }
  }
  return { ok: true, note: note || null }
}
