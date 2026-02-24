import { createEffect, S } from 'envio'
import type { CreditFacilityContract_t } from 'generated/src/db/Entities.gen'
import type { Abi } from 'viem'

import CREDIT_FACILITY_ABI from '../../abis/CreditFacility_v1.json'
import { getPublicClient } from '../rpc-client'
import { wrapEffect } from './effects'
import { formatAmount } from './misc'

// =============================================================================
// ABI Type Casts
// =============================================================================

const CREDIT_FACILITY_ABI_TYPED = CREDIT_FACILITY_ABI as Abi

// =============================================================================
// Loan State Effect
// =============================================================================

export const fetchLoanStateEffect = wrapEffect(
  createEffect(
    {
      name: 'fetchLoanState',
      input: { chainId: S.number, facilityAddress: S.string, loanId: S.string },
      output: S.nullable(
        S.schema({
          id: S.string,
          borrower: S.string,
          lockedIssuanceTokens: S.string,
          remainingLoanAmount: S.string,
          timestamp: S.string,
          isActive: S.boolean,
        })
      ),
      rateLimit: { calls: 50, per: 'second' },
      cache: false, // Loan state changes
    },
    async ({ input, context }) => {
      try {
        const client = getPublicClient(input.chainId)
        const target = input.facilityAddress as `0x${string}`
        const loanIdBigInt = BigInt(input.loanId)

        const loan = (await client.readContract({
          address: target,
          abi: CREDIT_FACILITY_ABI_TYPED,
          functionName: 'getLoan',
          args: [loanIdBigInt],
        })) as {
          id: bigint
          borrower: string
          lockedIssuanceTokens: bigint
          remainingLoanAmount: bigint
          timestamp: bigint
          isActive: boolean
        }

        if (!loan) {
          context.cache = false
          return undefined
        }

        return {
          id: loan.id.toString(),
          borrower: loan.borrower.toLowerCase(),
          lockedIssuanceTokens: loan.lockedIssuanceTokens.toString(),
          remainingLoanAmount: loan.remainingLoanAmount.toString(),
          timestamp: loan.timestamp.toString(),
          isActive: loan.isActive,
        }
      } catch {
        context.cache = false
        return undefined
      }
    }
  )
)

// =============================================================================
// Credit Helper Types & Functions
// =============================================================================

/**
 * Helper type for loan state (parsed from effect output)
 */
export type CreditFacilityLoanState = {
  id: bigint
  borrower: string
  lockedIssuanceTokens: bigint
  remainingLoanAmount: bigint
  timestamp: bigint
  isActive: boolean
}

/**
 * Parse the string-based effect output to bigint values
 */
export function parseLoanStateResult(
  effectResult:
    | {
        id: string
        borrower: string
        lockedIssuanceTokens: string
        remainingLoanAmount: string
        timestamp: string
        isActive: boolean
      }
    | null
    | undefined
): CreditFacilityLoanState | null {
  if (!effectResult) return null

  return {
    id: BigInt(effectResult.id),
    borrower: effectResult.borrower,
    lockedIssuanceTokens: BigInt(effectResult.lockedIssuanceTokens),
    remainingLoanAmount: BigInt(effectResult.remainingLoanAmount),
    timestamp: BigInt(effectResult.timestamp),
    isActive: effectResult.isActive,
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
