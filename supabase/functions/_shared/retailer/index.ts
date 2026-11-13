// Picks the retailer adapter for an Edge Function (docs/adr/0004).
//
//   APP_ENVIRONMENT=production  (set only on the production Supabase project)
//     → the real AH adapter, always.
//   RETAILER_AH_MODE=real       (preview only, for a short test window; unlink and unset
//                                straight after — guardrails in docs/adr/0004)
//     → the real AH adapter on preview, so the deployed code is tested against the real
//       AH before it goes to production.
//   anything else (preview, local, unset)
//     → the fake adapter.
// With the real adapter, RETAILER_AH_ENABLED=true lets it call AH; anything else is the
// kill switch: every call fails with 'disabled' and nothing is sent.
//
// Usage in a function:  retailerAdapterFor('ah', (name) => Deno.env.get(name))

import { createAhAdapter } from './ahAdapter.ts'
import type { AhAdapterOptions } from './ahAdapter.ts'
import { createFakeAdapter } from './fakeAdapter.ts'
import { RetailerError } from './types.ts'
import type { RetailerAdapter } from './types.ts'

export function retailerAdapterFor(
  retailer: string,
  getEnv: (name: string) => string | undefined,
  deps: Omit<AhAdapterOptions, 'enabled'> = {},
): RetailerAdapter {
  if (retailer !== 'ah') throw new RetailerError('unsupported', `No adapter for retailer "${retailer}"`)
  const real = getEnv('APP_ENVIRONMENT') === 'production' || getEnv('RETAILER_AH_MODE') === 'real'
  if (!real) return createFakeAdapter()
  return createAhAdapter({ ...deps, enabled: getEnv('RETAILER_AH_ENABLED') === 'true' })
}

export { RetailerError } from './types.ts'
