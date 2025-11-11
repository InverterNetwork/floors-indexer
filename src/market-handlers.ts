// Market event handlers for Floor Markets DeFi Platform

import {
  FloorMarket,
} from '../generated/src/Handlers.gen'
import type {
  TradeType_t,
} from '../generated/src/db/Enums.gen'
import {
  getOrCreateAccount,
  getOrCreateUserMarketPosition,
  formatAmount,
  updateUserPortfolioSummary,
  updatePriceCandles,
} from './helpers'

/**
 * @notice Event handler for TokensBought event
 * Updates MarketState, creates Trade, updates UserMarketPosition
 */
FloorMarket.TokensBought.handler(async ({ event, context }) => {
  const market = await context.Market.get(event.srcAddress)
  if (!market) return

  const marketState = await context.MarketState.get(event.srcAddress)
  if (!marketState) return

  const reserveToken = await context.Token.get(market.reserveToken_id)
  const issuanceToken = await context.Token.get(market.issuanceToken_id)
  if (!reserveToken || !issuanceToken) return

  // Get or create user account (use receiver_ or buyer_)
  const userAddress = event.params.receiver_ || event.params.buyer_
  const user = await getOrCreateAccount(context, userAddress)

  // Create Trade entity
  const tradeId = `${event.transaction.hash}-${event.logIndex}`
  const tokenAmount = formatAmount(event.params.receivedAmount_, issuanceToken.decimals)
  const reserveAmount = formatAmount(event.params.depositAmount_, reserveToken.decimals)
  // Note: Fee and newPrice not in TokensBought event - would need to fetch from contract
  const fee = formatAmount(0n, reserveToken.decimals)
  const newPrice = formatAmount(0n, reserveToken.decimals)
  
  const trade = {
    id: tradeId,
    market_id: market.id,
    user_id: user.id,
    tradeType: 'BUY' as TradeType_t,
    tokenAmountRaw: event.params.receivedAmount_,
    tokenAmountFormatted: tokenAmount.formatted,
    reserveAmountRaw: event.params.depositAmount_,
    reserveAmountFormatted: reserveAmount.formatted,
    feeRaw: fee.raw,
    feeFormatted: fee.formatted,
    newPriceRaw: newPrice.raw,
    newPriceFormatted: newPrice.formatted,
    timestamp: BigInt(event.block.timestamp),
    transactionHash: event.transaction.hash,
  }
  context.Trade.set(trade)

  // Update MarketState
  const updatedMarketState = {
    ...marketState,
    currentPriceRaw: newPrice.raw,
    currentPriceFormatted: newPrice.formatted,
    totalSupplyRaw: marketState.totalSupplyRaw + event.params.receivedAmount_,
    totalSupplyFormatted: formatAmount(
      marketState.totalSupplyRaw + event.params.receivedAmount_,
      issuanceToken.decimals
    ).formatted,
    marketSupplyRaw: marketState.marketSupplyRaw + event.params.receivedAmount_,
    marketSupplyFormatted: formatAmount(
      marketState.marketSupplyRaw + event.params.receivedAmount_,
      issuanceToken.decimals
    ).formatted,
    lastTradeTimestamp: BigInt(event.block.timestamp),
    lastUpdatedAt: BigInt(event.block.timestamp),
  }
  context.MarketState.set(updatedMarketState)

  // Update UserMarketPosition
  const position = await getOrCreateUserMarketPosition(
    context,
    user.id,
    market.id,
    issuanceToken.decimals
  )
  const updatedPosition = {
    ...position,
    fTokenBalanceRaw: position.fTokenBalanceRaw + event.params.receivedAmount_,
    fTokenBalanceFormatted: formatAmount(
      position.fTokenBalanceRaw + event.params.receivedAmount_,
      issuanceToken.decimals
    ).formatted,
    reserveBalanceRaw: position.reserveBalanceRaw - event.params.depositAmount_,
    reserveBalanceFormatted: formatAmount(
      position.reserveBalanceRaw - event.params.depositAmount_,
      reserveToken.decimals
    ).formatted,
    lastUpdatedAt: BigInt(event.block.timestamp),
  }
  context.UserMarketPosition.set(updatedPosition)

  // Update user portfolio summary
  await updateUserPortfolioSummary(context, user.id)

  // Update price candles
  await updatePriceCandles(
    context,
    market.id,
    {
      newPriceRaw: newPrice.raw,
      newPriceFormatted: newPrice.formatted,
      reserveAmountRaw: reserveAmount.raw,
      reserveAmountFormatted: reserveAmount.formatted,
      timestamp: trade.timestamp,
    },
    'ONE_HOUR',
    reserveToken.decimals
  )
  await updatePriceCandles(
    context,
    market.id,
    {
      newPriceRaw: newPrice.raw,
      newPriceFormatted: newPrice.formatted,
      reserveAmountRaw: reserveAmount.raw,
      reserveAmountFormatted: reserveAmount.formatted,
      timestamp: trade.timestamp,
    },
    'FOUR_HOURS',
    reserveToken.decimals
  )
  await updatePriceCandles(
    context,
    market.id,
    {
      newPriceRaw: newPrice.raw,
      newPriceFormatted: newPrice.formatted,
      reserveAmountRaw: reserveAmount.raw,
      reserveAmountFormatted: reserveAmount.formatted,
      timestamp: trade.timestamp,
    },
    'ONE_DAY',
    reserveToken.decimals
  )
})

/**
 * @notice Event handler for TokensSold event
 * Updates MarketState, creates Trade, updates UserMarketPosition
 */
FloorMarket.TokensSold.handler(async ({ event, context }) => {
  const market = await context.Market.get(event.srcAddress)
  if (!market) return

  const marketState = await context.MarketState.get(event.srcAddress)
  if (!marketState) return

  const reserveToken = await context.Token.get(market.reserveToken_id)
  const issuanceToken = await context.Token.get(market.issuanceToken_id)
  if (!reserveToken || !issuanceToken) return

  // Get or create user account (use receiver_ or seller_)
  const userAddress = event.params.receiver_ || event.params.seller_
  const user = await getOrCreateAccount(context, userAddress)

  // Create Trade entity
  const tradeId = `${event.transaction.hash}-${event.logIndex}`
  const tokenAmount = formatAmount(event.params.depositAmount_, issuanceToken.decimals)
  const reserveAmount = formatAmount(event.params.receivedAmount_, reserveToken.decimals)
  // Note: Fee and newPrice not in TokensSold event - would need to fetch from contract
  const fee = formatAmount(0n, reserveToken.decimals)
  const newPrice = formatAmount(0n, reserveToken.decimals)
  
  const trade = {
    id: tradeId,
    market_id: market.id,
    user_id: user.id,
    tradeType: 'SELL' as TradeType_t,
    tokenAmountRaw: event.params.depositAmount_,
    tokenAmountFormatted: tokenAmount.formatted,
    reserveAmountRaw: event.params.receivedAmount_,
    reserveAmountFormatted: reserveAmount.formatted,
    feeRaw: fee.raw,
    feeFormatted: fee.formatted,
    newPriceRaw: newPrice.raw,
    newPriceFormatted: newPrice.formatted,
    timestamp: BigInt(event.block.timestamp),
    transactionHash: event.transaction.hash,
  }
  context.Trade.set(trade)

  // Update MarketState
  const updatedMarketState = {
    ...marketState,
    currentPriceRaw: newPrice.raw,
    currentPriceFormatted: newPrice.formatted,
    totalSupplyRaw: marketState.totalSupplyRaw - event.params.depositAmount_,
    totalSupplyFormatted: formatAmount(
      marketState.totalSupplyRaw - event.params.depositAmount_,
      issuanceToken.decimals
    ).formatted,
    marketSupplyRaw: marketState.marketSupplyRaw - event.params.depositAmount_,
    marketSupplyFormatted: formatAmount(
      marketState.marketSupplyRaw - event.params.depositAmount_,
      issuanceToken.decimals
    ).formatted,
    lastTradeTimestamp: BigInt(event.block.timestamp),
    lastUpdatedAt: BigInt(event.block.timestamp),
  }
  context.MarketState.set(updatedMarketState)

  // Update UserMarketPosition
  const position = await getOrCreateUserMarketPosition(
    context,
    user.id,
    market.id,
    issuanceToken.decimals
  )
  const updatedPosition = {
    ...position,
    fTokenBalanceRaw: position.fTokenBalanceRaw - event.params.depositAmount_,
    fTokenBalanceFormatted: formatAmount(
      position.fTokenBalanceRaw - event.params.depositAmount_,
      issuanceToken.decimals
    ).formatted,
    reserveBalanceRaw: position.reserveBalanceRaw + event.params.receivedAmount_,
    reserveBalanceFormatted: formatAmount(
      position.reserveBalanceRaw + event.params.receivedAmount_,
      reserveToken.decimals
    ).formatted,
    lastUpdatedAt: BigInt(event.block.timestamp),
  }
  context.UserMarketPosition.set(updatedPosition)

  // Update user portfolio summary
  await updateUserPortfolioSummary(context, user.id)

  // Update price candles
  await updatePriceCandles(
    context,
    market.id,
    {
      newPriceRaw: newPrice.raw,
      newPriceFormatted: newPrice.formatted,
      reserveAmountRaw: reserveAmount.raw,
      reserveAmountFormatted: reserveAmount.formatted,
      timestamp: trade.timestamp,
    },
    'ONE_HOUR',
    reserveToken.decimals
  )
  await updatePriceCandles(
    context,
    market.id,
    {
      newPriceRaw: newPrice.raw,
      newPriceFormatted: newPrice.formatted,
      reserveAmountRaw: reserveAmount.raw,
      reserveAmountFormatted: reserveAmount.formatted,
      timestamp: trade.timestamp,
    },
    'FOUR_HOURS',
    reserveToken.decimals
  )
  await updatePriceCandles(
    context,
    market.id,
    {
      newPriceRaw: newPrice.raw,
      newPriceFormatted: newPrice.formatted,
      reserveAmountRaw: reserveAmount.raw,
      reserveAmountFormatted: reserveAmount.formatted,
      timestamp: trade.timestamp,
    },
    'ONE_DAY',
    reserveToken.decimals
  )
})

/**
 * @notice Event handler for VirtualCollateralAmountAdded event
 * Updates MarketState floorSupply when collateral is added
 */
FloorMarket.VirtualCollateralAmountAdded.handler(async ({ event, context }) => {
  const market = await context.Market.get(event.srcAddress)
  if (!market) return

  const marketState = await context.MarketState.get(event.srcAddress)
  if (!marketState) return

  const reserveToken = await context.Token.get(market.reserveToken_id)
  if (!reserveToken) return

  // Update MarketState floorSupply
  const updatedMarketState = {
    ...marketState,
    floorSupplyRaw: marketState.floorSupplyRaw + event.params.amountAdded_,
    floorSupplyFormatted: formatAmount(
      marketState.floorSupplyRaw + event.params.amountAdded_,
      reserveToken.decimals
    ).formatted,
    lastElevationTimestamp: BigInt(event.block.timestamp),
    lastUpdatedAt: BigInt(event.block.timestamp),
  }
  context.MarketState.set(updatedMarketState)
})

/**
 * @notice Event handler for VirtualCollateralAmountSubtracted event
 * Updates MarketState floorSupply when collateral is subtracted
 */
FloorMarket.VirtualCollateralAmountSubtracted.handler(async ({ event, context }) => {
  const market = await context.Market.get(event.srcAddress)
  if (!market) return

  const marketState = await context.MarketState.get(event.srcAddress)
  if (!marketState) return

  const reserveToken = await context.Token.get(market.reserveToken_id)
  if (!reserveToken) return

  // Update MarketState floorSupply
  const updatedMarketState = {
    ...marketState,
    floorSupplyRaw: marketState.floorSupplyRaw - event.params.amountSubtracted_,
    floorSupplyFormatted: formatAmount(
      marketState.floorSupplyRaw - event.params.amountSubtracted_,
      reserveToken.decimals
    ).formatted,
    lastElevationTimestamp: BigInt(event.block.timestamp),
    lastUpdatedAt: BigInt(event.block.timestamp),
  }
  context.MarketState.set(updatedMarketState)
})
