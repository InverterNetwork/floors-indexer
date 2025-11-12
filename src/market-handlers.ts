// Market event handlers for Floor Markets DeFi Platform
// Handles TokensBought, TokensSold, and collateral adjustment events

import { FloorMarket } from '../generated/src/Handlers.gen'
import type { TradeType_t } from '../generated/src/db/Enums.gen'
import {
  getOrCreateAccount,
  getOrCreateUserMarketPosition,
  formatAmount,
  updatePriceCandles,
  getOrCreateMarket,
  handlerErrorWrapper,
} from './helpers'

/**
 * @notice Event handler for TokensBought event
 * Creates Trade entity and updates Market with new supply and price
 */
FloorMarket.TokensBought.handler(
  handlerErrorWrapper(async ({ event, context }) => {
    context.log.info(
      `[TokensBought] Event received | srcAddress=${event.srcAddress} | depositAmount=${event.params.depositAmount_} | receivedAmount=${event.params.receivedAmount_}`
    )
    // The BC module address is the srcAddress, which is also the market ID
    const marketId = event.srcAddress.toLowerCase()
    context.log.info(`[TokensBought] Using marketId: ${marketId}`)

    // Get or create Market (contains both static and dynamic fields)
    const market = await getOrCreateMarket(
      context,
      event.chainId,
      marketId,
      BigInt(event.block.timestamp),
      undefined,
      undefined,
      event.srcAddress as `0x${string}`
    )

    if (!market) {
      context.log.error(`[TokensBought] Failed to get/create market for ${marketId}`)
      return
    }

    context.log.info(
      `[TokensBought] Market loaded | id=${market.id} | reserveToken=${market.reserveToken_id} | issuanceToken=${market.issuanceToken_id}`
    )

    // Verify tokens exist
    const reserveToken = await context.Token.get(market.reserveToken_id)
    const issuanceToken = await context.Token.get(market.issuanceToken_id)

    if (!reserveToken) {
      context.log.error(`[TokensBought] Missing reserve token: ${market.reserveToken_id}`)
      return
    }
    if (!issuanceToken) {
      context.log.error(`[TokensBought] Missing issuance token: ${market.issuanceToken_id}`)
      return
    }

    context.log.info(
      `[TokensBought] Tokens verified | reserveToken decimals=${reserveToken.decimals} | issuanceToken decimals=${issuanceToken.decimals}`
    )

    // Get or create buyer account
    const buyerAddress = event.params.receiver_ || event.params.buyer_
    if (!buyerAddress) {
      context.log.error(`[TokensBought] No buyer address found in event`)
      return
    }

    const buyer = await getOrCreateAccount(context, buyerAddress)
    context.log.info(`[TokensBought] Buyer account: ${buyer.id}`)

    // Create Trade entity
    const tradeId = `${event.transaction.hash}-${event.logIndex}`
    const tokenAmount = formatAmount(event.params.receivedAmount_, issuanceToken.decimals)
    const reserveAmount = formatAmount(event.params.depositAmount_, reserveToken.decimals)
    const fee = formatAmount(0n, reserveToken.decimals) // TODO: fetch from contract if available
    const newPrice = formatAmount(0n, reserveToken.decimals) // TODO: fetch from contract if available

    const trade = {
      id: tradeId,
      market_id: market.id,
      user_id: buyer.id,
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
    context.log.info(
      `[TokensBought] ✅ Trade created | id=${tradeId} | type=BUY | tokens=${tokenAmount.formatted} | reserve=${reserveAmount.formatted}`
    )

    // Update Market (dynamic state fields)
    const updatedMarket = {
      ...market,
      currentPriceRaw: newPrice.raw,
      currentPriceFormatted: newPrice.formatted,
      totalSupplyRaw: market.totalSupplyRaw + event.params.receivedAmount_,
      totalSupplyFormatted: formatAmount(
        market.totalSupplyRaw + event.params.receivedAmount_,
        issuanceToken.decimals
      ).formatted,
      marketSupplyRaw: market.marketSupplyRaw + event.params.receivedAmount_,
      marketSupplyFormatted: formatAmount(
        market.marketSupplyRaw + event.params.receivedAmount_,
        issuanceToken.decimals
      ).formatted,
      lastTradeTimestamp: BigInt(event.block.timestamp),
      lastUpdatedAt: BigInt(event.block.timestamp),
    }
    context.Market.set(updatedMarket)
    context.log.info(
      `[TokensBought] Market updated | totalSupply=${updatedMarket.totalSupplyFormatted}`
    )

    // Update UserMarketPosition
    const position = await getOrCreateUserMarketPosition(
      context,
      buyer.id,
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
    context.log.info(
      `[TokensBought] UserPosition updated | fTokens=${updatedPosition.fTokenBalanceFormatted}`
    )

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

    context.log.info(`[TokensBought] ✅ Handler completed successfully`)
  })
)

/**
 * @notice Event handler for TokensSold event
 * Creates Trade entity and updates Market with new supply and price
 */
FloorMarket.TokensSold.handler(
  handlerErrorWrapper(async ({ event, context }) => {
    context.log.info(
      `[TokensSold] Event received | srcAddress=${event.srcAddress} | depositAmount=${event.params.depositAmount_} | receivedAmount=${event.params.receivedAmount_}`
    )
    // The BC module address is the srcAddress, which is also the market ID
    const marketId = event.srcAddress.toLowerCase()
    context.log.info(`[TokensSold] Using marketId: ${marketId}`)

    // Get or create Market (contains both static and dynamic fields)
    const market = await getOrCreateMarket(
      context,
      event.chainId,
      marketId,
      BigInt(event.block.timestamp),
      undefined,
      undefined,
      event.srcAddress as `0x${string}`
    )

    if (!market) {
      context.log.error(`[TokensSold] Failed to get/create market for ${marketId}`)
      return
    }

    context.log.info(
      `[TokensSold] Market loaded | id=${market.id} | reserveToken=${market.reserveToken_id} | issuanceToken=${market.issuanceToken_id}`
    )

    // Verify tokens exist
    const reserveToken = await context.Token.get(market.reserveToken_id)
    const issuanceToken = await context.Token.get(market.issuanceToken_id)

    if (!reserveToken) {
      context.log.error(`[TokensSold] Missing reserve token: ${market.reserveToken_id}`)
      return
    }
    if (!issuanceToken) {
      context.log.error(`[TokensSold] Missing issuance token: ${market.issuanceToken_id}`)
      return
    }

    context.log.info(
      `[TokensSold] Tokens verified | reserveToken decimals=${reserveToken.decimals} | issuanceToken decimals=${issuanceToken.decimals}`
    )

    // Get or create seller account
    const sellerAddress = event.params.receiver_ || event.params.seller_
    if (!sellerAddress) {
      context.log.error(`[TokensSold] No seller address found in event`)
      return
    }

    const seller = await getOrCreateAccount(context, sellerAddress)
    context.log.info(`[TokensSold] Seller account: ${seller.id}`)

    // Create Trade entity
    const tradeId = `${event.transaction.hash}-${event.logIndex}`
    const tokenAmount = formatAmount(event.params.depositAmount_, issuanceToken.decimals)
    const reserveAmount = formatAmount(event.params.receivedAmount_, reserveToken.decimals)
    const fee = formatAmount(0n, reserveToken.decimals) // TODO: fetch from contract if available
    const newPrice = formatAmount(0n, reserveToken.decimals) // TODO: fetch from contract if available

    const trade = {
      id: tradeId,
      market_id: market.id,
      user_id: seller.id,
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
    context.log.info(
      `[TokensSold] ✅ Trade created | id=${tradeId} | type=SELL | tokens=${tokenAmount.formatted} | reserve=${reserveAmount.formatted}`
    )

    // Update Market (dynamic state fields)
    const updatedMarket = {
      ...market,
      currentPriceRaw: newPrice.raw,
      currentPriceFormatted: newPrice.formatted,
      totalSupplyRaw: market.totalSupplyRaw - event.params.depositAmount_,
      totalSupplyFormatted: formatAmount(
        market.totalSupplyRaw - event.params.depositAmount_,
        issuanceToken.decimals
      ).formatted,
      marketSupplyRaw: market.marketSupplyRaw - event.params.depositAmount_,
      marketSupplyFormatted: formatAmount(
        market.marketSupplyRaw - event.params.depositAmount_,
        issuanceToken.decimals
      ).formatted,
      lastTradeTimestamp: BigInt(event.block.timestamp),
      lastUpdatedAt: BigInt(event.block.timestamp),
    }
    context.Market.set(updatedMarket)
    context.log.info(
      `[TokensSold] Market updated | totalSupply=${updatedMarket.totalSupplyFormatted}`
    )

    // Update UserMarketPosition
    const position = await getOrCreateUserMarketPosition(
      context,
      seller.id,
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
    context.log.info(
      `[TokensSold] UserPosition updated | fTokens=${updatedPosition.fTokenBalanceFormatted}`
    )

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

    context.log.info(`[TokensSold] ✅ Handler completed successfully`)
  })
)

/**
 * @notice Event handler for VirtualCollateralAmountAdded event
 * Updates Market floorSupply
 */
FloorMarket.VirtualCollateralAmountAdded.handler(
  handlerErrorWrapper(async ({ event, context }) => {
    context.log.info(`[VirtualCollateralAmountAdded] Event received from ${event.srcAddress}`)
    const marketId = event.srcAddress.toLowerCase()

    const market = await getOrCreateMarket(
      context,
      event.chainId,
      marketId,
      BigInt(event.block.timestamp)
    )

    if (!market) {
      context.log.warn(`[VirtualCollateralAmountAdded] Market not found: ${marketId}`)
      return
    }

    const reserveToken = await context.Token.get(market.reserveToken_id)
    if (!reserveToken) {
      context.log.warn(`[VirtualCollateralAmountAdded] Reserve token not found`)
      return
    }

    const updatedMarket = {
      ...market,
      floorSupplyRaw: market.floorSupplyRaw + event.params.amountAdded_,
      floorSupplyFormatted: formatAmount(
        market.floorSupplyRaw + event.params.amountAdded_,
        reserveToken.decimals
      ).formatted,
      lastElevationTimestamp: BigInt(event.block.timestamp),
      lastUpdatedAt: BigInt(event.block.timestamp),
    }
    context.Market.set(updatedMarket)
    context.log.info(`[VirtualCollateralAmountAdded] ✅ Updated floorSupply`)
  })
)

/**
 * @notice Event handler for VirtualCollateralAmountSubtracted event
 * Updates Market floorSupply
 */
FloorMarket.VirtualCollateralAmountSubtracted.handler(
  handlerErrorWrapper(async ({ event, context }) => {
    context.log.info(`[VirtualCollateralAmountSubtracted] Event received from ${event.srcAddress}`)
    const marketId = event.srcAddress.toLowerCase()

    const market = await getOrCreateMarket(
      context,
      event.chainId,
      marketId,
      BigInt(event.block.timestamp)
    )

    if (!market) {
      context.log.warn(`[VirtualCollateralAmountSubtracted] Market not found: ${marketId}`)
      return
    }

    const reserveToken = await context.Token.get(market.reserveToken_id)
    if (!reserveToken) {
      context.log.warn(`[VirtualCollateralAmountSubtracted] Reserve token not found`)
      return
    }

    const updatedMarket = {
      ...market,
      floorSupplyRaw: market.floorSupplyRaw - event.params.amountSubtracted_,
      floorSupplyFormatted: formatAmount(
        market.floorSupplyRaw - event.params.amountSubtracted_,
        reserveToken.decimals
      ).formatted,
      lastElevationTimestamp: BigInt(event.block.timestamp),
      lastUpdatedAt: BigInt(event.block.timestamp),
    }
    context.Market.set(updatedMarket)
    context.log.info(`[VirtualCollateralAmountSubtracted] ✅ Updated floorSupply`)
  })
)
