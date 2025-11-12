// Factory event handlers for Floor Markets DeFi Platform
// Discovers new BC (bonding curve) and CreditFacility contracts

import { ModuleFactory } from '../generated/src/Handlers.gen'
import {
  extractModuleType,
  fetchTokenAddressesFromBC,
  getOrCreateMarket,
  getOrCreateModuleRegistry,
} from './helpers'
import { handlerErrorWrapper } from './helpers/error'

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

  // Register BC (bonding curve) modules for TokensBought/TokensSold event listening
  if (moduleType === 'fundingManager') {
    context.addFloorMarket(module as `0x${string}`)
  }

  // Register CreditFacility modules for LoanCreated/LoanRepaid event listening
  if (moduleType === 'creditFacility') {
    context.addCreditFacility(module as `0x${string}`)
  }
})

/**
 * @notice Regular event handler for ModuleCreated event
 * Populates ModuleRegistry and creates Market entity
 * for BC modules when they are first created
 */
ModuleFactory.ModuleCreated.handler(
  handlerErrorWrapper(async ({ event, context }) => {
    const orchestrator = event.params.orchestrator
    const module = event.params.module
    const metadata = event.params.metadata
    const title = metadata[4]
    const moduleType = extractModuleType(title)

    // Always use orchestrator as the market ID (registry ID)
    const marketId = orchestrator.toLowerCase()

    // Get or create ModuleRegistry for this market using helper
    const registry = await getOrCreateModuleRegistry(
      context,
      marketId,
      moduleType,
      module,
      BigInt(event.block.timestamp)
    )

    // If this is a fundingManager module, create the Market entity
    if (moduleType === 'fundingManager') {
      // Try to fetch token addresses from the BC contract via RPC
      const tokenAddresses = await fetchTokenAddressesFromBC(event.chainId, module as `0x${string}`)

      let reserveTokenId: string | undefined
      let issuanceTokenId: string | undefined

      if (tokenAddresses) {
        reserveTokenId = tokenAddresses.reserveToken
        issuanceTokenId = tokenAddresses.issuanceToken
      }

      // Use the orchestrator as market ID (not BC module address)
      // This ensures Market.id matches ModuleRegistry.id
      const result = await getOrCreateMarket(
        context,
        event.chainId,
        marketId,
        BigInt(event.block.timestamp),
        reserveTokenId,
        issuanceTokenId,
        module as `0x${string}`
      )
    }
  })
)
