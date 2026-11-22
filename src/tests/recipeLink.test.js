// @vitest-environment node
// Importing a recipe from a web link (docs/adr/0009): checking the link, refusing private
// addresses, and reading the schema.org Recipe data most recipe sites publish. Pure: no I/O.
import { describe, it, expect } from 'vitest'
import {
  checkRecipeUrl, isPrivateAddress, parseIsoDuration, extractRecipeData, pageText, recipeSourceText, linkFilename,
} from '../../supabase/functions/_shared/recipeLink.ts'

describe('checkRecipeUrl', () => {
  it('accepts an https link and tidies it', () => {
    expect(checkRecipeUrl('  https://WWW.Example.com/recipes/tacos  ')).toEqual({ ok: true, url: 'https://www.example.com/recipes/tacos' })
  })

  it('adds https when the scheme is missing, and upgrades http', () => {
    expect(checkRecipeUrl('www.example.com/tacos')).toEqual({ ok: true, url: 'https://www.example.com/tacos' })
    expect(checkRecipeUrl('http://example.com/tacos').url).toBe('https://example.com/tacos')
  })

  it('drops tracking parameters and the #fragment, keeps the rest of the query', () => {
    expect(checkRecipeUrl('https://example.com/r?id=7&utm_source=x&utm_medium=y&fbclid=z&gclid=q#comments').url)
      .toBe('https://example.com/r?id=7')
  })

  it('refuses things that are not public web pages', () => {
    for (const bad of [
      '', 'not a link', 'ftp://example.com/x', 'javascript:alert(1)', 'file:///etc/passwd',
      'https://localhost/x', 'https://127.0.0.1/x', 'https://10.0.0.5/x', 'https://[::1]/x',
      'https://printer.local/x', 'https://db.internal/x', 'https://user:pw@example.com/x',
      'https://example.com:8443/x', 'https://intranet/x', null, 42,
    ]) {
      expect([bad, checkRecipeUrl(bad).ok]).toEqual([bad, false])
    }
  })

  it('refuses a link over 2048 characters', () => {
    expect(checkRecipeUrl(`https://example.com/${'a'.repeat(2050)}`).ok).toBe(false)
  })

  it('says what to fix', () => {
    expect(checkRecipeUrl('nope').message).toMatch(/link/i)
  })
})

describe('isPrivateAddress', () => {
  it('flags private, local and special IPv4 ranges', () => {
    for (const ip of ['10.1.2.3', '127.0.0.1', '169.254.169.254', '172.16.0.1', '172.31.255.255', '192.168.1.1', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255']) {
      expect([ip, isPrivateAddress(ip)]).toEqual([ip, true])
    }
  })

  it('flags private and local IPv6, including mapped IPv4', () => {
    for (const ip of ['::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', '::ffff:10.0.0.1', '::ffff:127.0.0.1']) {
      expect([ip, isPrivateAddress(ip)]).toEqual([ip, true])
    }
  })

  it('lets public addresses through', () => {
    for (const ip of ['93.184.216.34', '172.32.0.1', '8.8.8.8', '2606:4700::6810:84e5', '::ffff:8.8.8.8']) {
      expect([ip, isPrivateAddress(ip)]).toEqual([ip, false])
    }
  })

  it('treats anything unreadable as private (refused)', () => {
    expect(isPrivateAddress('not-an-ip')).toBe(true)
  })
})

describe('parseIsoDuration', () => {
  it('turns ISO 8601 durations into minutes', () => {
    expect(parseIsoDuration('PT45M')).toBe(45)
    expect(parseIsoDuration('PT1H20M')).toBe(80)
    expect(parseIsoDuration('P0DT0H30M')).toBe(30)
    expect(parseIsoDuration('PT90S')).toBe(2)
  })

  it('gives null for anything else', () => {
    expect(parseIsoDuration('')).toBeNull()
    expect(parseIsoDuration('20 minutes')).toBeNull()
    expect(parseIsoDuration(null)).toBeNull()
    expect(parseIsoDuration('PT0M')).toBeNull()
  })
})

const page = (...blocks) => `<html><head>
<meta property="og:image" content="https://img.example.com/og.jpg">
${blocks.map(b => `<script type="application/ld+json">${typeof b === 'string' ? b : JSON.stringify(b)}</script>`).join('\n')}
</head><body><h1>Tacos</h1></body></html>`

const recipe = {
  '@context': 'https://schema.org',
  '@type': 'Recipe',
  name: 'Sweet Potato Tacos',
  image: ['https://img.example.com/tacos-1x1.jpg', 'https://img.example.com/tacos-16x9.jpg'],
  recipeYield: ['4', '4 servings'],
  prepTime: 'PT10M',
  cookTime: 'PT25M',
  totalTime: 'PT35M',
  recipeIngredient: ['2 sweet potatoes, diced', '1 can black beans', '  8 small tortillas '],
  recipeInstructions: [
    { '@type': 'HowToStep', text: 'Roast the sweet potatoes.' },
    { '@type': 'HowToSection', name: 'To serve', itemListElement: [{ '@type': 'HowToStep', text: 'Warm the tortillas.' }, { '@type': 'HowToStep', text: 'Fill and serve.' }] },
  ],
  nutrition: { '@type': 'NutritionInformation', calories: '640 kcal' },
}

describe('extractRecipeData', () => {
  it('reads a Recipe from the page', () => {
    expect(extractRecipeData(page(recipe))).toEqual({
      name: 'Sweet Potato Tacos',
      ingredients: ['2 sweet potatoes, diced', '1 can black beans', '8 small tortillas'],
      steps: ['Roast the sweet potatoes.', 'Warm the tortillas.', 'Fill and serve.'],
      image: 'https://img.example.com/tacos-1x1.jpg',
      servings: '4',
      prepMinutes: 10,
      cookMinutes: 25,
      totalMinutes: 35,
      calories: '640 kcal',
    })
  })

  it('finds the Recipe inside an @graph, in a list, or with several types', () => {
    expect(extractRecipeData(page({ '@context': 'https://schema.org', '@graph': [{ '@type': 'WebPage' }, recipe] })).name).toBe('Sweet Potato Tacos')
    expect(extractRecipeData(page([{ '@type': 'Organization' }, recipe])).name).toBe('Sweet Potato Tacos')
    expect(extractRecipeData(page({ ...recipe, '@type': ['Recipe', 'NewsArticle'] })).name).toBe('Sweet Potato Tacos')
  })

  it('accepts steps as plain text, a list of strings, or HowToStep with only a name', () => {
    expect(extractRecipeData(page({ ...recipe, recipeInstructions: 'Roast.\nServe.' })).steps).toEqual(['Roast.', 'Serve.'])
    expect(extractRecipeData(page({ ...recipe, recipeInstructions: ['Roast.', ' Serve. '] })).steps).toEqual(['Roast.', 'Serve.'])
    expect(extractRecipeData(page({ ...recipe, recipeInstructions: [{ '@type': 'HowToStep', name: 'Roast.' }] })).steps).toEqual(['Roast.'])
  })

  it('reads the image as a string, an ImageObject, or falls back to og:image', () => {
    expect(extractRecipeData(page({ ...recipe, image: 'https://img.example.com/a.jpg' })).image).toBe('https://img.example.com/a.jpg')
    expect(extractRecipeData(page({ ...recipe, image: { '@type': 'ImageObject', url: 'https://img.example.com/b.jpg' } })).image).toBe('https://img.example.com/b.jpg')
    const { image, ...noImage } = recipe
    expect(image).toBeTruthy()
    expect(extractRecipeData(page(noImage)).image).toBe('https://img.example.com/og.jpg')
  })

  it('strips HTML and entities from text', () => {
    const data = extractRecipeData(page({ ...recipe, name: 'Tacos &amp; <b>Beans</b>', recipeIngredient: ['1&nbsp;cup <a href="/x">rice</a>'] }))
    expect(data.name).toBe('Tacos & Beans')
    expect(data.ingredients).toEqual(['1 cup rice'])
  })

  it('skips broken JSON blocks and keeps looking', () => {
    expect(extractRecipeData(page('{ not json', recipe)).name).toBe('Sweet Potato Tacos')
  })

  it('gives null when the page has no usable Recipe (no ingredients)', () => {
    expect(extractRecipeData(page({ '@type': 'Article', name: 'News' }))).toBeNull()
    expect(extractRecipeData(page({ ...recipe, recipeIngredient: [] }))).toBeNull()
    expect(extractRecipeData('<html><body>No data</body></html>')).toBeNull()
  })
})

describe('pageText', () => {
  it('keeps the readable text, without scripts, styles or tags', () => {
    const html = '<html><head><style>.a{}</style><script>var x=1</script></head><body><h1>Tacos</h1><p>2 sweet&nbsp;potatoes</p><nav>Menu</nav></body></html>'
    expect(pageText(html)).toBe('Tacos 2 sweet potatoes Menu')
  })

  it('stops at 30,000 characters', () => {
    expect(pageText(`<p>${'a '.repeat(40000)}</p>`).length).toBeLessThanOrEqual(30000)
  })
})

describe('recipeSourceText', () => {
  // What Gemini reads for a link recipe, in place of the PDF.
  it('lays the Recipe data out as a recipe card', () => {
    const data = extractRecipeData(page(recipe))
    expect(recipeSourceText(data, 'https://www.example.com/tacos')).toBe([
      'Recipe from https://www.example.com/tacos',
      'Title: Sweet Potato Tacos',
      'Servings: 4',
      'Prep time: 10 minutes',
      'Cook time: 25 minutes',
      'Total time: 35 minutes',
      'Calories: 640 kcal',
      '',
      'Ingredients:',
      '- 2 sweet potatoes, diced',
      '- 1 can black beans',
      '- 8 small tortillas',
      '',
      'Steps:',
      '1. Roast the sweet potatoes.',
      '2. Warm the tortillas.',
      '3. Fill and serve.',
    ].join('\n'))
  })

  it('leaves out what the page does not give', () => {
    const text = recipeSourceText({ name: null, ingredients: ['1 egg'], steps: [], image: null, servings: null, prepMinutes: null, cookMinutes: null, totalMinutes: null, calories: null }, 'https://x.nl/r')
    expect(text).toBe('Recipe from https://x.nl/r\n\nIngredients:\n- 1 egg')
  })
})

describe('linkFilename', () => {
  // recipes.filename for a link recipe: shown while it is being read.
  it('is the site and the last part of the path', () => {
    expect(linkFilename('https://www.example.com/recipes/sweet-potato-tacos')).toBe('example.com/sweet-potato-tacos')
    expect(linkFilename('https://cooking.example.com/')).toBe('cooking.example.com')
  })

  it('stays under 120 characters', () => {
    expect(linkFilename(`https://example.com/${'a'.repeat(300)}`).length).toBeLessThanOrEqual(120)
  })
})
