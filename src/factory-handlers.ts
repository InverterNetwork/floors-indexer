// Factory event handlers for Floor Markets DeFi Platform
// Discovers new BC (bonding curve) and CreditFacility contracts

import { ModuleFactory } from '../generated/src/Handlers.gen'
import {
  extractModuleType,
  getOrCreateToken,
  getOrCreateAccount,
  fetchTokenAddressesFromBC,
} from './helpers'
import type { Market_t, MarketState_t } from '../generated/src/db/Entities.gen'
import type { MarketStatus_t } from '../generated/src/db/Enums.gen'

/**
 * @notice Contract registration handler for ModuleCreated event
 * Fires BEFORE regular handlers to dynamically register contracts
 * This tells Envio to start listening for events from newly created modules
 */
ModuleFactory.ModuleCreated.contractRegister(async ({ event, context }) => {
  const module = event.params.module
  const metadata = event.params.metadata
  const title = metadata[4]
  const moduleType = extractModuleType(title)

  context.log.info(
    `[contractRegister] Module detected | module=${module} | type=${moduleType} | title=${title}`
  )

  // Register BC (bonding curve) modules for TokensBought/TokensSold event listening
  if (moduleType === 'fundingManager') {
    context.log.info(`[contractRegister] ✅ Registering FloorMarket: ${module}`)
    try {
      context.addFloorMarket(module as `0x${string}`)
    } catch (error) {
      context.log.warn(
        `[contractRegister] ⚠️ Failed to register FloorMarket ${module}: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  // Register CreditFacility modules for LoanCreated/LoanRepaid event listening
  if (moduleType === 'creditFacility') {
    context.log.info(`[contractRegister] ✅ Registering CreditFacility: ${module}`)
    try {
      context.addCreditFacility(module as `0x${string}`)
    } catch (error) {
      context.log.warn(
        `[contractRegister] ⚠️ Failed to register CreditFacility ${module}: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }
})

/**
 * @notice Regular event handler for ModuleCreated event
 * Populates ModuleRegistry and creates Market/MarketState entities
 * for BC modules when they are first created
 */
ModuleFactory.ModuleCreated.handler(async ({ event, context }) => {
  const orchestrator = event.params.orchestrator
  const module = event.params.module
  const metadata = event.params.metadata
  const title = metadata[4]
  const moduleType = extractModuleType(title)

  context.log.info(
    `[ModuleCreated] handler | orchestrator=${orchestrator} | module=${module} | type=${moduleType}`
  )

  try {
    // CRITICAL: The registry ID must match the Market ID for consistency
    // For fundingManager modules: use the BC module address as the market ID
    // For other modules: use the orchestrator address
    let registryId = orchestrator.toLowerCase()
    if (moduleType === 'fundingManager') {
      registryId = module.toLowerCase()
    }

    context.log.info(
      `[ModuleCreated] Using registryId=${registryId} | type=${moduleType} | orchestrator=${orchestrator} | module=${module}`
    )

    // Get or create ModuleRegistry for this market
    const existingRegistry = await context.ModuleRegistry.get(registryId)

    // Create or update registry with new module address
    const registry = {
      id: registryId,
      market_id: registryId,
      fundingManager:
        moduleType === 'fundingManager' ? module : existingRegistry?.fundingManager || '',
      authorizer: moduleType === 'authorizer' ? module : existingRegistry?.authorizer || '',
      feeTreasury: moduleType === 'feeTreasury' ? module : existingRegistry?.feeTreasury || '',
      creditFacility:
        moduleType === 'creditFacility' ? module : existingRegistry?.creditFacility || '',
      presale: moduleType === 'presale' ? module : existingRegistry?.presale || '',
      staking: moduleType === 'staking' ? module : existingRegistry?.staking || '',
      createdAt: existingRegistry?.createdAt || BigInt(event.block.timestamp),
      lastUpdatedAt: BigInt(event.block.timestamp),
    }

    context.ModuleRegistry.set(registry)
    context.log.info(`[ModuleCreated] ✅ ModuleRegistry updated | ${registryId}`)

    // When BC (bonding curve) module is created, bootstrap Market and MarketState
    // IMPORTANT: Market ID = BC module address (where events emit from), not orchestrator!
    // This ensures they exist when TokensBought/TokensSold events arrive
    if (moduleType === 'fundingManager' && !existingRegistry?.fundingManager) {
      // Use BC module address as market ID (events come from here)
      const bcMarketId = module.toLowerCase()
      context.log.info(
        `[ModuleCreated] Bootstrapping Market entities | bcModule=${module} | marketId=${bcMarketId}`
      )

      // Try to fetch token addresses from the BC contract via RPC
      const tokenAddresses = await fetchTokenAddressesFromBC(event.chainId, module as `0x${string}`)

      let reserveTokenAddress = ''
      let issuanceTokenAddress = ''

      if (tokenAddresses) {
        reserveTokenAddress = tokenAddresses.reserveToken
        issuanceTokenAddress = tokenAddresses.issuanceToken
        context.log.info(
          `[ModuleCreated] Token addresses fetched | reserve=${reserveTokenAddress} | issuance=${issuanceTokenAddress}`
        )
      } else {
        context.log.warn(`[ModuleCreated] Could not fetch token addresses from RPC for ${module}`)
      }

      // Create or get tokens with addresses if available
      const reserveToken = await getOrCreateToken(context, reserveTokenAddress)
      const issuanceToken = await getOrCreateToken(context, issuanceTokenAddress)

      context.log.info(
        `[ModuleCreated] Tokens created | reserve=${reserveToken.id} | issuance=${issuanceToken.id}`
      )

      // Create creator account
      const creator = await getOrCreateAccount(context, orchestrator)

      // Bootstrap Market entity with BC module address as ID
      const market: Market_t = {
        id: bcMarketId,
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
        createdAt: BigInt(event.block.timestamp),
      }
      context.Market.set(market)
      context.log.info(`[ModuleCreated] ✅ Market created | ${market.id}`)

      // Bootstrap MarketState entity with BC module address as ID
      const marketState: MarketState_t = {
        id: bcMarketId,
        market_id: bcMarketId,
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
      context.log.info(`[ModuleCreated] ✅ MarketState created | ${marketState.id}`)
    }

    context.log.info(`[ModuleCreated] ✅ Handler completed successfully`)
  } catch (error) {
    context.log.error(
      `[ModuleCreated] ❌ Handler failed: ${error instanceof Error ? error.message : String(error)}`
    )
    throw error
  }
})
