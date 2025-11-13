/**
 * Format a raw BigInt amount with decimals into Amount type
 * Example: formatAmount(9900000n, 18) -> { raw: 9900000n, formatted: "9.9" }
 */
export function formatAmount(raw: bigint, decimals: number): { raw: bigint; formatted: string } {
  const divisor = BigInt(10 ** decimals)
  const whole = raw / divisor
  const fractional = raw % divisor
  const fractionalStr = fractional.toString().padStart(decimals, '0')

  // Remove trailing zeros from fractional part
  const trimmedFractional = fractionalStr.replace(/0+$/, '')
  const formatted = trimmedFractional ? `${whole}.${trimmedFractional}` : whole.toString()

  return { raw, formatted }
}

/**
 * Extract module type from metadata title
 * Maps module titles to ModuleRegistry field names
 */
export function extractModuleType(
  title: string
): 'floor' | 'authorizer' | 'unknown' | 'creditFacility' | 'feeTreasury' | 'presale' | 'staking' {
  const lower = title.toLowerCase()

  if (lower.includes('creditfacility')) return 'creditFacility'
  if (lower.includes('treasury') || lower.includes('splitter')) return 'feeTreasury'
  if (lower.includes('presale')) return 'presale'
  if (lower.includes('staking')) return 'staking'

  const prefix = title.split('_')[0]
  const prefixMap: Record<'Floor' | 'AUT', 'floor' | 'authorizer'> = {
    Floor: 'floor',
    AUT: 'authorizer',
  }

  return prefixMap[prefix as keyof typeof prefixMap] || 'unknown'
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

/**
 * Resolve the canonical market ID for a module.
 * Prefer the orchestrator (market) address unless it is unset/zero.
 */
export function resolveMarketId(orchestrator: string, module: string): string {
  const normalizedModule = module.toLowerCase()
  if (!orchestrator) {
    return normalizedModule
  }

  const normalizedOrchestrator = orchestrator.toLowerCase()
  if (normalizedOrchestrator === ZERO_ADDRESS) {
    return normalizedModule
  }

  return normalizedOrchestrator
}
