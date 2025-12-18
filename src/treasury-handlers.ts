import { SplitterTreasury } from '../generated/src/Handlers.gen'
import {
  buildFeeSplitterPayment,
  buildFeeSplitterReceipt,
  buildTreasury,
  formatAmount,
  getMarketIdForModule,
  getOrCreateToken,
  handlerErrorWrapper,
  normalizeAddress,
} from './helpers'

SplitterTreasury.FloorFeePaid.handler(
  handlerErrorWrapper(async ({ event, context }) => {
    const marketId = await getMarketIdForModule(context, normalizeAddress(event.srcAddress))
    if (!marketId) {
      context.log.warn(
        `[FloorFeePaid] Unable to resolve market for treasury=${event.srcAddress} | tx=${event.transaction.hash}`
      )
      return
    }

    const treasuryId = normalizeAddress(event.srcAddress)
    let treasury = await context.Treasury.get(treasuryId)
    if (!treasury) {
      treasury = buildTreasury({
        id: treasuryId,
        marketId,
        treasuryAddress: treasuryId,
        createdAt: BigInt(event.block.timestamp),
        lastUpdatedAt: BigInt(event.block.timestamp),
      })
      context.Treasury.set(treasury)
    }

    const token = await getOrCreateToken(context, event.chainId, event.params.token_)
    const amount = formatAmount(event.params.amount_, token.decimals)

    // Create FeeSplitterPayment for floor fee
    const payment = buildFeeSplitterPayment({
      id: `${event.transaction.hash}-${event.logIndex}`,
      marketId,
      treasuryId,
      tokenId: token.id,
      recipient: normalizeAddress(event.srcAddress), // Treasury is the recipient of floor fees
      isFloorFee: true,
      amountRaw: event.params.amount_,
      amountFormatted: amount.formatted,
      timestamp: BigInt(event.block.timestamp),
      transactionHash: event.transaction.hash,
    })

    context.FeeSplitterPayment.set(payment)

    // Update treasury totals
    treasury = await context.Treasury.get(treasuryId)
    if (treasury) {
      const newTotalReceivedRaw = treasury.totalFeesReceivedRaw + event.params.amount_
      const newTotalReceivedFormatted = formatAmount(newTotalReceivedRaw, token.decimals).formatted

      const updatedTreasury = {
        ...treasury,
        totalFeesReceivedRaw: newTotalReceivedRaw,
        totalFeesReceivedFormatted: newTotalReceivedFormatted,
        lastUpdatedAt: BigInt(event.block.timestamp),
      }
      context.Treasury.set(updatedTreasury)
    }

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

    const treasuryId = normalizeAddress(event.srcAddress)
    let treasury = await context.Treasury.get(treasuryId)
    if (!treasury) {
      treasury = buildTreasury({
        id: treasuryId,
        marketId,
        treasuryAddress: treasuryId,
        createdAt: BigInt(event.block.timestamp),
        lastUpdatedAt: BigInt(event.block.timestamp),
      })
      context.Treasury.set(treasury)
    }

    const token = await getOrCreateToken(context, event.chainId, event.params.token_)
    const amount = formatAmount(event.params.amount_, token.decimals)

    // Create FeeSplitterPayment for recipient payment
    const payment = buildFeeSplitterPayment({
      id: `${event.transaction.hash}-${event.logIndex}`,
      marketId,
      treasuryId,
      tokenId: token.id,
      recipient: normalizeAddress(event.params.recipient_),
      isFloorFee: false,
      amountRaw: event.params.amount_,
      amountFormatted: amount.formatted,
      timestamp: BigInt(event.block.timestamp),
      transactionHash: event.transaction.hash,
    })

    context.FeeSplitterPayment.set(payment)

    // Update treasury totals
    treasury = await context.Treasury.get(treasuryId)
    if (treasury) {
      const newTotalDistributedRaw = treasury.totalFeesDistributedRaw + event.params.amount_
      const newTotalDistributedFormatted = formatAmount(
        newTotalDistributedRaw,
        token.decimals
      ).formatted

      const updatedTreasury = {
        ...treasury,
        totalFeesDistributedRaw: newTotalDistributedRaw,
        totalFeesDistributedFormatted: newTotalDistributedFormatted,
        lastUpdatedAt: BigInt(event.block.timestamp),
      }
      context.Treasury.set(updatedTreasury)
    }

    context.log.info(
      `[RecipientPayment] Recorded recipient payment | marketId=${marketId} | recipient=${normalizeAddress(event.params.recipient_)} | amount=${amount.formatted} ${token.symbol}`
    )
  })
)

SplitterTreasury.FloorFeePercentageUpdated.handler(
  handlerErrorWrapper(async ({ event, context }) => {
    const marketId = await getMarketIdForModule(context, normalizeAddress(event.srcAddress))
    if (!marketId) {
      context.log.warn(
        `[FloorFeePercentageUpdated] Unable to resolve market for treasury=${event.srcAddress} | tx=${event.transaction.hash}`
      )
      return
    }

    context.log.info(
      `[FloorFeePercentageUpdated] ✅ Fee percentage updated | marketId=${marketId} | oldFee=${event.params.oldFee_.toString()} | newFee=${event.params.newFee_.toString()}`
    )
  })
)

SplitterTreasury.FloorFeeTreasuryUpdated.handler(
  handlerErrorWrapper(async ({ event, context }) => {
    const marketId = await getMarketIdForModule(context, normalizeAddress(event.srcAddress))
    if (!marketId) {
      context.log.warn(
        `[FloorFeeTreasuryUpdated] Unable to resolve market for treasury=${event.srcAddress} | tx=${event.transaction.hash}`
      )
      return
    }

    context.log.info(
      `[FloorFeeTreasuryUpdated] ✅ Treasury address updated | marketId=${marketId} | oldTreasury=${event.params.oldTreasury_} | newTreasury=${event.params.newTreasury_}`
    )
  })
)

SplitterTreasury.RecipientAdded.handler(
  handlerErrorWrapper(async ({ event, context }) => {
    const marketId = await getMarketIdForModule(context, normalizeAddress(event.srcAddress))
    if (!marketId) {
      context.log.warn(
        `[RecipientAdded] Unable to resolve market for treasury=${event.srcAddress} | tx=${event.transaction.hash}`
      )
      return
    }

    context.log.info(
      `[RecipientAdded] ✅ Recipient added | marketId=${marketId} | recipient=${event.params.account_} | shares=${event.params.shares_.toString()}`
    )
  })
)

SplitterTreasury.RecipientsCleared.handler(
  handlerErrorWrapper(async ({ event, context }) => {
    const marketId = await getMarketIdForModule(context, normalizeAddress(event.srcAddress))
    if (!marketId) {
      context.log.warn(
        `[RecipientsCleared] Unable to resolve market for treasury=${event.srcAddress} | tx=${event.transaction.hash}`
      )
      return
    }

    context.log.info(`[RecipientsCleared] ✅ All recipients cleared | marketId=${marketId}`)
  })
)

SplitterTreasury.Treasury_FundsReceived.handler(
  handlerErrorWrapper(async ({ event, context }) => {
    const marketId = await getMarketIdForModule(context, normalizeAddress(event.srcAddress))
    if (!marketId) {
      context.log.warn(
        `[Treasury_FundsReceived] Unable to resolve market for treasury=${event.srcAddress} | tx=${event.transaction.hash}`
      )
      return
    }

    const treasuryId = normalizeAddress(event.srcAddress)
    let treasury = await context.Treasury.get(treasuryId)
    if (!treasury) {
      treasury = buildTreasury({
        id: treasuryId,
        marketId,
        treasuryAddress: treasuryId,
        createdAt: BigInt(event.block.timestamp),
        lastUpdatedAt: BigInt(event.block.timestamp),
      })
      context.Treasury.set(treasury)
    }

    const token = await getOrCreateToken(context, event.chainId, event.params.token)
    const amount = formatAmount(event.params.amount, token.decimals)

    // Create FeeSplitterReceipt for fees received
    const receipt = buildFeeSplitterReceipt({
      id: `${event.transaction.hash}-${event.logIndex}`,
      marketId,
      treasuryId,
      tokenId: token.id,
      sender: normalizeAddress(event.params.sender),
      amountRaw: event.params.amount,
      amountFormatted: amount.formatted,
      timestamp: BigInt(event.block.timestamp),
      transactionHash: event.transaction.hash,
    })

    context.FeeSplitterReceipt.set(receipt)

    // Update treasury totals
    treasury = await context.Treasury.get(treasuryId)
    if (treasury) {
      const newTotalReceivedRaw = treasury.totalFeesReceivedRaw + event.params.amount
      const newTotalReceivedFormatted = formatAmount(newTotalReceivedRaw, token.decimals).formatted

      const updatedTreasury = {
        ...treasury,
        totalFeesReceivedRaw: newTotalReceivedRaw,
        totalFeesReceivedFormatted: newTotalReceivedFormatted,
        lastUpdatedAt: BigInt(event.block.timestamp),
      }
      context.Treasury.set(updatedTreasury)
    }

    context.log.info(
      `[Treasury_FundsReceived] ✅ Treasury funds received | marketId=${marketId} | token=${token.symbol} | amount=${amount.formatted} | sender=${normalizeAddress(event.params.sender)}`
    )
  })
)
