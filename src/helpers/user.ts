import { HandlerContext } from 'generated'
import {
  UserMarketPosition_t,
  UserPortfolioSummary_t,
  Account_t,
} from 'generated/src/db/Entities.gen'
import { formatAmount } from './misc'

/**
 * Get or create Account entity
 */
export async function getOrCreateAccount(
  context: HandlerContext,
  address: string
): Promise<Account_t> {
  const normalizedAddress = address.toLowerCase()
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
  const positionId = `${userId.toLowerCase()}-${marketId.toLowerCase()}`
  let position = await context.UserMarketPosition.get(positionId)

  if (!position) {
    const zeroAmount = formatAmount(0n, tokenDecimals)
    position = {
      id: positionId,
      user_id: userId.toLowerCase(),
      market_id: marketId.toLowerCase(),
      fTokenBalanceRaw: zeroAmount.raw,
      fTokenBalanceFormatted: zeroAmount.formatted,
      reserveBalanceRaw: zeroAmount.raw,
      reserveBalanceFormatted: zeroAmount.formatted,
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

/**
 * Update UserPortfolioSummary aggregation
 * Recalculates all portfolio metrics for a user
 */
export async function updateUserPortfolioSummary(
  context: HandlerContext,
  userId: string
): Promise<void> {
  // Calculate totals - placeholder implementation
  // In production, would query user's positions and calculate aggregates
  const summaryId = userId
  const amount = formatAmount(0n, 18)
  const debt = formatAmount(0n, 18)
  const collateral = formatAmount(0n, 18)
  const staked = formatAmount(0n, 18)

  const summary: UserPortfolioSummary_t = {
    id: summaryId,
    user_id: userId,
    totalPortfolioValueRaw: amount.raw,
    totalPortfolioValueFormatted: amount.formatted,
    totalDebtRaw: debt.raw,
    totalDebtFormatted: debt.formatted,
    totalCollateralValueRaw: collateral.raw,
    totalCollateralValueFormatted: collateral.formatted,
    totalStakedValueRaw: staked.raw,
    totalStakedValueFormatted: staked.formatted,
    activeMarkets: 0n,
    activeLoans: 0n,
    activeStakes: 0n,
    lastUpdatedAt: BigInt(Math.floor(Date.now() / 1000)),
  }

  context.UserPortfolioSummary.set(summary)
}
