// Rules for the Social tab (invites, friends, recipe shares), checked in the browser
// before calling the database functions, which enforce the same rules again
// (supabase/migrations/20261121000002_social.sql). Pure: no I/O.

/** Invites one person may send per 24 hours (revoked ones count too). */
export const INVITE_DAILY_LIMIT = 5
/** Days an unused invite stays valid; it is deleted after that. */
export const INVITE_DAYS = 30
/** Longest note on a shared recipe. */
export const SHARE_NOTE_MAX = 280
/** Groups (docs/adr/0011): name length, groups one person can make, members per group (creator included). */
export const GROUP_LIMITS = { name: 40, groupsPerPerson: 10, members: 30 }
/** Most people one share can reach, friends and group members together (step G2). */
export const SHARE_RECIPIENTS_MAX = 60

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

/** → { ok: true, name } (trimmed, spaces squeezed) or { ok: false, message }. */
export function checkGroupName(raw) {
  const name = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : ''
  if (!name) return { ok: false, message: 'Give the group a name.' }
  if (name.length > GROUP_LIMITS.name) return { ok: false, message: `Keep the name under ${GROUP_LIMITS.name} characters.` }
  return { ok: true, name }
}

/** The friends a group's creator can still add (not in it yet), by name; people without a name last. */
export function friendsToAdd(friends, members) {
  const inGroup = new Set((members ?? []).map((m) => m.user_id))
  return (friends ?? [])
    .filter((f) => !inGroup.has(f.id))
    .sort((a, b) => {
      if (!a.display_name) return b.display_name ? 1 : 0
      if (!b.display_name) return -1
      return a.display_name.localeCompare(b.display_name, undefined, { sensitivity: 'base' })
    })
}

/**
 * Who gets a share (step G2): the friends picked, then everyone in the groups picked,
 * each once, never the sender. groups: [{ id, members: [{ user_id }] }] as useGroups loads them.
 */
export function shareRecipients({ me, friendIds = [], groupIds = [], groups = [] } = {}) {
  const out = new Set()
  for (const id of friendIds ?? []) if (id !== me) out.add(id)
  for (const gid of groupIds ?? []) {
    const group = (groups ?? []).find((g) => g.id === gid)
    for (const m of group?.members ?? []) if (m.user_id !== me) out.add(m.user_id)
  }
  return [...out]
}

/** "Recent in <group>" (step G4): uploads from the last uploadDays, at most max items. */
export const GROUP_FEED = { uploadDays: 60, max: 15 }

/**
 * A group's recent activity, newest first: recipes shared in the group (one item per
 * recipe and sender, the latest) and recipes its members uploaded in the last 60 days.
 *   shares   recipe_shares rows I can read, with recipe: { id, name }
 *   recipes  recipes rows with id, name, uploaded_by, created_at, status
 * → [{ kind: 'shared' | 'uploaded', key, recipeId, recipeName, by: { user_id, display_name }, at, note }]
 */
export function buildGroupFeed({ groupId, members = [], shares = [], recipes = [], now = new Date() } = {}) {
  const names = new Map((members ?? []).map((m) => [m.user_id, m.display_name]))
  const by = (id) => ({ user_id: id, display_name: names.get(id) ?? 'Someone' })
  const items = new Map()

  for (const sh of shares ?? []) {
    if (sh.group_id !== groupId) continue
    const key = `s:${sh.recipe_id}:${sh.from_user}`
    const prev = items.get(key)
    if (prev && new Date(prev.at) >= new Date(sh.created_at)) continue
    items.set(key, {
      kind: 'shared', key, recipeId: sh.recipe_id, recipeName: sh.recipe?.name ?? 'A recipe',
      by: by(sh.from_user), at: sh.created_at, note: sh.note ?? null,
    })
  }

  const since = now.getTime() - GROUP_FEED.uploadDays * 24 * 60 * 60 * 1000
  for (const r of recipes ?? []) {
    if (r.status !== 'ready' || !names.has(r.uploaded_by) || new Date(r.created_at).getTime() < since) continue
    const key = `u:${r.id}`
    items.set(key, { kind: 'uploaded', key, recipeId: r.id, recipeName: r.name ?? 'A recipe', by: by(r.uploaded_by), at: r.created_at, note: null })
  }

  return [...items.values()]
    .sort((a, b) => new Date(b.at) - new Date(a.at))
    .slice(0, GROUP_FEED.max)
}

// What the app says for each code the Social database functions raise.
const ERROR_MESSAGES = {
  invalid_email: 'Enter an email address, like name@example.com.',
  already_user: 'That person already uses the app. Use Add friend instead.',
  invite_limit: `You can send ${INVITE_DAILY_LIMIT} invites a day. Try again tomorrow.`,
  not_found: 'There is no one with that email in the app yet. Invite them instead.',
  self: "You can't add yourself.",
  not_friends: 'You can only share with your friends.',
  too_many: 'Too many at once. Try fewer people.',
  invalid_note: `Keep the note under ${SHARE_NOTE_MAX} characters.`,
  not_ready: 'That recipe is not ready yet.',
  not_signed_in: 'Sign in again, then try once more.',
  invalid_group_name: `Give the group a name under ${GROUP_LIMITS.name} characters.`,
  group_limit: `You can make up to ${GROUP_LIMITS.groupsPerPerson} groups. Delete one first.`,
  group_full: `A group can have up to ${GROUP_LIMITS.members} people.`,
  not_group_owner: 'Only the person who made the group can change it.',
  not_group_member: 'You can only share with groups you are in.',
}

/** A readable message for an error from a Social database function (its message holds the code). */
export function socialErrorMessage(raw) {
  const text = typeof raw === 'string' ? raw : ''
  const code = Object.keys(ERROR_MESSAGES).find((c) => new RegExp(`\\b${c}\\b`).test(text))
  return code ? ERROR_MESSAGES[code] : 'Something went wrong. Try again.'
}

const APP_NAME = 'Hello Fresh Trash'

/**
 * The invite email the inviter sends themselves (the app sends no email, docs/adr/0008).
 * → { subject, body, text, mailto }: text is subject + body for copying; mailto opens
 * the inviter's mail app addressed to the invited person. Spaces are %20, not +.
 */
export function inviteMessage({ inviterName, email, appUrl, expiresAt }) {
  const name = typeof inviterName === 'string' && inviterName.trim() ? inviterName.trim() : 'A friend'
  const to = typeof email === 'string' ? email.trim().toLowerCase() : ''
  const until = new Date(expiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  const subject = `${name} invited you to ${APP_NAME}`
  const body = [
    'Hi,',
    '',
    `${name} invited you to ${APP_NAME}, an app for saving recipes and planning the weekly shop together.`,
    '',
    `Open ${appUrl} and sign in with Google using ${to}. The invite only works for that address.`,
    '',
    `The invite is valid until ${until}.`,
  ].join('\n')
  const address = to.split('@').map(encodeURIComponent).join('@')
  const mailto = `mailto:${address}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
  return { subject, body, text: `${subject}\n\n${body}`, mailto }
}
