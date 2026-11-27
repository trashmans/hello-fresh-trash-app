// Food photos, phase F1d (docs/adr/0012): the pure steps of adding photos.
import { describe, it, expect } from 'vitest'
import {
  cellKey, lookupCells, foodPhotoPaths, addPhotoArgs, foodPhotoErrorMessage, visibilityLabel, VISIBILITY_DEFAULTS,
} from '@/lib/foodPhotoUpload'

const at = (lat, lon) => ({ exif: { gps: { lat, lon }, takenOn: null } })
const none = { exif: { gps: null, takenOn: '2025-01-01' } }

describe('lookupCells', () => {
  it('gives each rounded location once, in the order first seen', () => {
    const items = [at(52.381, 4.636), at(52.4049, 4.6), none, at(13.7563, 100.5018), at(52.37, 4.62)]
    expect(lookupCells(items)).toEqual([
      { key: '52.4,4.6', lat: 52.4, lon: 4.6 },
      { key: '13.8,100.5', lat: 13.8, lon: 100.5 },
    ])
  })
  it('gives nothing for photos without a location', () => {
    expect(lookupCells([none, none])).toEqual([])
    expect(lookupCells(undefined)).toEqual([])
  })
  it('keys a cell the same way as the photo it came from', () => {
    expect(cellKey({ lat: 52.381, lon: 4.636 })).toBe('52.4,4.6')
    expect(cellKey({ lat: -0.04, lon: 0 })).toBe('0.0,0.0')
  })
})

describe('foodPhotoPaths', () => {
  const user = '00000000-0000-0000-0000-00000000000a'
  it("puts both files in the owner's folder", () => {
    expect(foodPhotoPaths(user, 'f3b0c1d2-1111-4222-8333-444455556666')).toEqual({
      photo: `${user}/f3b0c1d2-1111-4222-8333-444455556666.jpg`,
      thumb: `${user}/f3b0c1d2-1111-4222-8333-444455556666_t.jpg`,
    })
  })
  it('refuses anything that could leave the folder', () => {
    expect(() => foodPhotoPaths(user, '../x')).toThrow()
    expect(() => foodPhotoPaths(user, 'a/b')).toThrow()
    expect(() => foodPhotoPaths('', 'abc')).toThrow()
  })
})

describe('addPhotoArgs', () => {
  const paths = { photo: 'u/1.jpg', thumb: 'u/1_t.jpg' }
  it('sends the place, its precision and the date', () => {
    expect(addPhotoArgs({ paths, place: { label: 'Haarlem, Netherlands', lat: 52.38, lon: 4.63, precision: 'city' }, takenOn: '2025-06-01', visibility: 'friends' })).toEqual({
      p_photo_path: 'u/1.jpg', p_thumb_path: 'u/1_t.jpg', p_place: 'Haarlem, Netherlands', p_lat: 52.38, p_lon: 4.63,
      p_precision: 'city', p_taken_on: '2025-06-01', p_visibility: 'friends', p_group: null,
    })
  })
  it('sends no location at all for a photo without a place', () => {
    const args = addPhotoArgs({ paths, place: null, takenOn: null, visibility: 'only_me' })
    expect([args.p_place, args.p_lat, args.p_lon, args.p_precision, args.p_taken_on]).toEqual([null, null, null, null, null])
    expect(args.p_visibility).toBe('only_me')
  })
  it('sends a group only for group visibility', () => {
    expect(addPhotoArgs({ paths, place: null, visibility: 'group', groupId: 'g1' }).p_group).toBe('g1')
    expect(addPhotoArgs({ paths, place: null, visibility: 'friends', groupId: 'g1' }).p_group).toBeNull()
  })
  it('treats an exact spot as exact', () => {
    expect(addPhotoArgs({ paths, place: { label: 'Café de Klos', lat: 52.3667, lon: 4.8822, precision: 'exact' }, visibility: 'friends' }).p_precision).toBe('exact')
  })
})

describe('foodPhotoErrorMessage', () => {
  it('explains the database and server codes', () => {
    expect(foodPhotoErrorMessage('photo_limit')).toMatch(/300/)
    expect(foodPhotoErrorMessage('ERROR: not_group_member')).toMatch(/group/i)
    expect(foodPhotoErrorMessage('unsupported')).toMatch(/open/i)
    expect(foodPhotoErrorMessage('busy')).toMatch(/moment/i)
  })
  it('falls back to a general message', () => {
    expect(foodPhotoErrorMessage('xyz')).toBe('Something went wrong. Try again.')
    expect(foodPhotoErrorMessage(undefined)).toBe('Something went wrong. Try again.')
  })
})

describe('visibility', () => {
  it('offers friends (the default) and only me in Settings', () => {
    expect(VISIBILITY_DEFAULTS).toEqual(['friends', 'only_me'])
  })
  it('labels who can see a photo', () => {
    expect(visibilityLabel('friends')).toBe('Friends')
    expect(visibilityLabel('only_me')).toBe('Only you')
    expect(visibilityLabel('group', 'Family')).toBe('Family')
    expect(visibilityLabel('group')).toBe('A group')
  })
})
