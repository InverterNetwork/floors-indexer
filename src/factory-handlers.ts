// Factory event handlers for Floor Markets DeFi Platform

import {
  ModuleFactory,
} from '../generated/src/Handlers.gen'
import {
  extractModuleType,
} from './helpers'

/**
 * @notice Event handler for ModuleCreated event
 * Populates ModuleRegistry with module addresses as they are created
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
})

// Note: Market creation is tracked via ModuleCreated events from ModuleFactory
// When a floor/market module is created, we populate ModuleRegistry
// Market entities will be created when we detect the BC_* module type
