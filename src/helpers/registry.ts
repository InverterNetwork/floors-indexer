import { HandlerContext } from 'generated'
import { ModuleRegistry_t } from 'generated/src/db/Entities.gen'

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

  // Create or update registry with new module address
  const registry: ModuleRegistry_t = {
    id: normalizedMarketId,
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

  return registry
}
