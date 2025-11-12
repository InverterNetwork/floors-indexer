import { HandlerContext } from 'generated'
import { UserMarketPosition_t, Account_t } from 'generated/src/db/Entities.gen'
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
