/**
 * @description Effect API utilities for offchain fetchers
 * @see https://docs.envio.dev/docs/HyperIndex/effect-api
 */

import type { createEffect } from 'envio'

/**
 * Wraps an already-created effect to make it compatible with context.effect()
 * across different envio package installations and TypeScript experimental language service.
 *
 * Types are automatically inferred from the effect's input/output types.
 *
 * @example
 * export const fetchTokenMetadata = wrapEffect(
 *   createEffect({...}, async ({input}) => {...})
 * )
 *
 * // Usage in handlers:
 * const result = await fetchTokenMetadata(context.effect)({ chainId: 1, address: '0x...' })
 */
export function wrapEffect<I, O>(
  effect: ReturnType<typeof createEffect<unknown, unknown, I, O, O>>
): (effectCaller: unknown) => (input: I) => Promise<O> {
  return (effectCaller) => (input) =>
    (effectCaller as (e: unknown, i: unknown) => Promise<unknown>)(effect, input) as Promise<O>
}
