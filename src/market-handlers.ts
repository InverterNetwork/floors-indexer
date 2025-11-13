// Market event handlers for Floor Markets DeFi Platform
// Handles TokensBought, TokensSold, and collateral adjustment events

import type { TradeType_t } from '../generated/src/db/Enums.gen'
import { FloorMarket } from '../generated/src/Handlers.gen'
import {
  buildUpdatedUserMarketPosition,
  fetchFloorPricing,
  formatAmount,
  getOrCreateAccount,
  getOrCreateMarket,
  getOrCreateUserMarketPosition,
  handlerErrorWrapper,
  updatePriceCandles,
} from './helpers'

const BPS_DENOMINATOR = 10_000n

/**
 * @notice Event handler for TokensBought event
 * Creates Trade entity and updates Market with new supply and price
 */
FloorMarket.TokensBought.handler(
  handlerErrorWrapper(async ({ event, context }) => {
    context.log.debug(
      `[TokensBought] Handler entry | block=${event.block.number} | logIndex=${event.logIndex} | tx=${event.transaction.hash}`
    )
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
      context.log.error(
        `[TokensBought] ❌ Failed to get/create market | marketId=${marketId} | block=${event.block.number}`
      )
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

    context.log.debug(
      `[TokensBought] Tokens verified | reserveToken=${reserveToken.id} (${reserveToken.decimals} decimals) | issuanceToken=${issuanceToken.id} (${issuanceToken.decimals} decimals)`
    )

    context.log.info(
      `[TokensBought] Tokens verified | reserveToken decimals=${reserveToken.decimals} | issuanceToken decimals=${issuanceToken.decimals}`
    )

    const pricing = await fetchFloorPricing(event.chainId, event.srcAddress as `0x${string}`)
    const buyPriceRaw = pricing.buyPrice ?? market.currentPriceRaw
    const buyFeeBps = pricing.buyFeeBps ?? market.buyFeeBps ?? 0n
    const sellFeeBps = pricing.sellFeeBps ?? market.sellFeeBps ?? 0n
    const floorPriceRaw = pricing.floorPrice ?? market.floorPriceRaw
    const priceAmount = formatAmount(buyPriceRaw, reserveToken.decimals)
    const floorPriceAmount = formatAmount(floorPriceRaw, reserveToken.decimals)
    const feeAmountRaw =
      buyFeeBps > 0n ? (event.params.depositAmount_ * buyFeeBps) / BPS_DENOMINATOR : 0n
    const feeAmount = formatAmount(feeAmountRaw, reserveToken.decimals)

    // Get or create buyer account
    const buyerAddress = event.params.receiver_ || event.params.buyer_
    if (!buyerAddress) {
      context.log.error(`[TokensBought] No buyer address found in event`)
      return
    }

    const buyer = await getOrCreateAccount(context, buyerAddress)
    context.log.info(`[TokensBought] Buyer account: ${buyer.id}`)
    context.log.debug(`[TokensBought] Buyer account ready | user=${buyer.id} | market=${market.id}`)

    // Create Trade entity
    const tradeId = `${event.transaction.hash}-${event.logIndex}`
    const tokenAmount = formatAmount(event.params.receivedAmount_, issuanceToken.decimals)
    const reserveAmount = formatAmount(event.params.depositAmount_, reserveToken.decimals)
    const trade = {
      id: tradeId,
      market_id: market.id,
      user_id: buyer.id,
      tradeType: 'BUY' as TradeType_t,
      tokenAmountRaw: event.params.receivedAmount_,
      tokenAmountFormatted: tokenAmount.formatted,
      reserveAmountRaw: event.params.depositAmount_,
      reserveAmountFormatted: reserveAmount.formatted,
      feeRaw: feeAmountRaw,
      feeFormatted: feeAmount.formatted,
      newPriceRaw: buyPriceRaw,
      newPriceFormatted: priceAmount.formatted,
      timestamp: BigInt(event.block.timestamp),
      transactionHash: event.transaction.hash,
    }

    context.Trade.set(trade)
    context.log.info(
      `[TokensBought] ✅ Trade created | id=${tradeId} | type=BUY | tokens=${tokenAmount.formatted} | reserve=${reserveAmount.formatted}`
    )
    context.log.debug(
      `[TokensBought] Trade details | market=${market.id} | user=${buyer.id} | tokenRaw=${trade.tokenAmountRaw} | reserveRaw=${trade.reserveAmountRaw}`
    )

    // Update Market (dynamic state fields)
    const updatedMarket = {
      ...market,
      currentPriceRaw: buyPriceRaw,
      currentPriceFormatted: priceAmount.formatted,
      floorPriceRaw,
      floorPriceFormatted: floorPriceAmount.formatted,
      tradingFeeBps: buyFeeBps,
      buyFeeBps,
      sellFeeBps,
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
    const updatedPosition = buildUpdatedUserMarketPosition(position, {
      netFTokenChangeDelta: event.params.receivedAmount_,
      issuanceTokenDecimals: issuanceToken.decimals,
      reserveTokenDecimals: reserveToken.decimals,
      timestamp: BigInt(event.block.timestamp),
    })
    context.UserMarketPosition.set(updatedPosition)
    context.log.info(
      `[TokensBought] UserPosition updated | netFToken=${updatedPosition.netFTokenChangeFormatted}`
    )

    // Update price candles
    await updatePriceCandles(
      context,
      market.id,
      {
        newPriceRaw: buyPriceRaw,
        newPriceFormatted: priceAmount.formatted,
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
    context.log.debug(
      `[TokensSold] Handler entry | block=${event.block.number} | logIndex=${event.logIndex} | tx=${event.transaction.hash}`
    )
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
      context.log.error(
        `[TokensSold] ❌ Failed to get/create market | marketId=${marketId} | block=${event.block.number}`
      )
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

    context.log.debug(
      `[TokensSold] Tokens verified | reserveToken=${reserveToken.id} (${reserveToken.decimals} decimals) | issuanceToken=${issuanceToken.id} (${issuanceToken.decimals} decimals)`
    )

    context.log.info(
      `[TokensSold] Tokens verified | reserveToken decimals=${reserveToken.decimals} | issuanceToken decimals=${issuanceToken.decimals}`
    )

    const pricing = await fetchFloorPricing(event.chainId, event.srcAddress as `0x${string}`)
    const sellPriceRaw = pricing.sellPrice ?? market.currentPriceRaw
    const buyFeeBps = pricing.buyFeeBps ?? market.buyFeeBps ?? 0n
    const sellFeeBps = pricing.sellFeeBps ?? market.sellFeeBps ?? 0n
    const floorPriceRaw = pricing.floorPrice ?? market.floorPriceRaw
    const priceAmount = formatAmount(sellPriceRaw, reserveToken.decimals)
    const floorPriceAmount = formatAmount(floorPriceRaw, reserveToken.decimals)
    const feeAmountRaw =
      sellFeeBps > 0n ? (event.params.receivedAmount_ * sellFeeBps) / BPS_DENOMINATOR : 0n
    const feeAmount = formatAmount(feeAmountRaw, reserveToken.decimals)

    // Get or create seller account
    const sellerAddress = event.params.receiver_ || event.params.seller_
    if (!sellerAddress) {
      context.log.error(`[TokensSold] No seller address found in event`)
      return
    }

    const seller = await getOrCreateAccount(context, sellerAddress)
    context.log.info(`[TokensSold] Seller account: ${seller.id}`)
    context.log.debug(`[TokensSold] Seller account ready | user=${seller.id} | market=${market.id}`)

    // Create Trade entity
    const tradeId = `${event.transaction.hash}-${event.logIndex}`
    const tokenAmount = formatAmount(event.params.depositAmount_, issuanceToken.decimals)
    const reserveAmount = formatAmount(event.params.receivedAmount_, reserveToken.decimals)
    const trade = {
      id: tradeId,
      market_id: market.id,
      user_id: seller.id,
      tradeType: 'SELL' as TradeType_t,
      tokenAmountRaw: event.params.depositAmount_,
      tokenAmountFormatted: tokenAmount.formatted,
      reserveAmountRaw: event.params.receivedAmount_,
      reserveAmountFormatted: reserveAmount.formatted,
      feeRaw: feeAmountRaw,
      feeFormatted: feeAmount.formatted,
      newPriceRaw: sellPriceRaw,
      newPriceFormatted: priceAmount.formatted,
      timestamp: BigInt(event.block.timestamp),
      transactionHash: event.transaction.hash,
    }

    context.Trade.set(trade)
    context.log.info(
      `[TokensSold] ✅ Trade created | id=${tradeId} | type=SELL | tokens=${tokenAmount.formatted} | reserve=${reserveAmount.formatted}`
    )
    context.log.debug(
      `[TokensSold] Trade details | market=${market.id} | user=${seller.id} | tokenRaw=${trade.tokenAmountRaw} | reserveRaw=${trade.reserveAmountRaw}`
    )

    // Update Market (dynamic state fields)
    const updatedMarket = {
      ...market,
      currentPriceRaw: sellPriceRaw,
      currentPriceFormatted: priceAmount.formatted,
      floorPriceRaw,
      floorPriceFormatted: floorPriceAmount.formatted,
      tradingFeeBps: buyFeeBps,
      buyFeeBps,
      sellFeeBps,
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
    const updatedPosition = buildUpdatedUserMarketPosition(position, {
      netFTokenChangeDelta: -event.params.depositAmount_,
      issuanceTokenDecimals: issuanceToken.decimals,
      reserveTokenDecimals: reserveToken.decimals,
      timestamp: BigInt(event.block.timestamp),
    })
    context.UserMarketPosition.set(updatedPosition)
    context.log.info(
      `[TokensSold] UserPosition updated | netFToken=${updatedPosition.netFTokenChangeFormatted}`
    )

    // Update price candles
    await updatePriceCandles(
      context,
      market.id,
      {
        newPriceRaw: sellPriceRaw,
        newPriceFormatted: priceAmount.formatted,
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

FloorMarket.CollateralDeposited.handler(
  handlerErrorWrapper(async ({ event, context }) => {
    const marketId = event.srcAddress.toLowerCase()
    const timestamp = BigInt(event.block.timestamp)
    const market = await getOrCreateMarket(
      context,
      event.chainId,
      marketId,
      timestamp,
      undefined,
      undefined,
      event.srcAddress as `0x${string}`
    )

    if (!market) {
      context.log.warn(`[CollateralDeposited] Market not found: ${marketId}`)
      return
    }

    const reserveToken = await context.Token.get(market.reserveToken_id)
    if (!reserveToken) {
      context.log.warn(`[CollateralDeposited] Reserve token not found | marketId=${marketId}`)
      return
    }

    const updatedMarket = {
      ...market,
      floorSupplyRaw: event.params.newVirtualSupply_,
      floorSupplyFormatted: formatAmount(event.params.newVirtualSupply_, reserveToken.decimals)
        .formatted,
      lastUpdatedAt: timestamp,
    }
    context.Market.set(updatedMarket)
    context.log.info(
      `[CollateralDeposited] ✅ Updated floorSupply | marketId=${marketId} | newVirtualSupply=${updatedMarket.floorSupplyFormatted}`
    )
  })
)

FloorMarket.CollateralWithdrawn.handler(
  handlerErrorWrapper(async ({ event, context }) => {
    const marketId = event.srcAddress.toLowerCase()
    const timestamp = BigInt(event.block.timestamp)
    const market = await getOrCreateMarket(
      context,
      event.chainId,
      marketId,
      timestamp,
      undefined,
      undefined,
      event.srcAddress as `0x${string}`
    )

    if (!market) {
      context.log.warn(`[CollateralWithdrawn] Market not found: ${marketId}`)
      return
    }

    const reserveToken = await context.Token.get(market.reserveToken_id)
    if (!reserveToken) {
      context.log.warn(`[CollateralWithdrawn] Reserve token not found | marketId=${marketId}`)
      return
    }

    const updatedMarket = {
      ...market,
      floorSupplyRaw: event.params.newVirtualSupply_,
      floorSupplyFormatted: formatAmount(event.params.newVirtualSupply_, reserveToken.decimals)
        .formatted,
      lastUpdatedAt: timestamp,
    }
    context.Market.set(updatedMarket)
    context.log.info(
      `[CollateralWithdrawn] ✅ Updated floorSupply | marketId=${marketId} | newVirtualSupply=${updatedMarket.floorSupplyFormatted}`
    )
  })
)

FloorMarket.FloorIncreased.handler(
  handlerErrorWrapper(async ({ event, context }) => {
    const marketId = event.srcAddress.toLowerCase()
    const timestamp = BigInt(event.block.timestamp)
    const market = await getOrCreateMarket(
      context,
      event.chainId,
      marketId,
      timestamp,
      undefined,
      undefined,
      event.srcAddress as `0x${string}`
    )

    if (!market) {
      context.log.warn(`[FloorIncreased] Market not found: ${marketId}`)
      return
    }

    const reserveToken = await context.Token.get(market.reserveToken_id)
    const issuanceToken = await context.Token.get(market.issuanceToken_id)
    if (!reserveToken || !issuanceToken) {
      context.log.warn(
        `[FloorIncreased] Missing token metadata | reserveToken=${!!reserveToken} | issuanceToken=${!!issuanceToken}`
      )
      return
    }

    const oldFloorPrice = formatAmount(event.params.oldFloorPrice_, reserveToken.decimals)
    const newFloorPrice = formatAmount(event.params.newFloorPrice_, reserveToken.decimals)
    const collateralConsumed = formatAmount(event.params.collateralConsumed_, reserveToken.decimals)
    const supplyIncrease = formatAmount(event.params.supplyIncrease_, issuanceToken.decimals)

    const elevationId = `${event.transaction.hash}-${event.logIndex}`
    context.FloorElevation.set({
      id: elevationId,
      market_id: market.id,
      oldFloorPriceRaw: event.params.oldFloorPrice_,
      oldFloorPriceFormatted: oldFloorPrice.formatted,
      newFloorPriceRaw: event.params.newFloorPrice_,
      newFloorPriceFormatted: newFloorPrice.formatted,
      deployedAmountRaw: event.params.collateralConsumed_,
      deployedAmountFormatted: collateralConsumed.formatted,
      timestamp,
      transactionHash: event.transaction.hash,
    })

    const updatedMarket = {
      ...market,
      floorPriceRaw: event.params.newFloorPrice_,
      floorPriceFormatted: newFloorPrice.formatted,
      totalSupplyRaw: market.totalSupplyRaw + event.params.supplyIncrease_,
      totalSupplyFormatted: formatAmount(
        market.totalSupplyRaw + event.params.supplyIncrease_,
        issuanceToken.decimals
      ).formatted,
      lastElevationTimestamp: timestamp,
      lastUpdatedAt: timestamp,
    }
    context.Market.set(updatedMarket)
    context.log.info(
      `[FloorIncreased] ✅ Floor elevation recorded | marketId=${marketId} | newFloor=${newFloorPrice.formatted} | supplyIncrease=${supplyIncrease.formatted}`
    )
  })
)

FloorMarket.BuyingEnabled.handler(
  handlerErrorWrapper(async ({ event, context }) => {
    const marketId = event.srcAddress.toLowerCase()
    const timestamp = BigInt(event.block.timestamp)
    const market = await getOrCreateMarket(
      context,
      event.chainId,
      marketId,
      timestamp,
      undefined,
      undefined,
      event.srcAddress as `0x${string}`
    )

    if (!market) {
      context.log.warn(`[BuyingEnabled] Market not found: ${marketId}`)
      return
    }

    context.Market.set({
      ...market,
      isBuyOpen: true,
      lastUpdatedAt: timestamp,
    })
    context.log.info(`[BuyingEnabled] Market buy gate opened | marketId=${marketId}`)
  })
)

FloorMarket.BuyingDisabled.handler(
  handlerErrorWrapper(async ({ event, context }) => {
    const marketId = event.srcAddress.toLowerCase()
    const timestamp = BigInt(event.block.timestamp)
    const market = await getOrCreateMarket(
      context,
      event.chainId,
      marketId,
      timestamp,
      undefined,
      undefined,
      event.srcAddress as `0x${string}`
    )

    if (!market) {
      context.log.warn(`[BuyingDisabled] Market not found: ${marketId}`)
      return
    }

    context.Market.set({
      ...market,
      isBuyOpen: false,
      lastUpdatedAt: timestamp,
    })
    context.log.info(`[BuyingDisabled] Market buy gate closed | marketId=${marketId}`)
  })
)

FloorMarket.SellingEnabled.handler(
  handlerErrorWrapper(async ({ event, context }) => {
    const marketId = event.srcAddress.toLowerCase()
    const timestamp = BigInt(event.block.timestamp)
    const market = await getOrCreateMarket(
      context,
      event.chainId,
      marketId,
      timestamp,
      undefined,
      undefined,
      event.srcAddress as `0x${string}`
    )

    if (!market) {
      context.log.warn(`[SellingEnabled] Market not found: ${marketId}`)
      return
    }

    context.Market.set({
      ...market,
      isSellOpen: true,
      lastUpdatedAt: timestamp,
    })
    context.log.info(`[SellingEnabled] Market sell gate opened | marketId=${marketId}`)
  })
)

FloorMarket.SellingDisabled.handler(
  handlerErrorWrapper(async ({ event, context }) => {
    const marketId = event.srcAddress.toLowerCase()
    const timestamp = BigInt(event.block.timestamp)
    const market = await getOrCreateMarket(
      context,
      event.chainId,
      marketId,
      timestamp,
      undefined,
      undefined,
      event.srcAddress as `0x${string}`
    )

    if (!market) {
      context.log.warn(`[SellingDisabled] Market not found: ${marketId}`)
      return
    }

    context.Market.set({
      ...market,
      isSellOpen: false,
      lastUpdatedAt: timestamp,
    })
    context.log.info(`[SellingDisabled] Market sell gate closed | marketId=${marketId}`)
  })
)

FloorMarket.BuyFeeUpdated.handler(
  handlerErrorWrapper(async ({ event, context }) => {
    const marketId = event.srcAddress.toLowerCase()
    const timestamp = BigInt(event.block.timestamp)
    const market = await getOrCreateMarket(
      context,
      event.chainId,
      marketId,
      timestamp,
      undefined,
      undefined,
      event.srcAddress as `0x${string}`
    )

    if (!market) {
      context.log.warn(`[BuyFeeUpdated] Market not found: ${marketId}`)
      return
    }

    const newBuyFee = event.params.newBuyFee_
    context.Market.set({
      ...market,
      tradingFeeBps: newBuyFee,
      buyFeeBps: newBuyFee,
      lastUpdatedAt: timestamp,
    })
    context.log.info(
      `[BuyFeeUpdated] Buy fee updated | marketId=${marketId} | feeBps=${newBuyFee.toString()}`
    )
  })
)

FloorMarket.SellFeeUpdated.handler(
  handlerErrorWrapper(async ({ event, context }) => {
    const marketId = event.srcAddress.toLowerCase()
    const timestamp = BigInt(event.block.timestamp)
    const market = await getOrCreateMarket(
      context,
      event.chainId,
      marketId,
      timestamp,
      undefined,
      undefined,
      event.srcAddress as `0x${string}`
    )

    if (!market) {
      context.log.warn(`[SellFeeUpdated] Market not found: ${marketId}`)
      return
    }

    const newSellFee = event.params.newSellFee_
    context.Market.set({
      ...market,
      sellFeeBps: newSellFee,
      lastUpdatedAt: timestamp,
    })
    context.log.info(
      `[SellFeeUpdated] Sell fee updated | marketId=${marketId} | feeBps=${newSellFee.toString()}`
    )
  })
)
