import type { handlerContext } from 'generated'
import type { GlobalStatsSnapshot_t, MarketSnapshot_t } from 'generated/src/db/Entities.gen'
import type { CandlePeriod_t, SnapshotPeriod_t } from 'generated/src/db/Enums.gen'

import { formatAmount } from './misc'

/**
 * Snapshot period configurations for GlobalStatsSnapshot
 */
const SNAPSHOT_PERIOD_SECONDS: Record<SnapshotPeriod_t, bigint> = {
  ONE_HOUR: 3600n,
  FOUR_HOURS: 14400n,
  ONE_DAY: 86400n,
}

/**
 * Update GlobalStatsSnapshots for all periods (1h, 4h, 1d)
 * Creates time-bucketed snapshots of TVL, Market Cap, and volume
 */
export async function updateGlobalStatsSnapshots(
  context: handlerContext,
  timestamp: bigint,
  metrics: {
    totalValueLockedRaw: bigint
    totalMarketCapRaw: bigint
    periodVolumeRaw: bigint
    totalMarkets: bigint
    activeMarkets: bigint
  }
): Promise<void> {
  const periods: SnapshotPeriod_t[] = ['ONE_HOUR', 'FOUR_HOURS', 'ONE_DAY']

  for (const period of periods) {
    const periodSeconds = SNAPSHOT_PERIOD_SECONDS[period]
    const snapshotTimestamp = (timestamp / periodSeconds) * periodSeconds
    const snapshotId = `global-${period}-${snapshotTimestamp}`

    const existing = await context.GlobalStatsSnapshot.get(snapshotId)

    if (existing) {
      // Update with latest TVL/MarketCap (point-in-time), accumulate volume
      const newVolume = existing.periodVolumeRaw + metrics.periodVolumeRaw
      const volumeFormatted = formatAmount(newVolume, 18)
      const tvlFormatted = formatAmount(metrics.totalValueLockedRaw, 18)
      const mcFormatted = formatAmount(metrics.totalMarketCapRaw, 18)

      context.GlobalStatsSnapshot.set({
        ...existing,
        totalValueLockedRaw: metrics.totalValueLockedRaw,
        totalValueLockedFormatted: tvlFormatted.formatted,
        totalMarketCapRaw: metrics.totalMarketCapRaw,
        totalMarketCapFormatted: mcFormatted.formatted,
        periodVolumeRaw: newVolume,
        periodVolumeFormatted: volumeFormatted.formatted,
        totalMarkets: metrics.totalMarkets,
        activeMarkets: metrics.activeMarkets,
      })
    } else {
      // Create new snapshot
      const tvlFormatted = formatAmount(metrics.totalValueLockedRaw, 18)
      const mcFormatted = formatAmount(metrics.totalMarketCapRaw, 18)
      const volumeFormatted = formatAmount(metrics.periodVolumeRaw, 18)

      const snapshot: GlobalStatsSnapshot_t = {
        id: snapshotId,
        period,
        timestamp: snapshotTimestamp,
        totalValueLockedRaw: metrics.totalValueLockedRaw,
        totalValueLockedFormatted: tvlFormatted.formatted,
        totalMarketCapRaw: metrics.totalMarketCapRaw,
        totalMarketCapFormatted: mcFormatted.formatted,
        periodVolumeRaw: metrics.periodVolumeRaw,
        periodVolumeFormatted: volumeFormatted.formatted,
        totalMarkets: metrics.totalMarkets,
        activeMarkets: metrics.activeMarkets,
      }

      context.GlobalStatsSnapshot.set(snapshot)
    }
  }
}

/**
 * Update PriceCandle for charting data
 * Aggregates trades into OHLCV candles
 */
export async function updatePriceCandles(
  context: handlerContext,
  marketId: string,
  trade: {
    newPriceRaw: bigint
    newPriceFormatted: string
    reserveAmountRaw: bigint
    reserveAmountFormatted: string
    timestamp: bigint
  },
  period: CandlePeriod_t,
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

/**
 * Create MarketSnapshot for historical data
 * Note: Market entity contains both static and dynamic state fields
 */
export async function createMarketSnapshot(
  context: handlerContext,
  marketId: string,
  market: {
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
    priceRaw: market.currentPriceRaw,
    priceFormatted: market.currentPriceFormatted,
    floorPriceRaw: market.floorPriceRaw,
    floorPriceFormatted: market.floorPriceFormatted,
    totalSupplyRaw: market.totalSupplyRaw,
    totalSupplyFormatted: market.totalSupplyFormatted,
    marketSupplyRaw: market.marketSupplyRaw,
    marketSupplyFormatted: market.marketSupplyFormatted,
    volume24hRaw: volume.raw,
    volume24hFormatted: volume.formatted,
    trades24h,
  }

  context.MarketSnapshot.set(snapshot)
}
