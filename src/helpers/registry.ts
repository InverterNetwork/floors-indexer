import type { HandlerContext } from 'generated'
import type { ModuleRegistry_t } from 'generated/src/db/Entities.gen'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

/**
 * Get or create ModuleRegistry entity for a market
 * Handles updating existing registries with new module addresses
 *
 * @param context Handler context
 * @param marketId The market/orchestrator ID (primary identifier)
 * @param moduleType The type of module being registered
 * @param module The module address being registered
 * @param timestamp Block timestamp for creation/update
 * @returns The created or updated ModuleRegistry entity
 */
export async function getOrCreateModuleRegistry(
  context: HandlerContext,
  marketId: string,
  moduleType: string,
  module: string,
  timestamp: bigint
): Promise<ModuleRegistry_t> {
  const normalizedMarketId = marketId.toLowerCase()
  const normalizedModule = module.toLowerCase()

  // Get existing registry if it exists
  const existingRegistry = await context.ModuleRegistry.get(normalizedMarketId)

  if (existingRegistry) {
    context.log.debug(
      `[getOrCreateModuleRegistry] Updating registry | marketId=${normalizedMarketId} | moduleType=${moduleType} | module=${normalizedModule}`
    )
  } else {
    context.log.info(
      `[getOrCreateModuleRegistry] Creating registry | marketId=${normalizedMarketId} | moduleType=${moduleType} | module=${normalizedModule}`
    )
  }

  // Create or update registry with new module address
  const fallbackFloor =
    existingRegistry?.floor ||
    (moduleType === 'floor' ? normalizedModule : normalizedMarketId || ZERO_ADDRESS)

  const registry: ModuleRegistry_t = {
    id: normalizedMarketId,
    floor: moduleType === 'floor' ? normalizedModule : fallbackFloor,
    authorizer: moduleType === 'authorizer' ? normalizedModule : existingRegistry?.authorizer || '',
    feeTreasury:
      moduleType === 'feeTreasury' ? normalizedModule : existingRegistry?.feeTreasury || '',
    creditFacility:
      moduleType === 'creditFacility' ? normalizedModule : existingRegistry?.creditFacility || '',
    presale: moduleType === 'presale' ? normalizedModule : existingRegistry?.presale || '',
    staking: moduleType === 'staking' ? normalizedModule : existingRegistry?.staking || '',
    createdAt: existingRegistry?.createdAt || timestamp,
    lastUpdatedAt: timestamp,
  }

  context.ModuleRegistry.set(registry)

  const moduleSnapshot = {
    floor: registry.floor || 'none',
    authorizer: registry.authorizer || 'none',
    feeTreasury: registry.feeTreasury || 'none',
    creditFacility: registry.creditFacility || 'none',
    presale: registry.presale || 'none',
    staking: registry.staking || 'none',
  }

  context.log.debug(
    `[getOrCreateModuleRegistry] ✅ Registry ${existingRegistry ? 'updated' : 'created'} | marketId=${normalizedMarketId} | modules=${JSON.stringify(
      moduleSnapshot
    )}`
  )

  return registry
}
