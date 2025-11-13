import { SplitterTreasury } from '../generated/src/Handlers.gen'
import {
  formatAmount,
  getMarketIdForModule,
  getOrCreateToken,
  handlerErrorWrapper,
  normalizeAddress,
} from './helpers'

function buildBaseFeeDistribution(params: {
  id: string
  marketId: string
  timestamp: bigint
  transactionHash: string
}) {
  return {
    id: params.id,
    market_id: params.marketId,
    floorAmountRaw: 0n,
    floorAmountFormatted: '0',
    stakingAmountRaw: 0n,
    stakingAmountFormatted: '0',
    treasuryAmountRaw: 0n,
    treasuryAmountFormatted: '0',
    timestamp: params.timestamp,
    transactionHash: params.transactionHash,
  }
}

SplitterTreasury.FloorFeePaid.handler(
  handlerErrorWrapper(async ({ event, context }) => {
    const marketId = await getMarketIdForModule(context, normalizeAddress(event.srcAddress))
    if (!marketId) {
      context.log.warn(
        `[FloorFeePaid] Unable to resolve market for treasury=${event.srcAddress} | tx=${event.transaction.hash}`
      )
      return
    }

    const token = await getOrCreateToken(context, event.chainId, event.params.token_)
    const amount = formatAmount(event.params.amount_, token.decimals)
    const distribution = {
      ...buildBaseFeeDistribution({
        id: `${event.transaction.hash}-${event.logIndex}`,
        marketId,
        timestamp: BigInt(event.block.timestamp),
        transactionHash: event.transaction.hash,
      }),
      floorAmountRaw: event.params.amount_,
      floorAmountFormatted: amount.formatted,
    }

    context.FeeDistribution.set(distribution)
    context.log.info(
      `[FloorFeePaid] Recorded floor fee | marketId=${marketId} | amount=${amount.formatted} ${token.symbol}`
    )
  })
)

SplitterTreasury.RecipientPayment.handler(
  handlerErrorWrapper(async ({ event, context }) => {
    const marketId = await getMarketIdForModule(context, normalizeAddress(event.srcAddress))
    if (!marketId) {
      context.log.warn(
        `[RecipientPayment] Unable to resolve market for treasury=${event.srcAddress} | tx=${event.transaction.hash}`
      )
      return
    }

    const token = await getOrCreateToken(context, event.chainId, event.params.token_)
    const amount = formatAmount(event.params.amount_, token.decimals)
    const distribution = {
      ...buildBaseFeeDistribution({
        id: `${event.transaction.hash}-${event.logIndex}`,
        marketId,
        timestamp: BigInt(event.block.timestamp),
        transactionHash: event.transaction.hash,
      }),
      treasuryAmountRaw: event.params.amount_,
      treasuryAmountFormatted: amount.formatted,
    }

    context.FeeDistribution.set(distribution)
    context.log.info(
      `[RecipientPayment] Recorded recipient payment | marketId=${marketId} | recipient=${event.params.recipient_} | amount=${amount.formatted} ${token.symbol}`
    )
  })
)
