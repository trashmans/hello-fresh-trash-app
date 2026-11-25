// @vitest-environment node
// Importing a recipe from a web link (docs/adr/0009): checking the link, refusing private
// addresses, and reading the schema.org Recipe data most recipe sites publish. Pure: no I/O.
import { describe, it, expect } from 'vitest'
import {
  checkRecipeUrl, isPrivateAddress, parseIsoDuration, extractRecipeData, pageText, recipeSourceText, linkFilename,
  helloFreshStepImages, pagePhotos, PAGE_PHOTOS_MAX,
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
      stepImages: [null, null, null],
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

  it("gives each step's own image, lined up with the steps (null where a step has none)", () => {
    const data = extractRecipeData(page({
      ...recipe,
      recipeInstructions: [
        { '@type': 'HowToStep', text: 'Roast.', image: 'https://img.example.com/step-1.jpg' },
        { '@type': 'HowToStep', text: 'Warm.' },
        { '@type': 'HowToStep', text: 'Serve.', image: { '@type': 'ImageObject', url: 'https://img.example.com/step-3.jpg' } },
      ],
    }))
    expect(data.steps).toEqual(['Roast.', 'Warm.', 'Serve.'])
    expect(data.stepImages).toEqual(['https://img.example.com/step-1.jpg', null, 'https://img.example.com/step-3.jpg'])
  })

  it('keeps step images lined up through HowToSections and text split into lines', () => {
    const data = extractRecipeData(page({
      ...recipe,
      recipeInstructions: [
        { '@type': 'HowToSection', name: 'Sauce', itemListElement: [{ '@type': 'HowToStep', text: 'Stir.', image: 'https://img.example.com/s.jpg' }] },
        'Boil.\nDrain.',
        { '@type': 'HowToStep', text: 'Plate.', image: 'https://img.example.com/p.jpg' },
      ],
    }))
    expect(data.steps).toEqual(['Stir.', 'Boil.', 'Drain.', 'Plate.'])
    expect(data.stepImages).toEqual(['https://img.example.com/s.jpg', null, null, 'https://img.example.com/p.jpg'])
  })

  it('ignores a step image that is not an https link', () => {
    const data = extractRecipeData(page({ ...recipe, recipeInstructions: [{ '@type': 'HowToStep', text: 'Roast.', image: 'javascript:alert(1)' }] }))
    expect(data.stepImages).toEqual([null])
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

describe('helloFreshStepImages', () => {
  // HelloFresh.com pages keep the step photos in the Next.js page data, not in the Recipe data.
  const nextPage = (recipeData) =>
    `<html><head><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { ssrPayload: { recipe: recipeData } } } })}</script></head><body></body></html>`
  const hfStep = (index, path) => ({ index, instructions: `Step ${index}`, images: path ? [{ caption: '', path }] : [] })
  const HF = 'https://www.hellofresh.com/recipes/creamy-dijon-dill-chicken-646465ad06d34c35d66b85eb'
  const media = (path) => `https://media.hellofresh.com/w_750,q_auto,f_auto,c_limit,fl_lossy/hellofresh_s3${path}`

  it('gives one photo per step, in step order', () => {
    const html = nextPage({ steps: [hfStep(2, '/abc/step-2.jpg'), hfStep(1, '/abc/step-1.jpg'), hfStep(3, '/abc/step-3.jpg')] })
    expect(helloFreshStepImages(html, HF)).toEqual([media('/abc/step-1.jpg'), media('/abc/step-2.jpg'), media('/abc/step-3.jpg')])
  })

  it('gives null for a step without a photo or with an odd path', () => {
    const html = nextPage({ steps: [hfStep(1, '/abc/step-1.jpg'), hfStep(2, null), hfStep(3, '/../x"onerror.jpg'), hfStep(4, '/abc/notes.pdf')] })
    expect(helloFreshStepImages(html, HF)).toEqual([media('/abc/step-1.jpg'), null, null, null])
  })

  it('works on the other HelloFresh countries', () => {
    const html = nextPage({ steps: [hfStep(1, '/abc/step-1.jpg')] })
    expect(helloFreshStepImages(html, 'https://www.hellofresh.nl/recipes/x-123')).toEqual([media('/abc/step-1.jpg')])
  })

  it('gives null for other sites, pages without the data, or broken data', () => {
    const html = nextPage({ steps: [hfStep(1, '/abc/step-1.jpg')] })
    expect(helloFreshStepImages(html, 'https://www.example.com/recipes/x')).toBeNull()
    expect(helloFreshStepImages(html, 'https://hellofresh.com.evil.example/recipes/x')).toBeNull()
    expect(helloFreshStepImages('<html><body>no data</body></html>', HF)).toBeNull()
    expect(helloFreshStepImages('<script id="__NEXT_DATA__" type="application/json">{ not json</script>', HF)).toBeNull()
    expect(helloFreshStepImages(nextPage({ steps: [hfStep(1, null)] }), HF)).toBeNull() // no photos at all
  })
})

describe('pagePhotos', () => {
  const URL_ = 'https://blog.example.com/coconut-curry/'
  const img = (src, attrs = '') => `<img src="${src}" ${attrs}>`
  const post = (...imgs) => `<html><body><header>${img('https://blog.example.com/logo.png', 'alt="Blog logo"')}</header><article>${imgs.join('<p>text</p>')}</article><aside>${img('https://blog.example.com/wp-content/uploads/related-150x150.jpg')}</aside></body></html>`

  it('takes the photos in the post, in page order', () => {
    const html = post(img('https://blog.example.com/wp-content/uploads/onions.jpg', 'alt="Onions in the pot"'), img('/wp-content/uploads/curry.webp'))
    expect(pagePhotos(html, URL_)).toEqual([
      'https://blog.example.com/wp-content/uploads/onions.jpg',
      'https://blog.example.com/wp-content/uploads/curry.webp',
    ])
  })

  it('uses the lazy-loading address when src is a placeholder', () => {
    const html = post(`<img src="data:image/svg+xml,%3Csvg%3E" data-lazy-src="https://blog.example.com/wp-content/uploads/a.jpg">`, `<img src="data:image/gif;base64,R0l" data-src="https://blog.example.com/wp-content/uploads/b.jpg">`)
    expect(pagePhotos(html, URL_)).toEqual(['https://blog.example.com/wp-content/uploads/a.jpg', 'https://blog.example.com/wp-content/uploads/b.jpg'])
  })

  it('leaves out the cover, other sizes of the same photo, and repeats', () => {
    const html = post(
      img('https://blog.example.com/wp-content/uploads/cover.jpg'),
      img('https://blog.example.com/wp-content/uploads/onions.jpg'),
      img('https://blog.example.com/wp-content/uploads/onions-1024x683.jpg'),
      img('https://blog.example.com/wp-content/uploads/onions.jpg'),
    )
    expect(pagePhotos(html, URL_, ['https://blog.example.com/wp-content/uploads/cover-1200x630.jpg'])).toEqual(['https://blog.example.com/wp-content/uploads/onions.jpg'])
  })

  it('leaves out logos, author photos, icons, small thumbnails and small images', () => {
    const html = post(
      img('https://blog.example.com/wp-content/uploads/site-logo.png'),
      img('https://blog.example.com/wp-content/uploads/meeta.jpg', 'alt="Meeta, author of the blog" class="author-avatar"'),
      img('https://blog.example.com/wp-content/uploads/pin-icon.png'),
      img('https://blog.example.com/wp-content/uploads/thumb-360x360.jpg'),
      img('https://blog.example.com/wp-content/uploads/tiny.jpg', 'width="120" height="80"'),
      img('https://blog.example.com/wp-content/uploads/keep.jpg', 'width="1080" height="549"'),
    )
    expect(pagePhotos(html, URL_)).toEqual(['https://blog.example.com/wp-content/uploads/keep.jpg'])
  })

  it('only takes https photos (jpg, png, webp)', () => {
    const html = post(
      img('http://blog.example.com/wp-content/uploads/plain.jpg'),
      img('https://blog.example.com/wp-content/uploads/anim.gif'),
      img('https://blog.example.com/wp-content/uploads/drawing.svg'),
      img('https://cdn.example.net/photos/ok.JPEG?w=800'),
    )
    expect(pagePhotos(html, URL_)).toEqual(['https://cdn.example.net/photos/ok.JPEG?w=800'])
  })

  it('looks at the whole page when there is no <article>', () => {
    const html = `<html><body><div class="post">${img('https://blog.example.com/wp-content/uploads/a.jpg')}</div></body></html>`
    expect(pagePhotos(html, URL_)).toEqual(['https://blog.example.com/wp-content/uploads/a.jpg'])
  })

  it(`keeps at most ${PAGE_PHOTOS_MAX}`, () => {
    const html = post(...Array.from({ length: 10 }, (_, i) => img(`https://blog.example.com/wp-content/uploads/p${i}.jpg`)))
    expect(PAGE_PHOTOS_MAX).toBe(6)
    expect(pagePhotos(html, URL_)).toHaveLength(6)
    expect(pagePhotos(html, URL_)[0]).toBe('https://blog.example.com/wp-content/uploads/p0.jpg')
  })

  it('gives [] for a page without photos', () => {
    expect(pagePhotos('<html><body><p>Just text</p></body></html>', URL_)).toEqual([])
    expect(pagePhotos('', URL_)).toEqual([])
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
