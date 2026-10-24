// Compares the planner's target list with the household's current retailer
// list and returns the changes needed. Retailer-neutral: the AH adapter turns
// each change into its PATCH format (docs/adr/0004-retailer-adapter.md).
//
// Rules:
//   - Only adds or raises, never removes. Items the household added by hand,
//     and anything not in the target, are left alone.
//   - Not on the list               → 'add'      (from 0 to target)
//   - On the list, unticked, enough → no change  (a hand-added "2 milk" is not bumped to 3)
//   - On the list, unticked, fewer  → 'increase' (to target)
//   - On the list, ticked           → 'untick'   (ticked items do not count; set to target)
//   - Products match by product id; free-text lines match by normalised text,
//     which is how AH identifies them (free-text lines have no item id).
//   - Applying the changes and diffing again gives no changes, so re-runs are safe.

const normaliseText = (text) => (text ?? '').trim().replace(/\s+/g, ' ').toLowerCase()

function lineKey({ productId, text }) {
  return productId != null && productId !== '' ? `p:${String(productId)}` : `t:${normaliseText(text)}`
}

function toProductId(productId) {
  if (productId == null || productId === '') return null
  const n = Number(productId)
  return Number.isNaN(n) ? productId : n
}

/**
 * Combines target lines for the same product or free text into one line.
 * Input:  [{ productId? , text?, packs, source }]
 * Output: [{ productId | null, text | null, packs, sources: [...] }] in first-seen order,
 *         without lines whose packs are 0 or less.
 */
export function mergeTargetLines(lines) {
  const merged = new Map()

  for (const line of lines) {
    if (!(line.packs > 0)) continue
    const productId = toProductId(line.productId)
    const text = productId == null ? (line.text ?? '').trim().replace(/\s+/g, ' ') : null
    const key = lineKey({ productId, text })

    const existing = merged.get(key)
    if (existing) {
      existing.packs += line.packs
      existing.sources.push(line.source)
    } else {
      merged.set(key, { productId, text, packs: line.packs, sources: [line.source] })
    }
  }

  return [...merged.values()]
}

/**
 * Changes needed to bring the current list up to the target.
 * target:  merged lines [{ productId | null, text | null, packs }]
 * current: list items   [{ productId | null, text, quantity, ticked }]
 * Returns: [{ action: 'add' | 'increase' | 'untick', productId, text, from, to }] in target order.
 */
export function diffList(target, current) {
  const onList = new Map()
  for (const item of current) {
    onList.set(lineKey({ productId: toProductId(item.productId), text: item.text }), item)
  }

  const changes = []
  for (const line of target) {
    const productId = toProductId(line.productId)
    const existing = onList.get(lineKey({ productId, text: line.text }))
    const base = { productId, text: productId == null ? line.text : null }

    if (!existing) {
      changes.push({ action: 'add', ...base, from: 0, to: line.packs })
    } else if (existing.ticked) {
      changes.push({ action: 'untick', ...base, from: 0, to: line.packs })
    } else if ((existing.quantity ?? 0) < line.packs) {
      changes.push({ action: 'increase', ...base, from: existing.quantity ?? 0, to: line.packs })
    }
  }

  return changes
}
