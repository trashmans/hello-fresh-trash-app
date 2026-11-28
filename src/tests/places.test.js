// @vitest-environment node
// Food map place search (docs/adr/0012): what we ask Geoapify and what we keep (since 28 Nov;
// OpenStreetMap's own Nominatim blocked Supabase's shared servers).
import { describe, it, expect } from 'vitest'
import {
  checkPlaceRequest, reverseUrl, searchUrl, cacheKey, placeFromReverse, placesFromSearch, ATTRIBUTION,
} from '../../supabase/functions/_shared/places.ts'

const KEY = 'test-key'
const haarlem = {
  name: 'Haarlem', city: 'Haarlem', state: 'North Holland', country: 'Netherlands', country_code: 'nl',
  lat: 52.3812098, lon: 4.6368388, formatted: 'Haarlem, North Holland, Netherlands', result_type: 'city',
}
const reply = (...results) => ({ results, query: {} })

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

describe('Geoapify requests', () => {
  it('asks for the city in English, with only the coarse location', () => {
    const u = new URL(reverseUrl({ lat: 52.4, lon: 4.6 }, KEY))
    expect(u.origin + u.pathname).toBe('https://api.geoapify.com/v1/geocode/reverse')
    expect(Object.fromEntries(u.searchParams)).toEqual({
      lat: '52.4', lon: '4.6', type: 'city', lang: 'en', format: 'json', apiKey: KEY,
    })
  })
  it('searches for at most 5 places, text encoded', () => {
    const u = new URL(searchUrl('Café de Klos, Amsterdam', KEY))
    expect(u.origin + u.pathname).toBe('https://api.geoapify.com/v1/geocode/search')
    expect(Object.fromEntries(u.searchParams)).toEqual({
      text: 'Café de Klos, Amsterdam', limit: '5', lang: 'en', format: 'json', apiKey: KEY,
    })
  })
  it('credits Geoapify and OpenStreetMap', () => {
    expect(ATTRIBUTION).toBe('Powered by Geoapify · © OpenStreetMap contributors')
  })
  it('keys the cache by the coarse cell', () => {
    expect(cacheKey({ lat: 52.4, lon: 4.6 })).toBe('geoapify:52.4,4.6:en')
    expect(cacheKey({ lat: 0, lon: -3 })).toBe('geoapify:0.0,-3.0:en')
  })
})

describe('placeFromReverse', () => {
  it("gives the city and country with the city's own coordinates", () => {
    expect(placeFromReverse(reply(haarlem))).toEqual({
      label: 'Haarlem, Netherlands', detail: 'Haarlem, North Holland, Netherlands', lat: 52.38121, lon: 4.63684, precision: 'city',
    })
  })
  it('falls back to county, state, then the name', () => {
    expect(placeFromReverse(reply({ ...haarlem, city: undefined, county: 'Rural County', state: 'Somewhere', country: 'X' })).label).toBe('Rural County, X')
    expect(placeFromReverse(reply({ ...haarlem, city: undefined, name: 'Iceland', state: undefined, country: 'Iceland' })).label).toBe('Iceland')
  })
  it('gives nothing for no result (the sea) or a broken answer', () => {
    expect(placeFromReverse(reply())).toBeNull()
    expect(placeFromReverse({ statusCode: 401, error: 'Unauthorized' })).toBeNull()
    expect(placeFromReverse(reply({ lat: 1, lon: 2 }))).toBeNull()
    expect(placeFromReverse(reply({ ...haarlem, lat: 'abc' }))).toBeNull()
    expect(placeFromReverse(reply({ ...haarlem, lon: 200 }))).toBeNull()
    expect(placeFromReverse(null)).toBeNull()
  })
  it('keeps the label within 200 characters', () => {
    const long = placeFromReverse(reply({ ...haarlem, city: 'C'.repeat(250), country: 'N' }))
    expect(long.label.length).toBeLessThanOrEqual(200)
  })
})

describe('placesFromSearch', () => {
  const klos = {
    name: 'Café de Klos', city: 'Amsterdam', country: 'Netherlands', lat: 52.3667, lon: 4.8822, result_type: 'amenity',
    formatted: 'Café de Klos, Kerkstraat 41, 1017 GB Amsterdam, Netherlands',
  }
  it('gives a short label (name, town, country) and the full address as detail', () => {
    expect(placesFromSearch(reply(klos))).toEqual([{
      label: 'Café de Klos, Amsterdam, Netherlands', detail: klos.formatted, lat: 52.3667, lon: 4.8822, precision: 'exact',
    }])
  })
  it("doesn't repeat the town when the place is the town", () => {
    const bkk = { name: 'Bangkok', city: 'Bangkok', country: 'Thailand', lat: 13.7525, lon: 100.4935, result_type: 'city', formatted: 'Bangkok, Thailand' }
    expect(placesFromSearch(reply(bkk))[0].label).toBe('Bangkok, Thailand')
  })
  it('uses the first address line when there is no name', () => {
    const street = { address_line1: 'Grote Markt 2', city: 'Haarlem', country: 'Netherlands', lat: 52.381, lon: 4.636, result_type: 'building' }
    expect(placesFromSearch(reply(street))[0].label).toBe('Grote Markt 2, Haarlem, Netherlands')
  })
  it('marks towns, regions and countries as city level and anything smaller as an exact spot', () => {
    const kind = (result_type) => placesFromSearch(reply({ ...klos, result_type }))[0].precision
    for (const t of ['city', 'suburb', 'district', 'postcode', 'county', 'state', 'country']) expect(kind(t)).toBe('city')
    for (const t of ['amenity', 'building', 'street', 'unknown', undefined]) expect(kind(t)).toBe('exact')
  })
  it('skips broken results and duplicates, and gives at most 5', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ ...klos, name: `Place ${i}` }))
    expect(placesFromSearch(reply({ lat: 'x' }, klos, klos, ...many))).toHaveLength(5)
    expect(placesFromSearch(reply({ lat: 'x' }, klos, klos))).toHaveLength(1)
  })
  it('gives an empty list for anything that is not a reply with results', () => {
    expect(placesFromSearch({ statusCode: 429 })).toEqual([])
    expect(placesFromSearch([klos])).toEqual([])
    expect(placesFromSearch(null)).toEqual([])
  })
})
