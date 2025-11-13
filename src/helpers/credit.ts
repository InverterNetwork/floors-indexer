import type { CreditFacilityContract_t } from 'generated/src/db/Entities.gen'

import CREDIT_FACILITY_ABI from '../../abis/CreditFacility_v1.json'
import { getPublicClient } from '../rpc-client'
import { formatAmount } from './misc'

export type CreditFacilityLoanState = {
  id: bigint
  borrower: string
  lockedIssuanceTokens: bigint
  floorPriceAtBorrow: bigint
  remainingLoanAmount: bigint
  timestamp: bigint
  isActive: boolean
}

export async function fetchLoanState(
  chainId: number,
  facilityAddress: string,
  loanId: bigint
): Promise<CreditFacilityLoanState | null> {
  try {
    const publicClient = getPublicClient(chainId)
    const loan = (await publicClient.readContract({
      address: facilityAddress as `0x${string}`,
      abi: CREDIT_FACILITY_ABI,
      functionName: 'getLoan',
      args: [loanId],
    })) as {
      id: bigint
      borrower: string
      lockedIssuanceTokens: bigint
      floorPriceAtBorrow: bigint
      remainingLoanAmount: bigint
      timestamp: bigint
      isActive: boolean
    }

    if (!loan) {
      return null
    }

    return loan
  } catch (error) {
    return null
  }
}

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
