// Display logic for the Albert Heijn card on the Automated ordering tab. Pure: the page calls the
// link-account Edge Function (src/hooks/useAhLink.js) and uses these to decide what to show.

/** AH's app login page. After login it redirects to appie://login-exit?code=…, which only
 *  shows up in Chrome's console on a computer — that link is what the user pastes back. */
export const AH_LOGIN_URL = 'https://login.ah.nl/login?client_id=appie-ios&response_type=code&redirect_uri=appie://login-exit'

const VIEWS = {
  unavailable: {
    title: 'Not available yet',
    description: "Linking Albert Heijn isn't switched on for your household yet.",
  },
  not_linked: {
    title: 'Not linked',
    description: 'Link your Albert Heijn account so the app can add your weekly shop to your AH shopping list. You still check out and pay in the AH app yourself.',
  },
  linked: {
    title: 'Linked',
    description: 'The app can add items to your AH shopping list. It never removes items, and never orders or pays.',
  },
  relink_needed: {
    title: 'Link expired',
    description: 'Albert Heijn no longer accepts the saved login. Link your account again to keep using it.',
  },
}

const KNOWN = ['linked', 'relink_needed', 'not_linked']

/**
 * What the card shows for a link status ({ state } from link-account, or null while unknown).
 * With the household's AH switch off nothing new can be linked, but an existing link can
 * always be removed.
 */
export function linkStatusView(status, { ahEnabled = false } = {}) {
  const state = KNOWN.includes(status?.state) ? status.state : 'not_linked'
  if (!ahEnabled) {
    return { state: 'unavailable', ...VIEWS.unavailable, showLinkForm: false, showUnlink: state !== 'not_linked' }
  }
  return { state, ...VIEWS[state], showLinkForm: state !== 'linked', showUnlink: state !== 'not_linked' }
}

const LOGIN_CODE = /^[A-Za-z0-9._~-]{10,}$/

/**
 * Checks the pasted text before sending it, so AH's one-time code isn't wasted on a paste
 * that can't work. Same rules as the server (extractLoginCode in _shared/retailer/ahSchema.ts).
 * Returns { ok, message }; message is null when there's nothing to say yet.
 */
export function checkPastedLink(text) {
  const input = typeof text === 'string' ? text.trim() : ''
  if (!input) return { ok: false, message: null }
  if (/code=[^&\s'"]+/.test(input)) return { ok: true, message: null }
  if (input.includes('login.ah.nl/login')) {
    return { ok: false, message: "That's the AH login page link. Open it, log in, then paste the appie://login-exit?code=… link that appears." }
  }
  if (LOGIN_CODE.test(input)) return { ok: true, message: null }
  return { ok: false, message: 'Paste the appie://login-exit?code=… link that appears after you log in to AH.' }
}

/** '2026-11-06T10:00:00Z' → '6 Nov 2026' (Dutch time), or null. */
export function formatLinkDate(iso, locale) {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Amsterdam' }).format(date)
}
