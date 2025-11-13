import type { Abi } from 'viem'

import FLOOR_ABI from '../../abis/Floor_v1.json'
import { getPublicClient } from '../rpc-client'
import { normalizeAddress } from './misc'

type FloorPricingResult = {
  buyPrice?: bigint
  sellPrice?: bigint
  buyFeeBps?: bigint
  sellFeeBps?: bigint
  floorPrice?: bigint
}

const FLOOR_ABI_TYPED = FLOOR_ABI as Abi

type FloorPricingCacheEntry = {
  blockNumber: bigint | null
  data: FloorPricingResult
}

const pricingCache = new Map<string, FloorPricingCacheEntry>()

export async function fetchFloorPricing(
  chainId: number,
  floorAddress: `0x${string}`,
  blockNumber?: bigint
): Promise<FloorPricingResult> {
  const cacheKey = normalizeAddress(floorAddress)
  const cached = pricingCache.get(cacheKey)
  if (cached) {
    if (!blockNumber || cached.blockNumber === blockNumber) {
      return cached.data
    }
  }

  try {
    const publicClient = getPublicClient(chainId)
    const response = (await publicClient.multicall({
      contracts: [
        {
          address: floorAddress,
          abi: FLOOR_ABI_TYPED,
          functionName: 'getStaticPriceForBuying',
        },
        {
          address: floorAddress,
          abi: FLOOR_ABI_TYPED,
          functionName: 'getStaticPriceForSelling',
        },
        {
          address: floorAddress,
          abi: FLOOR_ABI_TYPED,
          functionName: 'getBuyFee',
        },
        {
          address: floorAddress,
          abi: FLOOR_ABI_TYPED,
          functionName: 'getSellFee',
        },
        {
          address: floorAddress,
          abi: FLOOR_ABI_TYPED,
          functionName: 'getFloorPrice',
        },
      ],
    })) as FloorMulticallResult[]

    const data = {
      buyPrice: extractValue(response[0]),
      sellPrice: extractValue(response[1]),
      buyFeeBps: extractValue(response[2]),
      sellFeeBps: extractValue(response[3]),
      floorPrice: extractValue(response[4]),
    }

    pricingCache.set(cacheKey, {
      blockNumber: blockNumber ?? null,
      data,
    })

    return data
  } catch (error) {
    return {}
  }
}

type FloorMulticallResult =
  | { status: 'success'; result: bigint }
  | { status: 'failure'; error: unknown }

function extractValue(result?: FloorMulticallResult): bigint | undefined {
  if (!result || result.status !== 'success') {
    return undefined
  }
  return result.result
}
