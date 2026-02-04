import { createEffect, S } from 'envio'
import type { handlerContext } from 'generated'
import type { Token_t } from 'generated/src/db/Entities.gen'
import type { Abi } from 'viem'
import { erc20Abi } from 'viem'

import ERC20IssuanceABIJson from '../../abis/ERC20Issuance_v1.json'
import FLOOR_ABI from '../../abis/Floor_v1.json'
import { getPublicClient } from '../rpc-client'
import { wrapEffect } from './effects'
import { formatAmount, normalizeAddress } from './misc'

// =============================================================================
// ABI Type Casts
// =============================================================================

const ERC20IssuanceABI = ERC20IssuanceABIJson as Abi
const FLOOR_ABI_TYPED = FLOOR_ABI as Abi

const CAP_FUNCTION_ABI = ERC20IssuanceABI.filter(
  (entry: Abi[number]) => entry.type === 'function' && entry.name === 'cap'
) as Abi

// =============================================================================
// Token Metadata Effect
// =============================================================================

export const fetchTokenMetadataEffect = wrapEffect(
  createEffect(
    {
      name: 'fetchTokenMetadata',
      input: { chainId: S.number, address: S.string },
      output: S.nullable(
        S.schema({
          name: S.string,
          symbol: S.string,
          decimals: S.number,
          maxSupplyRaw: S.string,
        })
      ),
      rateLimit: { calls: 50, per: 'second' },
      cache: true,
    },
    async ({ input, context }) => {
      try {
        const client = getPublicClient(input.chainId)
        const target = input.address as `0x${string}`

        let name = 'Unknown Token'
        let symbol = 'UNK'
        let decimals = 18
        let useIndividualCalls = false

        // Try multicall first, fallback to individual calls if it fails
        // (Multicall3 may not be deployed on fresh Anvil instances)
        try {
          const [nameCall, symbolCall, decimalsCall] = await client.multicall({
            allowFailure: true,
            contracts: [
              { address: target, abi: erc20Abi, functionName: 'name' },
              { address: target, abi: erc20Abi, functionName: 'symbol' },
              { address: target, abi: erc20Abi, functionName: 'decimals' },
            ],
          })

          // Check if all calls failed (likely Multicall3 not deployed)
          const allFailed =
            nameCall.status === 'failure' &&
            symbolCall.status === 'failure' &&
            decimalsCall.status === 'failure'

          if (allFailed) {
            useIndividualCalls = true
          } else {
            name =
              nameCall.status === 'success' && typeof nameCall.result === 'string'
                ? nameCall.result
                : 'Unknown Token'
            symbol =
              symbolCall.status === 'success' && typeof symbolCall.result === 'string'
                ? symbolCall.result
                : 'UNK'
            decimals =
              decimalsCall.status === 'success' && typeof decimalsCall.result === 'number'
                ? decimalsCall.result
                : 18
          }
        } catch {
          // Multicall threw (likely no Multicall3 deployed)
          useIndividualCalls = true
        }

        // Fallback to individual calls if multicall failed
        if (useIndividualCalls) {
          try {
            const nameResult = await client.readContract({
              address: target,
              abi: erc20Abi,
              functionName: 'name',
            })
            if (typeof nameResult === 'string') name = nameResult
          } catch {
            // Keep default
          }

          try {
            const symbolResult = await client.readContract({
              address: target,
              abi: erc20Abi,
              functionName: 'symbol',
            })
            if (typeof symbolResult === 'string') symbol = symbolResult
          } catch {
            // Keep default
          }

          try {
            const decimalsResult = await client.readContract({
              address: target,
              abi: erc20Abi,
              functionName: 'decimals',
            })
            if (typeof decimalsResult === 'number') decimals = decimalsResult
          } catch {
            // Keep default
          }
        }

        // Try to fetch cap (ERC20Issuance), fallback to totalSupply
        let maxSupplyRaw = 0n
        try {
          const capResult = await client.readContract({
            address: target,
            abi: CAP_FUNCTION_ABI,
            functionName: 'cap',
          })
          if (typeof capResult === 'bigint') {
            maxSupplyRaw = capResult
          }
        } catch {
          try {
            const totalSupplyResult = await client.readContract({
              address: target,
              abi: erc20Abi,
              functionName: 'totalSupply',
            })
            if (typeof totalSupplyResult === 'bigint') {
              maxSupplyRaw = totalSupplyResult
            }
          } catch {
            // Use 0 as fallback
          }
        }

        return {
          name,
          symbol,
          decimals,
          maxSupplyRaw: maxSupplyRaw.toString(),
        }
      } catch {
        context.cache = false
        return undefined
      }
    }
  )
)

// =============================================================================
// Token Addresses from BC Effect
// =============================================================================

export const fetchTokenAddressesFromBCEffect = wrapEffect(
  createEffect(
    {
      name: 'fetchTokenAddressesFromBC',
      input: { chainId: S.number, bcAddress: S.string },
      output: S.nullable(
        S.schema({
          issuanceToken: S.string,
          reserveToken: S.string,
        })
      ),
      rateLimit: { calls: 50, per: 'second' },
      cache: true,
    },
    async ({ input, context }) => {
      try {
        const client = getPublicClient(input.chainId)
        const target = input.bcAddress as `0x${string}`

        let issuanceToken: string | undefined
        let reserveToken: string | undefined
        let useIndividualCalls = false

        // Try multicall first, fallback to individual calls if it fails
        // (Multicall3 may not be deployed on fresh Anvil instances)
        try {
          const [issuanceTokenCall, reserveTokenCall] = await client.multicall({
            allowFailure: true,
            contracts: [
              { address: target, abi: FLOOR_ABI_TYPED, functionName: 'getIssuanceToken' },
              { address: target, abi: FLOOR_ABI_TYPED, functionName: 'getCollateralToken' },
            ],
          })

          // Check if all calls failed (likely Multicall3 not deployed)
          const allFailed =
            issuanceTokenCall.status === 'failure' && reserveTokenCall.status === 'failure'

          if (allFailed) {
            useIndividualCalls = true
          } else {
            if (
              issuanceTokenCall.status === 'success' &&
              typeof issuanceTokenCall.result === 'string'
            ) {
              issuanceToken = (issuanceTokenCall.result as string).toLowerCase()
            }
            if (
              reserveTokenCall.status === 'success' &&
              typeof reserveTokenCall.result === 'string'
            ) {
              reserveToken = (reserveTokenCall.result as string).toLowerCase()
            }
          }
        } catch {
          // Multicall threw (likely no Multicall3 deployed)
          useIndividualCalls = true
        }

        // Fallback to individual calls if multicall failed
        if (useIndividualCalls) {
          try {
            const issuanceResult = await client.readContract({
              address: target,
              abi: FLOOR_ABI_TYPED,
              functionName: 'getIssuanceToken',
            })
            if (typeof issuanceResult === 'string') {
              issuanceToken = issuanceResult.toLowerCase()
            }
          } catch {
            // Keep undefined
          }

          try {
            const reserveResult = await client.readContract({
              address: target,
              abi: FLOOR_ABI_TYPED,
              functionName: 'getCollateralToken',
            })
            if (typeof reserveResult === 'string') {
              reserveToken = reserveResult.toLowerCase()
            }
          } catch {
            // Keep undefined
          }
        }

        if (!issuanceToken || !reserveToken) {
          context.cache = false
          return undefined
        }

        return {
          issuanceToken,
          reserveToken,
        }
      } catch {
        context.cache = false
        return undefined
      }
    }
  )
)

// =============================================================================
// Token Helper Functions
// =============================================================================

/**
 * Get or create Token entity
 * Stores token info with decimals
 * Uses Effect API for RPC calls with caching
 */
export async function getOrCreateToken(
  context: handlerContext,
  chainId: number,
  address: string
): Promise<Token_t> {
  const normalizedAddress = normalizeAddress(address)
  let token = await context.Token.get(normalizedAddress)

  if (!token) {
    const metadata = await fetchTokenMetadataEffect(context.effect)({
      chainId,
      address: normalizedAddress,
    })

    const maxSupplyRaw = metadata?.maxSupplyRaw ? BigInt(metadata.maxSupplyRaw) : 0n
    const decimals = metadata?.decimals ?? 18

    token = {
      id: normalizedAddress,
      name: metadata?.name ?? 'Unknown Token',
      symbol: metadata?.symbol ?? 'UNK',
      decimals,
      maxSupplyRaw,
      maxSupplyFormatted: formatAmount(maxSupplyRaw, decimals).formatted,
    }
    context.Token.set(token)
  }

  return token
}
