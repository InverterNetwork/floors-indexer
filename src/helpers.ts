// Shared utility functions for event handlers

import type { HandlerContext } from '../generated/src/Types'
import type {
  Account_t,
  Token_t,
  UserMarketPosition_t,
  UserPortfolioSummary_t,
  MarketSnapshot_t,
  PriceCandle_t,
} from '../generated/src/db/Entities.gen'

/**
 * Format a raw BigInt amount with decimals into Amount type
 */
export function formatAmount(raw: bigint, decimals: number): { raw: bigint; formatted: string } {
  const divisor = BigInt(10 ** decimals)
  const whole = raw / divisor
  const fractional = raw % divisor
  const fractionalStr = fractional.toString().padStart(decimals, '0')
  
  // Remove trailing zeros from fractional part
  const trimmedFractional = fractionalStr.replace(/0+$/, '')
  const formatted = trimmedFractional ? `${whole}.${trimmedFractional}` : whole.toString()
  
  return {
    raw,
    formatted,
  }
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
  let account = await context.Account.get(address)
  
  if (!account) {
    account = {
      id: address,
    }
    context.Account.set(account)
  }
  
  return account
}

/**
 * Get or create Token entity by fetching ERC20 metadata via RPC
 * Note: In Envio, RPC calls are made through context.contracts
 * This is a placeholder - actual implementation depends on Envio's RPC API
 */
export async function getOrCreateToken(
  context: HandlerContext,
  address: string
): Promise<Token_t> {
  let token = await context.Token.get(address)
  
  if (!token) {
    // TODO: Fetch ERC20 metadata via RPC call
    // For now, use placeholder values - will need to implement actual RPC call
    // const [name, symbol, decimals] = await fetchERC20Metadata(address)
    token = {
      id: address,
      name: 'Unknown Token',
      symbol: 'UNK',
      decimals: 18,
    }
    context.Token.set(token)
  }
  
  return token
}

/**
 * Update UserPortfolioSummary aggregation
 * Recalculates all portfolio metrics for a user
 */
export async function updateUserPortfolioSummary(
  context: HandlerContext,
  userId: string
): Promise<void> {
  // Note: getMany is not available in HandlerContext, only in LoaderContext
  // For now, this is a placeholder - would need to be implemented differently
  // or moved to a loader function
  
  // Calculate totals - placeholder implementation
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
    lastUpdatedAt: BigInt(Date.now() / 1000),
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
  const positionId = `${userId}-${marketId}`
  let position = await context.UserMarketPosition.get(positionId)
  
  if (!position) {
    const zeroAmount = formatAmount(0n, tokenDecimals)
    position = {
      id: positionId,
      user_id: userId,
      market_id: marketId,
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
      lastUpdatedAt: BigInt(Date.now() / 1000),
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
    const newVolume = formatAmount(
      candle.volumeRaw + trade.reserveAmountRaw,
      tokenDecimals
    )
    
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
