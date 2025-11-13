import type { HandlerContext } from 'generated'
import type { Account_t, UserMarketPosition_t } from 'generated/src/db/Entities.gen'

import { formatAmount, normalizeAddress } from './misc'

/**
 * Get or create Account entity
 */
export async function getOrCreateAccount(
  context: HandlerContext,
  address: string
): Promise<Account_t> {
  const normalizedAddress = normalizeAddress(address)
  let account = await context.Account.get(normalizedAddress)

  if (!account) {
    account = { id: normalizedAddress }
    context.Account.set(account)
  }

  return account
}

/**
 * Get or create UserMarketPosition
 */
export async function getOrCreateUserMarketPosition(
  context: HandlerContext,
  userId: string,
  marketId: string,
  tokenDecimals: number = 18
): Promise<UserMarketPosition_t> {
  const normalizedUserId = normalizeAddress(userId)
  const normalizedMarketId = normalizeAddress(marketId)
  const positionId = `${normalizedUserId}-${normalizedMarketId}`
  let position = await context.UserMarketPosition.get(positionId)

  if (!position) {
    const zeroAmount = formatAmount(0n, tokenDecimals)
    position = {
      id: positionId,
      user_id: normalizedUserId,
      market_id: normalizedMarketId,
      netFTokenChangeRaw: zeroAmount.raw,
      netFTokenChangeFormatted: zeroAmount.formatted,
      totalDebtRaw: zeroAmount.raw,
      totalDebtFormatted: zeroAmount.formatted,
      lockedCollateralRaw: zeroAmount.raw,
      lockedCollateralFormatted: zeroAmount.formatted,
      stakedAmountRaw: zeroAmount.raw,
      stakedAmountFormatted: zeroAmount.formatted,
      claimableRewardsRaw: zeroAmount.raw,
      claimableRewardsFormatted: zeroAmount.formatted,
      presaleDepositRaw: zeroAmount.raw,
      presaleDepositFormatted: zeroAmount.formatted,
      presaleLeverage: 0n,
      lastUpdatedAt: BigInt(Math.floor(Date.now() / 1000)),
    }
    context.UserMarketPosition.set(position)
  }

  return position
}

export type UserMarketPositionDeltaInput = {
  netFTokenChangeDelta?: bigint
  totalDebtDelta?: bigint
  lockedCollateralDelta?: bigint
  stakedAmountDelta?: bigint
  claimableRewardsDelta?: bigint
  presaleDepositDelta?: bigint
  issuanceTokenDecimals: number
  reserveTokenDecimals: number
  timestamp: bigint
}

/**
 * Build an updated UserMarketPosition with normalized formatting for derived counters.
 * The caller is responsible for persisting the returned entity.
 */
export function buildUpdatedUserMarketPosition(
  position: UserMarketPosition_t,
  updates: UserMarketPositionDeltaInput
): UserMarketPosition_t {
  let netFTokenChangeRaw = position.netFTokenChangeRaw
  let netFTokenChangeFormatted = position.netFTokenChangeFormatted
  if (updates.netFTokenChangeDelta && updates.netFTokenChangeDelta !== 0n) {
    netFTokenChangeRaw = position.netFTokenChangeRaw + updates.netFTokenChangeDelta
    netFTokenChangeFormatted = formatAmount(
      netFTokenChangeRaw,
      updates.issuanceTokenDecimals
    ).formatted
  }

  let totalDebtRaw = position.totalDebtRaw
  let totalDebtFormatted = position.totalDebtFormatted
  if (updates.totalDebtDelta && updates.totalDebtDelta !== 0n) {
    totalDebtRaw = position.totalDebtRaw + updates.totalDebtDelta
    totalDebtFormatted = formatAmount(totalDebtRaw, updates.reserveTokenDecimals).formatted
  }

  let lockedCollateralRaw = position.lockedCollateralRaw
  let lockedCollateralFormatted = position.lockedCollateralFormatted
  if (updates.lockedCollateralDelta && updates.lockedCollateralDelta !== 0n) {
    lockedCollateralRaw = position.lockedCollateralRaw + updates.lockedCollateralDelta
    lockedCollateralFormatted = formatAmount(
      lockedCollateralRaw,
      updates.issuanceTokenDecimals
    ).formatted
  }

  let stakedAmountRaw = position.stakedAmountRaw
  let stakedAmountFormatted = position.stakedAmountFormatted
  if (updates.stakedAmountDelta && updates.stakedAmountDelta !== 0n) {
    stakedAmountRaw = position.stakedAmountRaw + updates.stakedAmountDelta
    stakedAmountFormatted = formatAmount(stakedAmountRaw, updates.issuanceTokenDecimals).formatted
  }

  let claimableRewardsRaw = position.claimableRewardsRaw
  let claimableRewardsFormatted = position.claimableRewardsFormatted
  if (updates.claimableRewardsDelta && updates.claimableRewardsDelta !== 0n) {
    claimableRewardsRaw = position.claimableRewardsRaw + updates.claimableRewardsDelta
    claimableRewardsFormatted = formatAmount(
      claimableRewardsRaw,
      updates.reserveTokenDecimals
    ).formatted
  }

  let presaleDepositRaw = position.presaleDepositRaw
  let presaleDepositFormatted = position.presaleDepositFormatted
  if (updates.presaleDepositDelta && updates.presaleDepositDelta !== 0n) {
    presaleDepositRaw = position.presaleDepositRaw + updates.presaleDepositDelta
    presaleDepositFormatted = formatAmount(
      presaleDepositRaw,
      updates.reserveTokenDecimals
    ).formatted
  }

  return {
    ...position,
    netFTokenChangeRaw,
    netFTokenChangeFormatted,
    totalDebtRaw,
    totalDebtFormatted,
    lockedCollateralRaw,
    lockedCollateralFormatted,
    stakedAmountRaw,
    stakedAmountFormatted,
    claimableRewardsRaw,
    claimableRewardsFormatted,
    presaleDepositRaw,
    presaleDepositFormatted,
    lastUpdatedAt: updates.timestamp,
  }
}
