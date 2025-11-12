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
export function extractModuleType(title: string): string {
  const lower = title.toLowerCase()

  if (lower.includes('creditfacility')) return 'creditFacility'
  if (lower.includes('treasury') || lower.includes('splitter')) return 'feeTreasury'
  if (lower.includes('presale')) return 'presale'
  if (lower.includes('staking')) return 'staking'

  const prefix = title.split('_')[0]
  const prefixMap: Record<string, string> = {
    BC: 'fundingManager',
    AUT: 'authorizer',
  }

  return prefixMap[prefix] || 'unknown'
}
