import { MarketStatus_t } from 'generated/src/db/Enums.gen'
import { HandlerContext } from 'generated'
import { Market_t, MarketState_t } from 'generated/src/db/Entities.gen'
import BC_ABI from '../../abis/BC_Discrete_Redeeming_VirtualSupply_v1.json'
import { getOrCreateAccount } from './user'
import { fetchTokenAddressesFromBC, getOrCreateToken } from './token'

/**
 * Get or create Market and MarketState entities
 * Creates them defensively if they don't exist (handles race conditions)
 *
 * @param marketId The ID for the market (usually orchestrator or BC module address)
 * @param bcAddress Optional BC module address to fetch token addresses from
 * @param chainId Chain ID for RPC calls
 */
export async function getOrCreateMarket(
  context: HandlerContext,
  chainId: number,
  marketId: string,
  timestamp: bigint,
  reserveTokenId?: string,
  issuanceTokenId?: string,
  bcAddress?: `0x${string}`
): Promise<{ market: Market_t; marketState: MarketState_t } | null> {
  const normalizedMarketId = marketId.toLowerCase()

  let market = await context.Market.get(normalizedMarketId)
  let marketState = await context.MarketState.get(normalizedMarketId)

  // If both exist, return them
  if (market && marketState) return { market, marketState }

  // If Market doesn't exist, create it
  if (!market) {
    const creator = await getOrCreateAccount(context, normalizedMarketId)

    // Try to fetch token addresses from BC contract if BC address provided
    let finalReserveTokenId = reserveTokenId
    let finalIssuanceTokenId = issuanceTokenId

    if ((!finalReserveTokenId || !finalIssuanceTokenId) && bcAddress) {
      const tokenAddresses = await fetchTokenAddressesFromBC(chainId, bcAddress)
      if (tokenAddresses) {
        if (!finalReserveTokenId) finalReserveTokenId = tokenAddresses.reserveToken
        if (!finalIssuanceTokenId) finalIssuanceTokenId = tokenAddresses.issuanceToken
      }
    }

    // Get or create tokens
    let reserveToken
    let issuanceToken

    if (finalReserveTokenId) {
      reserveToken = await getOrCreateToken(context, chainId, finalReserveTokenId)
    } else {
      // Create placeholder token if no reserve token address
      reserveToken = {
        id: 'unknown-reserve',
        name: 'Unknown Reserve Token',
        symbol: 'UNKNOWN',
        decimals: 18,
      }
    }

    if (finalIssuanceTokenId) {
      issuanceToken = await getOrCreateToken(context, chainId, finalIssuanceTokenId)
    } else {
      // Create placeholder token if no issuance token address
      issuanceToken = {
        id: 'unknown-issuance',
        name: 'Unknown Issuance Token',
        symbol: 'UNKNOWN',
        decimals: 18,
      }
    }

    market = {
      id: normalizedMarketId,
      name: 'Market',
      symbol: 'MKT',
      description: '',
      creator_id: creator.id,
      factory_id: '',
      reserveToken_id: reserveToken.id,
      issuanceToken_id: issuanceToken.id,
      initialPriceRaw: 0n,
      initialPriceFormatted: '0',
      tradingFeeBps: 0n,
      maxLTV: 0n,
      maxSupplyRaw: 0n,
      maxSupplyFormatted: '0',
      createdAt: timestamp,
    }
    context.Market.set(market)
  }

  // If MarketState doesn't exist, create it
  if (!marketState) {
    marketState = {
      id: normalizedMarketId,
      market_id: normalizedMarketId,
      currentPriceRaw: 0n,
      currentPriceFormatted: '0',
      floorPriceRaw: 0n,
      floorPriceFormatted: '0',
      totalSupplyRaw: 0n,
      totalSupplyFormatted: '0',
      marketSupplyRaw: 0n,
      marketSupplyFormatted: '0',
      floorSupplyRaw: 0n,
      floorSupplyFormatted: '0',
      status: 'ACTIVE' as MarketStatus_t,
      isBuyOpen: true,
      isSellOpen: true,
      lastTradeTimestamp: 0n,
      lastElevationTimestamp: 0n,
      lastUpdatedAt: timestamp,
    }
    context.MarketState.set(marketState)
  }

  return { market, marketState }
}
