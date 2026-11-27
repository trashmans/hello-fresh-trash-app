// Food photos, phase F1d (docs/adr/0012): the pure steps of adding photos, between reading
// them (foodPhotos.js) and the upload screen (FoodPhotosCard). No network here.

import { coarsen } from './foodPhotos'

/** Who can see new photos, as offered in Settings ('friends' is the default). */
export const VISIBILITY_DEFAULTS = ['friends', 'only_me']

/** The key of a rounded location (one decimal), the same as the server's cache cell. */
export function cellKey(gps) {
  const c = coarsen(gps)
  const f = (v) => (v + 0).toFixed(1)
  return `${f(c.lat)},${f(c.lon)}`
}

/** Each rounded location in a batch once, in the order first seen: what goes to place search. */
export function lookupCells(items) {
  const cells = []
  const seen = new Set()
  for (const item of items ?? []) {
    const gps = item?.exif?.gps
    if (!gps) continue
    const key = cellKey(gps)
    if (seen.has(key)) continue
    seen.add(key)
    const c = coarsen(gps)
    cells.push({ key, lat: c.lat + 0, lon: c.lon + 0 })
  }
  return cells
}

const SAFE = /^[A-Za-z0-9-]+$/

/** Storage paths for a photo and its thumbnail in the owner's folder of the food-photos bucket. */
export function foodPhotoPaths(userId, id) {
  if (!SAFE.test(userId ?? '') || !SAFE.test(id ?? '')) throw new Error('invalid_path')
  return { photo: `${userId}/${id}.jpg`, thumb: `${userId}/${id}_t.jpg` }
}

/** Arguments for add_food_photo. place: { label, lat, lon, precision } or null (no place). */
export function addPhotoArgs({ paths, place, takenOn = null, visibility, groupId = null }) {
  return {
    p_photo_path: paths.photo,
    p_thumb_path: paths.thumb,
    p_place: place ? place.label : null,
    p_lat: place ? place.lat : null,
    p_lon: place ? place.lon : null,
    p_precision: place ? (place.precision === 'exact' ? 'exact' : 'city') : null,
    p_taken_on: takenOn ?? null,
    p_visibility: visibility,
    p_group: visibility === 'group' ? groupId : null,
  }
}

const MESSAGES = {
  photo_limit: 'You can keep up to 300 food photos. Delete some first.',
  not_group_member: "You're not in that group any more.",
  invalid_location: "That place couldn't be saved. Pick it again.",
  invalid_visibility: 'Choose who can see the photo again.',
  invalid_path: 'Something went wrong. Try again.',
  not_found: 'That photo is gone.',
  unsupported: "This browser can't open that photo. Try a JPG, or Safari for HEIC photos.",
  gps_left: "That photo's location couldn't be removed, so it wasn't added.",
  too_many: 'You have looked up many places this hour. Try again later.',
  busy: 'Place search is busy. Try again in a moment.',
  not_signed_in: 'Sign in again, then try once more.',
}

/** A message for a database, server or photo error code (found anywhere in the text). */
export function foodPhotoErrorMessage(raw) {
  const text = typeof raw === 'string' ? raw : ''
  const code = Object.keys(MESSAGES).find((c) => new RegExp(`\\b${c}\\b`).test(text))
  return code ? MESSAGES[code] : 'Something went wrong. Try again.'
}

/** Who can see a photo, in a few words. */
export function visibilityLabel(visibility, groupName) {
  if (visibility === 'friends') return 'Friends'
  if (visibility === 'only_me') return 'Only you'
  return groupName || 'A group'
}
