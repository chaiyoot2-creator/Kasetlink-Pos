import type { Product } from './types'

/** Where a cart line's price came from (stored on sale_lines.price_source). */
export type PriceSource = 'fixed' | 'level' | 'fallback' | 'manual'

export const PRICE_LEVELS = [1, 2, 3, 4, 5] as const

export function levelName(names: string[], level: number): string {
  return names[level - 1] || `ระดับ ${level}`
}

/**
 * Price rule: the customer's fixed price for this product, else the product's price at
 * the customer's level, else level 1 (flagged as `fallback` so the cashier sees it).
 */
export function resolvePrice(p: Product, level: number, fixed: ReadonlyMap<string, number>): { price: number; source: PriceSource } {
  const fixedPrice = fixed.get(p.id)
  if (fixedPrice !== undefined) return { price: fixedPrice, source: 'fixed' }
  const levelPrice = p.priceLevels[level - 1] ?? 0
  if (levelPrice > 0) return { price: levelPrice, source: 'level' }
  return { price: p.priceLevels[0] ?? 0, source: level === 1 ? 'level' : 'fallback' }
}
