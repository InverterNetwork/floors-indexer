// Credit facility event handlers for Floor Markets DeFi Platform

import {
  CreditFacility,
} from '../generated/src/Handlers.gen'
import type {
  LoanStatus_t,
} from '../generated/src/db/Enums.gen'
import {
  getOrCreateAccount,
  getOrCreateToken,
  getOrCreateUserMarketPosition,
  formatAmount,
  updateUserPortfolioSummary,
} from './helpers'

/**
 * @notice Event handler for LoanCreated event
 * Creates Loan, updates facility stats, updates UserMarketPosition
 */
CreditFacility.LoanCreated.handler(async ({ event, context }) => {
  const facilityId = event.srcAddress
  let facility = await context.CreditFacilityContract.get(facilityId)

  if (!facility) {
    // Create facility with placeholder tokens - will be updated from contract
    const collateralToken = await getOrCreateToken(context, '')
    const borrowToken = await getOrCreateToken(context, '')
    
    facility = {
      id: facilityId,
      collateralToken_id: collateralToken.id,
      borrowToken_id: borrowToken.id,
      totalLoans: 0n,
      totalVolumeRaw: 0n,
      totalVolumeFormatted: '0',
      createdAt: BigInt(event.block.timestamp),
    }
  }

  const borrowToken = await context.Token.get(facility.borrowToken_id)
  const collateralToken = await context.Token.get(facility.collateralToken_id)
  if (!borrowToken || !collateralToken) return

  // Update facility stats
  const loanAmount = formatAmount(event.params.loanAmount_, borrowToken.decimals)
  const updatedFacility = {
    ...facility,
    totalLoans: facility.totalLoans + 1n,
    totalVolumeRaw: facility.totalVolumeRaw + event.params.loanAmount_,
    totalVolumeFormatted: formatAmount(
      facility.totalVolumeRaw + event.params.loanAmount_,
      borrowToken.decimals
    ).formatted,
  }
  context.CreditFacilityContract.set(updatedFacility)

  // Get or create borrower account
  const borrower = await getOrCreateAccount(context, event.params.borrower_)

  // Create Loan entity
  // Note: LoanCreated event doesn't have collateralAmount or originationFee
  // These would need to be fetched from the contract or tracked separately
  const loanId = `${event.transaction.hash}-${event.logIndex}`
  const loan = {
    id: loanId,
    borrower_id: borrower.id,
    facility_id: facility.id,
    collateralAmountRaw: 0n, // TODO: Fetch from contract
    collateralAmountFormatted: '0',
    borrowAmountRaw: event.params.loanAmount_,
    borrowAmountFormatted: loanAmount.formatted,
    originationFeeRaw: 0n, // TODO: Fetch from contract
    originationFeeFormatted: '0',
    status: 'ACTIVE' as LoanStatus_t,
    timestamp: BigInt(event.block.timestamp),
    transactionHash: event.transaction.hash,
  }
  context.Loan.set(loan)

  // Update UserMarketPosition
  // TODO: Add logic to determine market from collateral token address
  await updateUserPortfolioSummary(context, borrower.id)
})

/**
 * @notice Event handler for LoanRepaid event
 * Updates Loan status, updates UserMarketPosition
 */
CreditFacility.LoanRepaid.handler(async ({ event, context }) => {
  const facilityId = event.srcAddress
  const facility = await context.CreditFacilityContract.get(facilityId)
  if (!facility) return

  const borrowToken = await context.Token.get(facility.borrowToken_id)
  if (!borrowToken) return

  // Get or create borrower account
  const borrower = await getOrCreateAccount(context, event.params.borrower_)

  // Create Loan entity for repayment record
  const repaymentAmount = formatAmount(event.params.repaymentAmount_, borrowToken.decimals)
  const loanId = `${event.transaction.hash}-${event.logIndex}`
  const loan = {
    id: loanId,
    borrower_id: borrower.id,
    facility_id: facility.id,
    collateralAmountRaw: 0n,
    collateralAmountFormatted: '0',
    borrowAmountRaw: event.params.repaymentAmount_,
    borrowAmountFormatted: repaymentAmount.formatted,
    originationFeeRaw: 0n,
    originationFeeFormatted: '0',
    status: 'REPAID' as LoanStatus_t,
    timestamp: BigInt(event.block.timestamp),
    transactionHash: event.transaction.hash,
  }
  context.Loan.set(loan)

  // Update UserMarketPosition
  await updateUserPortfolioSummary(context, borrower.id)
})

/**
 * @notice Event handler for LoanClosed event
 * Updates Loan status to closed
 */
CreditFacility.LoanClosed.handler(async ({ event, context }) => {
  const borrower = await getOrCreateAccount(context, event.params.borrower_)
  
  // Create Loan entity for closure record
  const loanId = `${event.transaction.hash}-${event.logIndex}`
  const loan = {
    id: loanId,
    borrower_id: borrower.id,
    facility_id: event.srcAddress,
    collateralAmountRaw: 0n,
    collateralAmountFormatted: '0',
    borrowAmountRaw: 0n,
    borrowAmountFormatted: '0',
    originationFeeRaw: 0n,
    originationFeeFormatted: '0',
    status: 'REPAID' as LoanStatus_t, // Using REPAID for closed loans
    timestamp: BigInt(event.block.timestamp),
    transactionHash: event.transaction.hash,
  }
  context.Loan.set(loan)

  await updateUserPortfolioSummary(context, borrower.id)
})

/**
 * @notice Event handler for IssuanceTokensLocked event
 * Updates UserMarketPosition lockedCollateral
 */
CreditFacility.IssuanceTokensLocked.handler(async ({ event, context }) => {
  const user = await getOrCreateAccount(context, event.params.user_)
  
  // TODO: Determine market from facility and update UserMarketPosition
  await updateUserPortfolioSummary(context, user.id)
})

/**
 * @notice Event handler for IssuanceTokensUnlocked event
 * Updates UserMarketPosition lockedCollateral
 */
CreditFacility.IssuanceTokensUnlocked.handler(async ({ event, context }) => {
  const user = await getOrCreateAccount(context, event.params.user_)
  
  // TODO: Determine market from facility and update UserMarketPosition
  await updateUserPortfolioSummary(context, user.id)
})
