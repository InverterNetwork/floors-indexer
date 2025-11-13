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

  context.log.info(
    `[contractRegister] Module detected | title=${title} | moduleType=${moduleType} | address=${module}`
  )

  // Register BC (bonding curve) modules for TokensBought/TokensSold event listening
  if (moduleType === 'floor') {
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

    context.log.debug(
      `[ModuleCreated] Handler entry | moduleType=${moduleType} | address=${module} | block=${event.block.number} | logIndex=${event.logIndex}`
    )

    context.log.info(
      `[ModuleCreated] Regular event handler | title=${title} | moduleType=${moduleType} | address=${module}`
    )

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
    if (moduleType === 'floor') {
      // Try to fetch token addresses from the BC contract via RPC
      context.log.debug(
        `[ModuleCreated] Fetching BC tokens | chainId=${event.chainId} | bcAddress=${module}`
      )
      const tokenAddresses = await fetchTokenAddressesFromBC(event.chainId, module as `0x${string}`)

      let reserveTokenId: string | undefined
      let issuanceTokenId: string | undefined

      if (tokenAddresses) {
        reserveTokenId = tokenAddresses.reserveToken
        issuanceTokenId = tokenAddresses.issuanceToken
        context.log.info(
          `[ModuleCreated] ✅ BC tokens fetched | reserveToken=${reserveTokenId} | issuanceToken=${issuanceTokenId}`
        )
      } else {
        context.log.warn(
          `[ModuleCreated] ⚠️ Unable to fetch BC tokens | bcAddress=${module} | falling back to placeholders`
        )
      }

      // Use the orchestrator as market ID (not BC module address)
      // This ensures Market.id matches ModuleRegistry.id
      const market = await getOrCreateMarket(
        context,
        event.chainId,
        marketId,
        BigInt(event.block.timestamp),
        reserveTokenId,
        issuanceTokenId,
        module as `0x${string}`
      )

      if (!market) {
        context.log.error(
          `[ModuleCreated] ❌ Failed to initialize Market | marketId=${marketId} | bcAddress=${module}`
        )
      } else {
        context.log.info(
          `[ModuleCreated] Market ready | id=${market.id} | reserveToken=${market.reserveToken_id} | issuanceToken=${market.issuanceToken_id}`
        )
      }
    }

    // If this is a creditFacility module, create the CreditFacilityContract entity
    if (moduleType === 'creditFacility') {
      const facilityId = module.toLowerCase()
      context.log.debug(
        `[ModuleCreated] Preparing CreditFacility | facilityId=${facilityId} | marketId=${marketId}`
      )

      // Get the Market entity to get token addresses
      let market = await context.Market.get(marketId)

      if (!market && marketId !== facilityId) {
        context.log.debug(
          `[ModuleCreated] Market lookup fallback | trying facilityId=${facilityId}`
        )
        market = await context.Market.get(facilityId)
      }

      if (market) {
        const facility = {
          id: facilityId,
          collateralToken_id: market.issuanceToken_id,
          borrowToken_id: market.reserveToken_id,
          totalLoans: 0n,
          totalVolumeRaw: 0n,
          totalVolumeFormatted: '0',
          createdAt: BigInt(event.block.timestamp),
        }
        context.CreditFacilityContract.set(facility)
        context.log.info(
          `[ModuleCreated] CreditFacility created | id=${facilityId} | collateralToken=${market.issuanceToken_id} | borrowToken=${market.reserveToken_id}`
        )
      } else {
        context.log.warn(
          `[ModuleCreated] Market not found for creditFacility | marketId=${marketId} | facilityId=${facilityId}`
        )
      }
    }
  })
)
