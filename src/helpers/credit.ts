import type { CreditFacilityContract_t } from 'generated/src/db/Entities.gen'

import { formatAmount } from './misc'

// =============================================================================
// Credit Helper Types & Functions
// =============================================================================
//
// As of contracts PR #126, Loan* events carry the post-state inline
// (`remainingLoanAmount_`, `remainingLockedTokens_`, `lockedIssuanceTokens_`,
// etc.), so we no longer issue an eth_call per loan event. The previous
// `fetchLoanStateEffect` / `parseLoanStateResult` helpers have been removed —
// if re-introducing an on-chain read becomes necessary, prefer adding a
// targeted effect rather than bringing back the old blanket fetcher.

export type FacilityDeltaInput = {
  facility: CreditFacilityContract_t
  borrowTokenDecimals: number
  collateralTokenDecimals: number
  timestamp: bigint
  volumeDeltaRaw?: bigint
  debtDeltaRaw?: bigint
  lockedCollateralDeltaRaw?: bigint
  loanCountDelta?: bigint
}

export function applyFacilityDeltas({
  facility,
  borrowTokenDecimals,
  collateralTokenDecimals,
  timestamp,
  volumeDeltaRaw = 0n,
  debtDeltaRaw = 0n,
  lockedCollateralDeltaRaw = 0n,
  loanCountDelta = 0n,
}: FacilityDeltaInput): CreditFacilityContract_t {
  const totalLoans = facility.totalLoans + loanCountDelta
  const totalVolumeRaw = facility.totalVolumeRaw + volumeDeltaRaw
  const totalDebtRaw = facility.totalDebtRaw + debtDeltaRaw
  const totalLockedCollateralRaw = facility.totalLockedCollateralRaw + lockedCollateralDeltaRaw

  return {
    ...facility,
    totalLoans,
    totalVolumeRaw,
    totalVolumeFormatted: formatAmount(totalVolumeRaw, borrowTokenDecimals).formatted,
    totalDebtRaw,
    totalDebtFormatted: formatAmount(totalDebtRaw, borrowTokenDecimals).formatted,
    totalLockedCollateralRaw,
    totalLockedCollateralFormatted: formatAmount(totalLockedCollateralRaw, collateralTokenDecimals)
      .formatted,
    lastUpdatedAt: timestamp,
  }
}
