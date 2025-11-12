// Shared utility functions for event handlers

import type { HandlerContext } from '../generated/src/Types'
import type {
  Account_t,
  Token_t,
  UserMarketPosition_t,
  UserPortfolioSummary_t,
  MarketSnapshot_t,
  PriceCandle_t,
  Market_t,
  MarketState_t,
} from '../generated/src/db/Entities.gen'
import type { MarketStatus_t } from '../generated/src/db/Enums.gen'
import { getPublicClient } from './rpc-client'
import BC_ABI from '../abis/BC_Discrete_Redeeming_VirtualSupply_v1.json'

/**
 * Format a raw BigInt amount with decimals into Amount type
 * Example: formatAmount(9900000n, 18) -> { raw: 9900000n, formatted: "9.9" }
 */
export function formatAmount(raw: bigint, decimals: number): { raw: bigint; formatted: string } {
  const divisor = BigInt(10 ** decimals)
  const whole = raw / divisor
  const fractional = raw % divisor
  const fractionalStr = fractional.toString().padStart(decimals, '0')

  // Remove trailing zeros from fractional part
  const trimmedFractional = fractionalStr.replace(/0+$/, '')
  const formatted = trimmedFractional ? `${whole}.${trimmedFractional}` : whole.toString()

  return { raw, formatted }
}

/**
 * Extract module type from metadata title
 * Maps module titles to ModuleRegistry field names
 */
export function extractModuleType(title: string): string {
  const lower = title.toLowerCase()

  if (lower.includes('creditfacility')) return 'creditFacility'
  if (lower.includes('treasury') || lower.includes('splitter')) return 'feeTreasury'
  if (lower.includes('presale')) return 'presale'
  if (lower.includes('staking')) return 'staking'

  const prefix = title.split('_')[0]
  const prefixMap: Record<string, string> = {
    BC: 'fundingManager',
    AUT: 'authorizer',
  }

  return prefixMap[prefix] || 'unknown'
}

/**
 * Get or create Account entity
 */
export async function getOrCreateAccount(
  context: HandlerContext,
  address: string
): Promise<Account_t> {
  const normalizedAddress = address.toLowerCase()
  let account = await context.Account.get(normalizedAddress)

  if (!account) {
    account = { id: normalizedAddress }
    context.Account.set(account)
  }

  return account
}

/**
 * Get or create Token entity
 * Stores token info with decimals
 */
export async function getOrCreateToken(
  context: HandlerContext,
  address: string,
  name?: string,
  symbol?: string,
  decimals?: number
): Promise<Token_t> {
  const normalizedAddress = address.toLowerCase()
  let token = await context.Token.get(normalizedAddress)

  if (!token) {
    token = {
      id: normalizedAddress,
      name: name || 'Unknown Token',
      symbol: symbol || 'UNK',
      decimals: decimals || 18,
    }
    context.Token.set(token)
  }

  return token
}

/**
 * Fetch token addresses from BC (bonding curve) contract via RPC
 * Calls getIssuanceToken() and getCollateralToken() view functions
 */
export async function fetchTokenAddressesFromBC(
  chainId: number,
  bcAddress: `0x${string}`
): Promise<{ issuanceToken: `0x${string}`; reserveToken: `0x${string}` } | null> {
  try {
    const publicClient = getPublicClient(chainId)

    // Call getIssuanceToken() view function
    const issuanceToken = await publicClient.readContract({
      address: bcAddress,
      abi: BC_ABI,
      functionName: 'getIssuanceToken',
    })

    // Call getCollateralToken() view function (reserve token)
    const reserveToken = await publicClient.readContract({
      address: bcAddress,
      abi: BC_ABI,
      functionName: 'getCollateralToken',
    })

    if (
      issuanceToken &&
      reserveToken &&
      typeof issuanceToken === 'string' &&
      typeof reserveToken === 'string'
    ) {
      return {
        issuanceToken: issuanceToken.toLowerCase() as `0x${string}`,
        reserveToken: reserveToken.toLowerCase() as `0x${string}`,
      }
    }
  } catch (error) {
    // RPC call failed - return null
    // Tokens can be created later with placeholder values
  }

  return null
}

/**
 * Fetch token decimals via ERC20 contract ABI
 */
export async function fetchTokenDecimals(
  chainId: number,
  tokenAddress: `0x${string}`
): Promise<number | null> {
  try {
    const publicClient = getPublicClient(chainId)

    const decimals = await publicClient.readContract({
      address: tokenAddress,
      abi: [
        {
          name: 'decimals',
          outputs: [{ type: 'uint8' }],
          stateMutability: 'view',
          type: 'function',
        },
      ],
      functionName: 'decimals',
    })

    if (typeof decimals === 'number') {
      return decimals
    }

    if (typeof decimals === 'bigint') {
      return Number(decimals)
    }
  } catch (error) {
    // RPC call failed
  }

  return null
}

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
  marketId: string,
  timestamp: bigint,
  reserveTokenId?: string,
  issuanceTokenId?: string,
  bcAddress?: `0x${string}`,
  chainId?: number
): Promise<{ market: Market_t; marketState: MarketState_t } | null> {
  const normalizedMarketId = marketId.toLowerCase()

  let market = await context.Market.get(normalizedMarketId)
  let marketState = await context.MarketState.get(normalizedMarketId)

  // If both exist, return them
  if (market && marketState) {
    return { market, marketState }
  }

  // If Market doesn't exist, create it
  if (!market) {
    const creator = await getOrCreateAccount(context, normalizedMarketId)

    // Try to fetch token addresses from BC contract if BC address provided
    let finalReserveTokenId = reserveTokenId
    let finalIssuanceTokenId = issuanceTokenId

    if ((!finalReserveTokenId || !finalIssuanceTokenId) && bcAddress && chainId !== undefined) {
      const tokenAddresses = await fetchTokenAddressesFromBC(chainId, bcAddress)
      if (tokenAddresses) {
        if (!finalReserveTokenId) finalReserveTokenId = tokenAddresses.reserveToken
        if (!finalIssuanceTokenId) finalIssuanceTokenId = tokenAddresses.issuanceToken
      }
    }

    // Get or create tokens with proper decimals
    let reserveToken
    let issuanceToken

    if (finalReserveTokenId && chainId !== undefined) {
      const decimals = await fetchTokenDecimals(chainId, finalReserveTokenId as `0x${string}`)
      reserveToken = await getOrCreateToken(
        context,
        finalReserveTokenId,
        undefined,
        undefined,
        decimals ?? 18
      )
    } else {
      reserveToken = await getOrCreateToken(context, '')
    }

    if (finalIssuanceTokenId && chainId !== undefined) {
      const decimals = await fetchTokenDecimals(chainId, finalIssuanceTokenId as `0x${string}`)
      issuanceToken = await getOrCreateToken(
        context,
        finalIssuanceTokenId,
        undefined,
        undefined,
        decimals ?? 18
      )
    } else {
      issuanceToken = await getOrCreateToken(context, '')
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

/**
 * Update UserPortfolioSummary aggregation
 * Recalculates all portfolio metrics for a user
 */
export async function updateUserPortfolioSummary(
  context: HandlerContext,
  userId: string
): Promise<void> {
  // Calculate totals - placeholder implementation
  // In production, would query user's positions and calculate aggregates
  const summaryId = userId
  const amount = formatAmount(0n, 18)
  const debt = formatAmount(0n, 18)
  const collateral = formatAmount(0n, 18)
  const staked = formatAmount(0n, 18)

  const summary: UserPortfolioSummary_t = {
    id: summaryId,
    user_id: userId,
    totalPortfolioValueRaw: amount.raw,
    totalPortfolioValueFormatted: amount.formatted,
    totalDebtRaw: debt.raw,
    totalDebtFormatted: debt.formatted,
    totalCollateralValueRaw: collateral.raw,
    totalCollateralValueFormatted: collateral.formatted,
    totalStakedValueRaw: staked.raw,
    totalStakedValueFormatted: staked.formatted,
    activeMarkets: 0n,
    activeLoans: 0n,
    activeStakes: 0n,
    lastUpdatedAt: BigInt(Math.floor(Date.now() / 1000)),
  }

  context.UserPortfolioSummary.set(summary)
}

/**
 * Get or create UserMarketPosition
 */
export async function getOrCreateUserMarketPosition(
  context: HandlerContext,
  userId: string,
  marketId: string,
  tokenDecimals: number = 18
): Promise<UserMarketPosition_t> {
  const positionId = `${userId.toLowerCase()}-${marketId.toLowerCase()}`
  let position = await context.UserMarketPosition.get(positionId)

  if (!position) {
    const zeroAmount = formatAmount(0n, tokenDecimals)
    position = {
      id: positionId,
      user_id: userId.toLowerCase(),
      market_id: marketId.toLowerCase(),
      fTokenBalanceRaw: zeroAmount.raw,
      fTokenBalanceFormatted: zeroAmount.formatted,
      reserveBalanceRaw: zeroAmount.raw,
      reserveBalanceFormatted: zeroAmount.formatted,
      totalDebtRaw: zeroAmount.raw,
      totalDebtFormatted: zeroAmount.formatted,
      lockedCollateralRaw: zeroAmount.raw,
      lockedCollateralFormatted: zeroAmount.formatted,
      stakedAmountRaw: zeroAmount.raw,
      stakedAmountFormatted: zeroAmount.formatted,
      claimableRewardsRaw: zeroAmount.raw,
      claimableRewardsFormatted: zeroAmount.formatted,
      presaleDepositRaw: zeroAmount.raw,
      presaleDepositFormatted: zeroAmount.formatted,
      presaleLeverage: 0n,
      lastUpdatedAt: BigInt(Math.floor(Date.now() / 1000)),
    }
    context.UserMarketPosition.set(position)
  }

  return position
}

/**
 * Create MarketSnapshot for historical data
 */
export async function createMarketSnapshot(
  context: HandlerContext,
  marketId: string,
  marketState: {
    currentPriceRaw: bigint
    currentPriceFormatted: string
    floorPriceRaw: bigint
    floorPriceFormatted: string
    totalSupplyRaw: bigint
    totalSupplyFormatted: string
    marketSupplyRaw: bigint
    marketSupplyFormatted: string
  },
  volume24h: bigint,
  trades24h: bigint,
  timestamp: bigint,
  tokenDecimals: number = 18
): Promise<void> {
  const snapshotId = `${marketId}-${timestamp}`
  const volume = formatAmount(volume24h, tokenDecimals)
  const snapshot: MarketSnapshot_t = {
    id: snapshotId,
    market_id: marketId,
    timestamp,
    priceRaw: marketState.currentPriceRaw,
    priceFormatted: marketState.currentPriceFormatted,
    floorPriceRaw: marketState.floorPriceRaw,
    floorPriceFormatted: marketState.floorPriceFormatted,
    totalSupplyRaw: marketState.totalSupplyRaw,
    totalSupplyFormatted: marketState.totalSupplyFormatted,
    marketSupplyRaw: marketState.marketSupplyRaw,
    marketSupplyFormatted: marketState.marketSupplyFormatted,
    volume24hRaw: volume.raw,
    volume24hFormatted: volume.formatted,
    trades24h,
  }

  context.MarketSnapshot.set(snapshot)
}

/**
 * Update PriceCandle for charting data
 * Aggregates trades into OHLCV candles
 */
export async function updatePriceCandles(
  context: HandlerContext,
  marketId: string,
  trade: {
    newPriceRaw: bigint
    newPriceFormatted: string
    reserveAmountRaw: bigint
    reserveAmountFormatted: string
    timestamp: bigint
  },
  period: 'ONE_HOUR' | 'FOUR_HOURS' | 'ONE_DAY',
  tokenDecimals: number = 18
): Promise<void> {
  // Calculate candle timestamp based on period
  const periodSeconds: Record<string, number> = {
    ONE_HOUR: 3600,
    FOUR_HOURS: 14400,
    ONE_DAY: 86400,
  }

  const periodSec = periodSeconds[period]
  const candleTimestamp = BigInt(Math.floor(Number(trade.timestamp) / periodSec) * periodSec)

  const candleId = `${marketId}-${period}-${candleTimestamp}`
  let candle = await context.PriceCandle.get(candleId)

  if (!candle) {
    // New candle - initialize with trade data
    candle = {
      id: candleId,
      market_id: marketId,
      period,
      timestamp: candleTimestamp,
      openRaw: trade.newPriceRaw,
      openFormatted: trade.newPriceFormatted,
      highRaw: trade.newPriceRaw,
      highFormatted: trade.newPriceFormatted,
      lowRaw: trade.newPriceRaw,
      lowFormatted: trade.newPriceFormatted,
      closeRaw: trade.newPriceRaw,
      closeFormatted: trade.newPriceFormatted,
      volumeRaw: trade.reserveAmountRaw,
      volumeFormatted: trade.reserveAmountFormatted,
      trades: 1n,
    }
  } else {
    // Update existing candle
    const newHigh = trade.newPriceRaw > candle.highRaw
    const newLow = trade.newPriceRaw < candle.lowRaw
    const newVolume = formatAmount(candle.volumeRaw + trade.reserveAmountRaw, tokenDecimals)

    candle = {
      ...candle,
      highRaw: newHigh ? trade.newPriceRaw : candle.highRaw,
      highFormatted: newHigh ? trade.newPriceFormatted : candle.highFormatted,
      lowRaw: newLow ? trade.newPriceRaw : candle.lowRaw,
      lowFormatted: newLow ? trade.newPriceFormatted : candle.lowFormatted,
      closeRaw: trade.newPriceRaw,
      closeFormatted: trade.newPriceFormatted,
      volumeRaw: newVolume.raw,
      volumeFormatted: newVolume.formatted,
      trades: candle.trades + 1n,
    }
  }

  context.PriceCandle.set(candle)
}
