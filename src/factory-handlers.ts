// Factory event handlers for Floor Markets DeFi Platform

import {
  ModuleFactory,
} from '../generated/src/Handlers.gen'
import {
  extractModuleType,
  getOrCreateToken,
  getOrCreateAccount,
  formatAmount,
} from './helpers'
import type {
  Market_t,
  MarketState_t,
} from '../generated/src/db/Entities.gen'
import type {
  MarketStatus_t,
} from '../generated/src/db/Enums.gen'

/**
 * @notice Event handler for ModuleCreated event
 * 1. Populates ModuleRegistry with module addresses as they are created
 * 2. Creates Market and MarketState entities when BC (bonding curve) module is detected
 * This ensures trading handlers have the required data to process events
 */
ModuleFactory.ModuleCreated.handler(async ({ event, context }) => {
  // ModuleCreated event has: orchestrator, module, metadata
  // metadata is a tuple: [majorVersion, minorVersion, patchVersion, url, title]
  const orchestrator = event.params.orchestrator
  const module = event.params.module
  const metadata = event.params.metadata
  const marketId = orchestrator // orchestrator is the floor/market address

  // Get or create ModuleRegistry for this market
  const existingRegistry = await context.ModuleRegistry.get(marketId)

  // Extract module type from metadata title (metadata[4] is the title)
  const title = metadata[4]
  const moduleType = extractModuleType(title)

  // Create or update registry with new module address
  const registry = {
    id: marketId,
    market_id: marketId,
    fundingManager: moduleType === 'fundingManager' ? module : (existingRegistry?.fundingManager || ''),
    authorizer: moduleType === 'authorizer' ? module : (existingRegistry?.authorizer || ''),
    feeTreasury: moduleType === 'feeTreasury' ? module : (existingRegistry?.feeTreasury || ''),
    creditFacility: moduleType === 'creditFacility' ? module : (existingRegistry?.creditFacility || ''),
    presale: moduleType === 'presale' ? module : (existingRegistry?.presale || ''),
    staking: moduleType === 'staking' ? module : (existingRegistry?.staking || ''),
    createdAt: existingRegistry?.createdAt || BigInt(event.block.timestamp),
    lastUpdatedAt: BigInt(event.block.timestamp),
  }

  context.ModuleRegistry.set(registry)

  // When the BC (bonding curve) module is created, bootstrap Market and MarketState entities
  // This ensures trading handlers can find these entities when TokensBought/TokensSold events arrive
  if (moduleType === 'fundingManager' && !existingRegistry?.fundingManager) {
    // Create or get tokens (use empty address as placeholders - metadata could have token info)
    const reserveToken = await getOrCreateToken(context, '')
    const issuanceToken = await getOrCreateToken(context, '')
    
    // Create creator account (orchestrator/market creator)
    const creator = await getOrCreateAccount(context, orchestrator)

    // Bootstrap Market entity
    const market: Market_t = {
      id: marketId,
      name: 'Market',  // TODO: Extract from deployment metadata
      symbol: 'MKT',   // TODO: Extract from deployment metadata
      description: '',
      creator_id: creator.id,
      factory_id: '', // Will be populated later if factory events are indexed
      reserveToken_id: reserveToken.id,
      issuanceToken_id: issuanceToken.id,
      initialPriceRaw: 0n,
      initialPriceFormatted: '0',
      tradingFeeBps: 0n,
      maxLTV: 0n,
      maxSupplyRaw: 0n,
      maxSupplyFormatted: '0',
      createdAt: BigInt(event.block.timestamp),
    }
    context.Market.set(market)

    // Bootstrap MarketState entity
    const marketState: MarketState_t = {
      id: marketId,
      market_id: marketId,
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
      lastUpdatedAt: BigInt(event.block.timestamp),
    }
    context.MarketState.set(marketState)
  }
})
