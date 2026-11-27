// @vitest-environment node
// Food map place search (docs/adr/0012, F1c): what we ask OpenStreetMap's Nominatim and what we keep.
import { describe, it, expect } from 'vitest'
import {
  checkPlaceRequest, reverseUrl, searchUrl, cacheKey, placeFromReverse, placesFromSearch, USER_AGENT, ATTRIBUTION,
} from '../../supabase/functions/_shared/places.ts'

const haarlem = {
  lat: '52.3812098', lon: '4.6368388', name: 'Haarlem', display_name: 'Haarlem, North Holland, Netherlands',
  address: { city: 'Haarlem', state: 'North Holland', country: 'Netherlands', country_code: 'nl' },
}

describe('checkPlaceRequest', () => {
  it('coarsens a reverse lookup to 1 decimal on the server, whatever the browser sent', () => {
    expect(checkPlaceRequest({ mode: 'reverse', lat: 52.38123, lon: 4.63622 })).toEqual({ mode: 'reverse', lat: 52.4, lon: 4.6 })
    expect(checkPlaceRequest({ mode: 'reverse', lat: -33.8568, lon: 151.2153 })).toEqual({ mode: 'reverse', lat: -33.9, lon: 151.2 })
  })
  it('never gives -0', () => {
    const r = checkPlaceRequest({ mode: 'reverse', lat: -0.04, lon: -0.01 })
    expect(Object.is(r.lat, 0) && Object.is(r.lon, 0)).toBe(true)
  })
  it('rejects bad coordinates', () => {
    for (const [lat, lon] of [['52', 4], [NaN, 4], [52, Infinity], [91, 4], [52, -181], [null, null], [undefined, 4]]) {
      expect(checkPlaceRequest({ mode: 'reverse', lat, lon })).toBeNull()
    }
  })
  it('tidies search text and keeps it between 2 and 120 characters', () => {
    expect(checkPlaceRequest({ mode: 'search', q: '  Jay   Fai\n Bangkok ' })).toEqual({ mode: 'search', q: 'Jay Fai Bangkok' })
    expect(checkPlaceRequest({ mode: 'search', q: ' a ' })).toBeNull()
    expect(checkPlaceRequest({ mode: 'search', q: 'x'.repeat(121) })).toBeNull()
    expect(checkPlaceRequest({ mode: 'search', q: 42 })).toBeNull()
  })
  it('rejects anything else', () => {
    expect(checkPlaceRequest(null)).toBeNull()
    expect(checkPlaceRequest('reverse')).toBeNull()
    expect(checkPlaceRequest({ mode: 'details', lat: 1, lon: 1 })).toBeNull()
  })
})

describe('Nominatim requests', () => {
  it('asks for the city (zoom 10) in English, with only the coarse location', () => {
    const u = new URL(reverseUrl({ lat: 52.4, lon: 4.6 }))
    expect(u.origin + u.pathname).toBe('https://nominatim.openstreetmap.org/reverse')
    expect(Object.fromEntries(u.searchParams)).toEqual({
      format: 'jsonv2', lat: '52.4', lon: '4.6', zoom: '10', addressdetails: '1', 'accept-language': 'en',
    })
  })
  it('searches for at most 5 places, text encoded', () => {
    const u = new URL(searchUrl('Café de Klos, Amsterdam'))
    expect(u.pathname).toBe('/search')
    expect(u.searchParams.get('q')).toBe('Café de Klos, Amsterdam')
    expect(u.searchParams.get('limit')).toBe('5')
    expect(u.searchParams.get('format')).toBe('jsonv2')
    expect(u.searchParams.get('accept-language')).toBe('en')
  })
  it('identifies the app, not a default library agent', () => {
    expect(USER_AGENT).toMatch(/^HelloFreshTrash\/\S+ \(\+https:\/\/hello-fresh-trash-app\.vercel\.app\)$/)
    expect(ATTRIBUTION).toBe('© OpenStreetMap contributors')
  })
  it('keys the cache by the coarse cell', () => {
    expect(cacheKey({ lat: 52.4, lon: 4.6 })).toBe('reverse:52.4,4.6:en')
    expect(cacheKey({ lat: 0, lon: -3 })).toBe('reverse:0.0,-3.0:en')
  })
})

describe('placeFromReverse', () => {
  it("gives the city and country with the city's own coordinates", () => {
    expect(placeFromReverse(haarlem)).toEqual({
      label: 'Haarlem, Netherlands', detail: 'Haarlem, North Holland, Netherlands', lat: 52.38121, lon: 4.63684,
    })
  })
  it('falls back to town, village, municipality, county, state, then the name', () => {
    expect(placeFromReverse({ ...haarlem, address: { town: 'Zandvoort', country: 'Netherlands' } }).label).toBe('Zandvoort, Netherlands')
    expect(placeFromReverse({ ...haarlem, address: { county: 'Rural County', state: 'Somewhere', country: 'X' } }).label).toBe('Rural County, X')
    expect(placeFromReverse({ ...haarlem, address: { country: 'Iceland' }, name: 'Iceland' }).label).toBe('Iceland')
  })
  it('gives nothing for an error (the sea) or a broken answer', () => {
    expect(placeFromReverse({ error: 'Unable to geocode' })).toBeNull()
    expect(placeFromReverse({ lat: '1', lon: '2', address: {} })).toBeNull()
    expect(placeFromReverse({ ...haarlem, lat: 'abc' })).toBeNull()
    expect(placeFromReverse({ ...haarlem, lon: '200' })).toBeNull()
    expect(placeFromReverse(null)).toBeNull()
  })
  it('keeps the label within 200 characters', () => {
    const long = placeFromReverse({ ...haarlem, address: { city: 'C'.repeat(250), country: 'N' } })
    expect(long.label.length).toBeLessThanOrEqual(200)
  })
})

describe('placesFromSearch', () => {
  const klos = {
    lat: '52.3667', lon: '4.8822', name: 'Café de Klos', display_name: 'Café de Klos, 21, Kerkstraat, Amsterdam, North Holland, Netherlands',
    address: { amenity: 'Café de Klos', city: 'Amsterdam', country: 'Netherlands' },
  }
  it('gives a short label (name, town, country) and the full address as detail', () => {
    expect(placesFromSearch([klos])).toEqual([{
      label: 'Café de Klos, Amsterdam, Netherlands', detail: klos.display_name, lat: 52.3667, lon: 4.8822,
    }])
  })
  it("doesn't repeat the town when the place is the town", () => {
    const bkk = { lat: '13.7525', lon: '100.4935', name: 'Bangkok', display_name: 'Bangkok, Thailand', address: { city: 'Bangkok', country: 'Thailand' } }
    expect(placesFromSearch([bkk])[0].label).toBe('Bangkok, Thailand')
  })
  it('skips broken results and duplicates, and gives at most 5', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ ...klos, name: `Place ${i}` }))
    expect(placesFromSearch([{ lat: 'x' }, klos, klos, ...many])).toHaveLength(5)
    expect(placesFromSearch([{ lat: 'x' }, klos, klos])).toHaveLength(1)
  })
  it('gives an empty list for anything that is not a list', () => {
    expect(placesFromSearch({ error: 'x' })).toEqual([])
    expect(placesFromSearch(null)).toEqual([])
  })
})
