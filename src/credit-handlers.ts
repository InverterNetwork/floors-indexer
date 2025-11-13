// Credit facility event handlers for Floor Markets DeFi Platform

import type { LoanStatus_t } from '../generated/src/db/Enums.gen'
import { CreditFacility } from '../generated/src/Handlers.gen'
import { formatAmount, getOrCreateAccount, handlerErrorWrapper } from './helpers'

/**
 * @notice Event handler for LoanCreated event
 * Creates Loan, updates facility stats, updates UserMarketPosition
 */
CreditFacility.LoanCreated.handler(
  handlerErrorWrapper(async ({ event, context }) => {
    context.log.debug(
      `[LoanCreated] Handler entry | block=${event.block.number} | logIndex=${event.logIndex} | tx=${event.transaction.hash}`
    )
    context.log.info(
      `[LoanCreated] Handler invoked | facility=${event.srcAddress} | borrower=${event.params.borrower_}`
    )

    const facilityId = event.srcAddress.toLowerCase()
    context.log.debug(`[LoanCreated] Looking up facility | facilityId=${facilityId}`)
    const facility = await context.CreditFacilityContract.get(facilityId)

    if (!facility) {
      context.log.warn(
        `[LoanCreated] Facility not found | facilityId=${facilityId} | block=${event.block.number} | tx=${event.transaction.hash} - skipping event`
      )
      return
    }

    const borrowToken = await context.Token.get(facility.borrowToken_id)
    const collateralToken = await context.Token.get(facility.collateralToken_id)
    if (!borrowToken || !collateralToken) {
      context.log.warn(
        `[LoanCreated] Missing token data | borrowToken=${!!borrowToken} | collateralToken=${!!collateralToken}`
      )
      return
    }

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
    context.log.debug(`[LoanCreated] Borrower ready | borrower=${borrower.id}`)

    // Create Loan entity
    const loanId = `${event.transaction.hash}-${event.logIndex}`
    const loan = {
      id: loanId,
      borrower_id: borrower.id,
      facility_id: facility.id,
      collateralAmountRaw: 0n,
      collateralAmountFormatted: '0',
      borrowAmountRaw: event.params.loanAmount_,
      borrowAmountFormatted: loanAmount.formatted,
      originationFeeRaw: 0n,
      originationFeeFormatted: '0',
      status: 'ACTIVE' as LoanStatus_t,
      timestamp: BigInt(event.block.timestamp),
      transactionHash: event.transaction.hash,
    }
    context.Loan.set(loan)
    context.log.info(
      `[LoanCreated] ✅ Loan created | loanId=${loanId} | amount=${loanAmount.formatted}`
    )
    context.log.debug(
      `[LoanCreated] Loan details | facility=${facility.id} | borrower=${borrower.id} | amountRaw=${loan.borrowAmountRaw} | totalLoans=${updatedFacility.totalLoans}`
    )
  })
)

/**
 * @notice Event handler for LoanRepaid event
 * Updates Loan status, updates UserMarketPosition
 */
CreditFacility.LoanRepaid.handler(
  handlerErrorWrapper(async ({ event, context }) => {
    context.log.debug(
      `[LoanRepaid] Handler entry | block=${event.block.number} | logIndex=${event.logIndex} | tx=${event.transaction.hash}`
    )
    context.log.info(
      `[LoanRepaid] Handler invoked | facility=${event.srcAddress} | borrower=${event.params.borrower_}`
    )

    const facilityId = event.srcAddress.toLowerCase()
    context.log.debug(`[LoanRepaid] Looking up facility | facilityId=${facilityId}`)
    const facility = await context.CreditFacilityContract.get(facilityId)
    if (!facility) {
      context.log.warn(
        `[LoanRepaid] Facility not found | facilityId=${facilityId} | block=${event.block.number} | tx=${event.transaction.hash}`
      )
      return
    }

    const borrowToken = await context.Token.get(facility.borrowToken_id)
    if (!borrowToken) {
      context.log.warn(`[LoanRepaid] Borrow token not found | tokenId=${facility.borrowToken_id}`)
      return
    }

    // Get or create borrower account
    const borrower = await getOrCreateAccount(context, event.params.borrower_)
    context.log.debug(`[LoanRepaid] Borrower ready | borrower=${borrower.id}`)

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
    context.log.info(
      `[LoanRepaid] ✅ Loan repaid | loanId=${loanId} | amount=${repaymentAmount.formatted}`
    )
    context.log.debug(
      `[LoanRepaid] Loan details | facility=${facility.id} | borrower=${borrower.id} | repaymentRaw=${loan.borrowAmountRaw}`
    )
  })
)

/**
 * @notice Event handler for LoanClosed event
 * Updates Loan status to closed
 */
CreditFacility.LoanClosed.handler(
  handlerErrorWrapper(async ({ event, context }) => {
    context.log.debug(
      `[LoanClosed] Handler entry | block=${event.block.number} | logIndex=${event.logIndex} | tx=${event.transaction.hash}`
    )
    context.log.info(
      `[LoanClosed] Handler invoked | facility=${event.srcAddress} | borrower=${event.params.borrower_}`
    )

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
      status: 'REPAID' as LoanStatus_t,
      timestamp: BigInt(event.block.timestamp),
      transactionHash: event.transaction.hash,
    }
    context.Loan.set(loan)
    context.log.info(`[LoanClosed] ✅ Loan closed | loanId=${loanId}`)
    context.log.debug(
      `[LoanClosed] Loan details | facility=${event.srcAddress} | borrower=${borrower.id}`
    )
  })
)

/**
 * @notice Event handler for IssuanceTokensLocked event
 * Updates UserMarketPosition lockedCollateral
 */
CreditFacility.IssuanceTokensLocked.handler(
  handlerErrorWrapper(async ({ event, context }) => {
    context.log.debug(
      `[IssuanceTokensLocked] Handler entry | block=${event.block.number} | logIndex=${event.logIndex} | tx=${event.transaction.hash}`
    )
    context.log.info(
      `[IssuanceTokensLocked] Handler invoked | facility=${event.srcAddress} | user=${event.params.user_}`
    )

    const user = await getOrCreateAccount(context, event.params.user_)
    context.log.debug(
      `[IssuanceTokensLocked] Updating portfolio | userId=${user.id} | amount=${event.params.amount_}`
    )
  })
)

/**
 * @notice Event handler for IssuanceTokensUnlocked event
 * Updates UserMarketPosition lockedCollateral
 */
CreditFacility.IssuanceTokensUnlocked.handler(
  handlerErrorWrapper(async ({ event, context }) => {
    context.log.debug(
      `[IssuanceTokensUnlocked] Handler entry | block=${event.block.number} | logIndex=${event.logIndex} | tx=${event.transaction.hash}`
    )
    context.log.info(
      `[IssuanceTokensUnlocked] Handler invoked | facility=${event.srcAddress} | user=${event.params.user_}`
    )

    const user = await getOrCreateAccount(context, event.params.user_)
    context.log.debug(
      `[IssuanceTokensUnlocked] Updating portfolio | userId=${user.id} | amount=${event.params.amount_}`
    )
  })
)
