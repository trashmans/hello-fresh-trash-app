import { describe, it, expect } from 'vitest'
import {
  INVITE_DAILY_LIMIT, INVITE_DAYS, SHARE_NOTE_MAX,
  checkInviteEmail, inviteStatus, invitesLeftToday, checkShareNote, socialErrorMessage, inviteMessage,
  GROUP_LIMITS, checkGroupName, friendsToAdd, shareRecipients, SHARE_RECIPIENTS_MAX,
  buildGroupFeed, GROUP_FEED,
  COMMENT_MAX, checkComment, commentPreview,
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

describe('socialErrorMessage', () => {
  // The database functions raise short codes; the app shows its own words.
  it('explains each code the Social functions raise', () => {
    expect(socialErrorMessage('already_user')).toMatch(/already uses the app.*Add friend/i)
    expect(socialErrorMessage('invite_limit')).toMatch(/5 invites/)
    expect(socialErrorMessage('not_found')).toMatch(/no one.*invite/i)
    expect(socialErrorMessage('self')).toMatch(/yourself/i)
    expect(socialErrorMessage('invalid_email')).toMatch(/email/i)
    expect(socialErrorMessage('not_friends')).toMatch(/friends/i)
    expect(socialErrorMessage('too_many')).toMatch(/too many/i)
  })

  it('finds the code inside a longer database message', () => {
    expect(socialErrorMessage('ERROR: invite_limit')).toBe(socialErrorMessage('invite_limit'))
  })

  it('falls back to a general message', () => {
    expect(socialErrorMessage('something odd')).toMatch(/went wrong/i)
    expect(socialErrorMessage(undefined)).toMatch(/went wrong/i)
  })
})

describe('inviteMessage', () => {
  // The app does not send invite emails (docs/adr/0008); the inviter sends this one
  // themselves, from their own mail app (mailto) or by pasting it (copy).
  const args = {
    inviterName: 'Chris',
    email: 'Jan@Example.NL',
    appUrl: 'https://hello-fresh-trash.vercel.app',
    expiresAt: '2026-12-25T12:00:00Z',
  }

  it('names the inviter in the subject', () => {
    expect(inviteMessage(args).subject).toBe('Chris invited you to Hello Fresh Trash')
  })

  it('falls back to "A friend" when the inviter has no name', () => {
    expect(inviteMessage({ ...args, inviterName: '  ' }).subject).toBe('A friend invited you to Hello Fresh Trash')
    expect(inviteMessage({ ...args, inviterName: null }).subject).toBe('A friend invited you to Hello Fresh Trash')
  })

  it('gives the app link, the address to sign in with, and the expiry date', () => {
    const { body } = inviteMessage(args)
    expect(body).toContain('https://hello-fresh-trash.vercel.app')
    expect(body).toMatch(/sign in with Google using jan@example\.nl/i)
    expect(body).toContain('25 December 2026')
  })

  it('does not say the app sent it', () => {
    expect(inviteMessage(args).body).not.toMatch(/do not reply|automated|no-reply/i)
  })

  it('builds a mailto link to the invited address with the subject and body', () => {
    const { mailto, subject, body } = inviteMessage(args)
    expect(mailto.startsWith('mailto:jan@example.nl?')).toBe(true)
    const params = new URLSearchParams(mailto.split('?')[1])
    expect(params.get('subject')).toBe(subject)
    expect(params.get('body')).toBe(body)
  })

  it('encodes spaces as %20, not +, so mail apps show them as spaces', () => {
    const { mailto } = inviteMessage(args)
    expect(mailto).not.toContain('+')
    expect(mailto).toContain('Chris%20invited%20you')
  })

  it('has a copyable text with the subject first', () => {
    const { text, subject, body } = inviteMessage(args)
    expect(text).toBe(`${subject}\n\n${body}`)
  })
})

describe('GROUP_LIMITS', () => {
  it('matches the database checks (supabase/migrations/…_social_groups.sql)', () => {
    expect(GROUP_LIMITS).toEqual({ name: 40, groupsPerPerson: 10, members: 30 })
  })
})

describe('checkGroupName', () => {
  it('cleans up a name: trims and squeezes spaces, keeps the case', () => {
    expect(checkGroupName('  Family   dinners ')).toEqual({ ok: true, name: 'Family dinners' })
  })

  it('refuses an empty name', () => {
    for (const bad of ['', '   ', null, undefined, 42]) {
      expect([bad, checkGroupName(bad).ok]).toEqual([bad, false])
    }
    expect(checkGroupName('').message).toMatch(/name/i)
  })

  it(`refuses a name over ${40} characters`, () => {
    expect(checkGroupName('a'.repeat(40)).ok).toBe(true)
    expect(checkGroupName('a'.repeat(41))).toEqual({ ok: false, message: 'Keep the name under 40 characters.' })
  })
})

describe('friendsToAdd', () => {
  // The friends a group's creator can still add: not in it yet, in name order.
  const friend = (id, display_name) => ({ id, display_name })

  it('leaves out people already in the group', () => {
    const friends = [friend('b', 'Bea'), friend('a', 'Ann'), friend('c', 'Cas')]
    expect(friendsToAdd(friends, [{ user_id: 'b' }]).map(f => f.id)).toEqual(['a', 'c'])
  })

  it('sorts by name, people without a name last', () => {
    const friends = [friend('x', null), friend('c', 'cas'), friend('a', 'Ann')]
    expect(friendsToAdd(friends, []).map(f => f.id)).toEqual(['a', 'c', 'x'])
  })

  it('gives [] when there is no one to add', () => {
    expect(friendsToAdd([], [])).toEqual([])
    expect(friendsToAdd(null, null)).toEqual([])
  })
})

describe('socialErrorMessage for groups', () => {
  it('explains the group codes', () => {
    expect(socialErrorMessage('invalid_group_name')).toMatch(/name/i)
    expect(socialErrorMessage('group_limit')).toMatch(/10 groups/)
    expect(socialErrorMessage('group_full')).toMatch(/30 people/)
    expect(socialErrorMessage('not_group_owner')).toMatch(/only.*made the group/i)
    expect(socialErrorMessage('not_friends')).toMatch(/friends/i)
  })
})

describe('shareRecipients', () => {
  // Who gets a share (step G2): the friends picked plus everyone in the groups picked,
  // each once, never the sender — the database works out the same list.
  const group = (id, ...userIds) => ({ id, members: userIds.map(user_id => ({ user_id })) })
  const groups = [group('fam', 'me', 'ann', 'bob'), group('club', 'me', 'bob', 'cas', 'dee')]

  it('adds up friends and group members, each once, leaving out the sender', () => {
    expect(shareRecipients({ me: 'me', friendIds: ['eve', 'ann'], groupIds: ['fam', 'club'], groups }))
      .toEqual(['eve', 'ann', 'bob', 'cas', 'dee'])
  })

  it('works with only friends or only groups', () => {
    expect(shareRecipients({ me: 'me', friendIds: ['eve'], groupIds: [], groups })).toEqual(['eve'])
    expect(shareRecipients({ me: 'me', friendIds: [], groupIds: ['fam'], groups })).toEqual(['ann', 'bob'])
  })

  it('ignores a group that is not loaded', () => {
    expect(shareRecipients({ me: 'me', friendIds: [], groupIds: ['gone'], groups })).toEqual([])
  })

  it('gives [] for nothing picked', () => {
    expect(shareRecipients({ me: 'me' })).toEqual([])
  })

  it(`has a limit the database also checks`, () => {
    expect(SHARE_RECIPIENTS_MAX).toBe(60)
  })
})

describe('buildGroupFeed', () => {
  // "Recent in <group>" (step G4): recipes shared in the group and recipes its members
  // uploaded lately, newest first.
  const NOW = new Date('2026-11-26T12:00:00Z')
  const G = 'fam'
  const members = [{ user_id: 'ann', display_name: 'Ann' }, { user_id: 'bob', display_name: 'Bob' }, { user_id: 'me', display_name: 'Chris' }]
  const share = (id, recipe, from, at, over = {}) => ({ id, recipe_id: recipe, recipe: { id: recipe, name: `Recipe ${recipe}` }, from_user: from, group_id: G, note: null, created_at: at, ...over })
  const recipe = (id, by, at, status = 'ready') => ({ id, name: `Recipe ${id}`, uploaded_by: by, created_at: at, status })
  const feed = (shares = [], recipes = []) => buildGroupFeed({ groupId: G, members, shares, recipes, now: NOW })

  it('has limits', () => {
    expect(GROUP_FEED).toEqual({ uploadDays: 60, max: 15 })
  })

  it('merges shares in the group and members\' uploads, newest first', () => {
    const out = feed(
      [share('s1', 'r1', 'ann', '2026-11-25T10:00:00Z', { note: 'Doubled the garlic' })],
      [recipe('r2', 'bob', '2026-11-26T09:00:00Z'), recipe('r3', 'me', '2026-11-20T09:00:00Z')],
    )
    expect(out).toEqual([
      { kind: 'uploaded', key: 'u:r2', recipeId: 'r2', recipeName: 'Recipe r2', by: { user_id: 'bob', display_name: 'Bob' }, at: '2026-11-26T09:00:00Z', note: null },
      { kind: 'shared', key: 's:r1:ann', recipeId: 'r1', recipeName: 'Recipe r1', by: { user_id: 'ann', display_name: 'Ann' }, at: '2026-11-25T10:00:00Z', note: 'Doubled the garlic' },
      { kind: 'uploaded', key: 'u:r3', recipeId: 'r3', recipeName: 'Recipe r3', by: { user_id: 'me', display_name: 'Chris' }, at: '2026-11-20T09:00:00Z', note: null },
    ])
  })

  it('leaves out shares made outside this group', () => {
    expect(feed([share('s1', 'r1', 'ann', '2026-11-25T10:00:00Z', { group_id: 'other' }), share('s2', 'r9', 'ann', '2026-11-25T10:00:00Z', { group_id: null })])).toEqual([])
  })

  it('shows one item when the same person shared a recipe more than once (the latest)', () => {
    const out = feed([share('s1', 'r1', 'ann', '2026-11-20T10:00:00Z'), share('s2', 'r1', 'ann', '2026-11-24T10:00:00Z', { note: 'Again!' })])
    expect(out.map(i => [i.key, i.at, i.note])).toEqual([['s:r1:ann', '2026-11-24T10:00:00Z', 'Again!']])
  })

  it('leaves out uploads by non-members, unfinished uploads, and uploads older than 60 days', () => {
    const out = feed([], [
      recipe('r1', 'stranger', '2026-11-25T09:00:00Z'),
      recipe('r2', 'ann', '2026-11-25T09:00:00Z', 'processing'),
      recipe('r3', 'ann', '2026-09-26T11:00:00Z'),
      recipe('r4', 'ann', '2026-09-27T13:00:00Z'),
    ])
    expect(out.map(i => i.recipeId)).toEqual(['r4'])
  })

  it('names someone who left the group "Someone"', () => {
    expect(feed([share('s1', 'r1', 'gone', '2026-11-25T10:00:00Z')])[0].by).toEqual({ user_id: 'gone', display_name: 'Someone' })
  })

  it('keeps the newest 15', () => {
    const recipes = Array.from({ length: 20 }, (_, i) => recipe(`r${i}`, 'ann', `2026-11-${String(i + 1).padStart(2, '0')}T09:00:00Z`))
    const out = feed([], recipes)
    expect(out).toHaveLength(15)
    expect(out[0].recipeId).toBe('r19')
  })

  it('gives [] for nothing', () => {
    expect(buildGroupFeed({ groupId: G, members, now: NOW })).toEqual([])
  })
})

describe('checkComment', () => {
  // Group comments on recipes (step G5): 1–500 characters.
  it('is at most 500 characters, like the database check', () => {
    expect(COMMENT_MAX).toBe(500)
    expect(checkComment('a'.repeat(500)).ok).toBe(true)
    expect(checkComment('a'.repeat(501))).toEqual({ ok: false, message: 'Keep the comment under 500 characters.' })
  })

  it('trims the ends and keeps at most one empty line between paragraphs', () => {
    expect(checkComment('  Made this.\n\n\n\nAdd more garlic.  ')).toEqual({ ok: true, body: 'Made this.\n\nAdd more garlic.' })
  })

  it('refuses an empty comment', () => {
    for (const bad of ['', '   ', '\n\n', null, undefined]) expect([bad, checkComment(bad).ok]).toEqual([bad, false])
  })
})

describe('commentPreview', () => {
  it("gives a comment's first line, cut to 120 characters", () => {
    expect(commentPreview('Made this.\n\nAdd more garlic.')).toBe('Made this.')
    expect(commentPreview('x'.repeat(130))).toBe(`${'x'.repeat(119)}…`)
    expect(commentPreview('')).toBe('')
  })
})

describe('buildGroupFeed with comments', () => {
  const NOW = new Date('2026-11-26T12:00:00Z')
  const members = [{ user_id: 'ann', display_name: 'Ann' }]
  const comment = (id, at, over = {}) => ({ id, group_id: 'fam', recipe_id: 'r1', recipe: { id: 'r1', name: 'Wings' }, author: 'ann', body: 'Made this.\nMore garlic.', created_at: at, ...over })

  it("adds 'commented' items with the comment's first line, in date order with the rest", () => {
    const out = buildGroupFeed({
      groupId: 'fam', members, now: NOW,
      comments: [comment('c1', '2026-11-25T10:00:00Z')],
      recipes: [{ id: 'r2', name: 'Curry', uploaded_by: 'ann', created_at: '2026-11-26T09:00:00Z', status: 'ready' }],
    })
    expect(out.map(i => [i.kind, i.key, i.recipeName, i.note])).toEqual([
      ['uploaded', 'u:r2', 'Curry', null],
      ['comment', 'c:c1', 'Wings', 'Made this.'],
    ])
  })

  it('leaves out comments in other groups', () => {
    expect(buildGroupFeed({ groupId: 'fam', members, now: NOW, comments: [comment('c1', '2026-11-25T10:00:00Z', { group_id: 'club' })] })).toEqual([])
  })
})

describe('socialErrorMessage for comments', () => {
  it('explains the comment codes', () => {
    expect(socialErrorMessage('invalid_comment')).toMatch(/500 characters/)
    expect(socialErrorMessage('comment_limit')).toMatch(/30 comments/)
    expect(socialErrorMessage('not_group_member')).toMatch(/groups you are in/)
  })
})
