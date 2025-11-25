import type { HandlerContext } from 'generated'
import type { PreSaleContract_t } from 'generated/src/db/Entities.gen'

import { Presale } from '../generated/src/Handlers.gen'
import {
  buildUpdatedUserMarketPosition,
  formatAmount,
  getOrCreateAccount,
  getOrCreateUserMarketPosition,
  handlerErrorWrapper,
  normalizeAddress,
  recordPresaleConfigEvent,
  resolvePresaleContext,
} from './helpers'

type ParticipationArgs = {
  userAddress: string
  depositRaw: bigint
  mintedRaw: bigint
  leverage: bigint
  positionId?: bigint
}

const PRESALE_LOG_PREFIX = '[Presale]'

async function loadPresaleContextOrWarn(
  context: HandlerContext,
  event: { srcAddress: string; chainId: number; block: { timestamp: number } },
  handlerName: string
) {
  const timestamp = BigInt(event.block.timestamp)
  const presaleContext = await resolvePresaleContext(context, {
    presaleAddress: event.srcAddress,
    chainId: event.chainId,
    timestamp,
  })

  if (!presaleContext) {
    context.log.error(
      `${PRESALE_LOG_PREFIX} ${handlerName} aborted - presale not registered | presale=${event.srcAddress} | action=reindex`
    )
    return null
  }

  return { ...presaleContext, timestamp }
}

async function handleParticipation(
  context: HandlerContext,
  event: {
    transaction: { hash: string }
    logIndex: number
    srcAddress: string
    chainId: number
    block: { timestamp: number }
  },
  args: ParticipationArgs,
  handlerName: string
) {
  const presaleContext = await loadPresaleContextOrWarn(context, event, handlerName)
  if (!presaleContext) return

  const { presale, marketId, saleToken, purchaseToken, timestamp } = presaleContext

  const account = await getOrCreateAccount(context, args.userAddress)

  const depositDecimals = purchaseToken?.decimals ?? 18
  const mintedDecimals = saleToken?.decimals ?? 18
  const depositAmount = formatAmount(args.depositRaw, depositDecimals)
  const mintedAmount = formatAmount(args.mintedRaw, mintedDecimals)
  const participationId = `${event.transaction.hash}-${event.logIndex}`

  context.PresaleParticipation.set({
    id: participationId,
    user_id: account.id,
    presale_id: presale.id,
    positionId: args.positionId,
    depositAmountRaw: args.depositRaw,
    depositAmountFormatted: depositAmount.formatted,
    mintedAmountRaw: args.mintedRaw,
    mintedAmountFormatted: mintedAmount.formatted,
    loopCount: args.leverage,
    leverage: args.leverage,
    timestamp,
    transactionHash: event.transaction.hash,
  })

  const nextTotalRaisedRaw = presale.totalRaisedRaw + args.depositRaw
  const nextTotalRaisedFormatted = formatAmount(nextTotalRaisedRaw, depositDecimals).formatted

  const updatedPresale: PreSaleContract_t = {
    ...presale,
    totalRaisedRaw: nextTotalRaisedRaw,
    totalRaisedFormatted: nextTotalRaisedFormatted,
    totalParticipants: presale.totalParticipants + 1n,
    maxLeverage: args.leverage > presale.maxLeverage ? args.leverage : presale.maxLeverage,
    lastUpdatedAt: timestamp,
  }
  context.PreSaleContract.set(updatedPresale)

  const userPosition = await getOrCreateUserMarketPosition(
    context,
    account.id,
    marketId,
    saleToken?.decimals
  )

  const updatedPosition = buildUpdatedUserMarketPosition(userPosition, {
    presaleDepositDelta: args.depositRaw,
    presaleLeverage: args.leverage,
    issuanceTokenDecimals: saleToken?.decimals ?? 18,
    reserveTokenDecimals: purchaseToken?.decimals ?? 18,
    timestamp,
  })
  context.UserMarketPosition.set(updatedPosition)

  context.log.info(
    `${PRESALE_LOG_PREFIX} ${handlerName} recorded | presale=${presale.id} | user=${account.id} | deposit=${depositAmount.formatted}`
  )
}

function applyPresalePatch(
  presale: PreSaleContract_t,
  patch: Partial<PreSaleContract_t>,
  timestamp: bigint
): PreSaleContract_t {
  return {
    ...presale,
    ...patch,
    lastUpdatedAt: timestamp,
  }
}

const stringifyBigints = (values: readonly bigint[]) => values.map((value) => value.toString())
const stringifyNestedBigints = (values: readonly bigint[][]) =>
  values.map((row) => row.map((value) => value.toString()))

Presale.PresaleBought.handler(
  handlerErrorWrapper(async ({ event, context }) => {
    await handleParticipation(
      context,
      event,
      {
        userAddress: event.params.buyer_,
        depositRaw: event.params.deposit_,
        mintedRaw: event.params.totalMinted_,
        leverage: event.params.loopCount_,
      },
      'PresaleBought'
    )
  })
)

Presale.PositionCreated.handler(
  handlerErrorWrapper(async ({ event, context }) => {
    await handleParticipation(
      context,
      event,
      {
        userAddress: event.params.owner_,
        depositRaw: event.params.totalDeposit_,
        mintedRaw: event.params.totalMinted_,
        leverage: event.params.loops_,
        positionId: event.params.positionId_,
      },
      'PositionCreated'
    )
  })
)

Presale.DirectTokensClaimed.handler(
  handlerErrorWrapper(async ({ event, context }) => {
    const presaleContext = await loadPresaleContextOrWarn(context, event, 'DirectTokensClaimed')
    if (!presaleContext) return

    const { presale, saleToken, timestamp } = presaleContext
    const saleDecimals = saleToken?.decimals ?? 18
    const amount = formatAmount(event.params.amount_, saleDecimals)

    context.PresaleClaim.set({
      id: `${event.transaction.hash}-${event.logIndex}`,
      presale_id: normalizeAddress(presale.id),
      positionId: event.params.positionId_,
      claimType: 'DIRECT',
      amountRaw: event.params.amount_,
      amountFormatted: amount.formatted,
      trancheIndex: undefined,
      loanId: undefined,
      timestamp,
      transactionHash: event.transaction.hash,
    })

    context.log.info(
      `${PRESALE_LOG_PREFIX} DirectTokensClaimed | presale=${presale.id} | position=${event.params.positionId_.toString()} | amount=${amount.formatted}`
    )
  })
)

Presale.TrancheClaimed.handler(
  handlerErrorWrapper(async ({ event, context }) => {
    const presaleContext = await loadPresaleContextOrWarn(context, event, 'TrancheClaimed')
    if (!presaleContext) return

    const { presale, saleToken, timestamp } = presaleContext
    const saleDecimals = saleToken?.decimals ?? 18
    const zeroAmount = formatAmount(0n, saleDecimals)

    context.PresaleClaim.set({
      id: `${event.transaction.hash}-${event.logIndex}`,
      presale_id: normalizeAddress(presale.id),
      positionId: event.params.positionId_,
      claimType: 'TRANCHE',
      amountRaw: 0n,
      amountFormatted: zeroAmount.formatted,
      trancheIndex: event.params.trancheIndex_,
      loanId: event.params.loanId_,
      timestamp,
      transactionHash: event.transaction.hash,
    })

    context.log.info(
      `${PRESALE_LOG_PREFIX} TrancheClaimed | presale=${presale.id} | position=${event.params.positionId_.toString()} | tranche=${event.params.trancheIndex_.toString()}`
    )
  })
)

Presale.CapsUpdated.handler(
  handlerErrorWrapper(async ({ event, context }) => {
    const presaleContext = await loadPresaleContextOrWarn(context, event, 'CapsUpdated')
    if (!presaleContext) return

    const { presale, purchaseToken, timestamp } = presaleContext
    const purchaseDecimals = purchaseToken?.decimals ?? 18
    const nextGlobal = formatAmount(event.params.globalCap_, purchaseDecimals)
    const nextPerAddress = formatAmount(event.params.perAddressCap_, purchaseDecimals)

    context.PreSaleContract.set(
      applyPresalePatch(
        presale,
        {
          globalDepositCapRaw: event.params.globalCap_,
          globalDepositCapFormatted: nextGlobal.formatted,
          perAddressDepositCapRaw: event.params.perAddressCap_,
          perAddressDepositCapFormatted: nextPerAddress.formatted,
        },
        timestamp
      )
    )

    recordPresaleConfigEvent({
      context,
      presaleId: presale.id,
      eventType: 'CAPS_UPDATED',
      payload: {
        globalCap: event.params.globalCap_.toString(),
        perAddressCap: event.params.perAddressCap_.toString(),
      },
      timestamp,
      transactionHash: event.transaction.hash,
      logIndex: event.logIndex,
    })
  })
)

Presale.BaseCommissionUpdated.handler(
  handlerErrorWrapper(async ({ event, context }) => {
    const presaleContext = await loadPresaleContextOrWarn(context, event, 'BaseCommissionUpdated')
    if (!presaleContext) return

    const { presale, timestamp } = presaleContext
    context.PreSaleContract.set(
      applyPresalePatch(
        presale,
        { commissionBpsJson: JSON.stringify(stringifyBigints(event.params.baseCommissionBps_)) },
        timestamp
      )
    )

    recordPresaleConfigEvent({
      context,
      presaleId: presale.id,
      eventType: 'BASE_COMMISSION_UPDATED',
      payload: { baseCommissionBps: stringifyBigints(event.params.baseCommissionBps_) },
      timestamp,
      transactionHash: event.transaction.hash,
      logIndex: event.logIndex,
    })
  })
)

Presale.PriceBreakpointsSet.handler(
  handlerErrorWrapper(async ({ event, context }) => {
    const presaleContext = await loadPresaleContextOrWarn(context, event, 'PriceBreakpointsSet')
    if (!presaleContext) return
    const { presale, timestamp } = presaleContext

    context.PreSaleContract.set(
      applyPresalePatch(
        presale,
        {
          priceBreakpointsJson: JSON.stringify(
            stringifyNestedBigints(event.params.priceBreakpoints_)
          ),
        },
        timestamp
      )
    )

    recordPresaleConfigEvent({
      context,
      presaleId: presale.id,
      eventType: 'PRICE_BREAKPOINTS_SET',
      payload: { priceBreakpoints: stringifyNestedBigints(event.params.priceBreakpoints_) },
      timestamp,
      transactionHash: event.transaction.hash,
      logIndex: event.logIndex,
    })
  })
)

Presale.PresaleStateSet.handler(
  handlerErrorWrapper(async ({ event, context }) => {
    const presaleContext = await loadPresaleContextOrWarn(context, event, 'PresaleStateSet')
    if (!presaleContext) return
    const { presale, timestamp } = presaleContext

    context.PreSaleContract.set(
      applyPresalePatch(presale, { currentState: Number(event.params.state_) }, timestamp)
    )

    recordPresaleConfigEvent({
      context,
      presaleId: presale.id,
      eventType: 'PRESALE_STATE_SET',
      payload: { state: event.params.state_.toString() },
      timestamp,
      transactionHash: event.transaction.hash,
      logIndex: event.logIndex,
    })
  })
)

Presale.EndTimestampSet.handler(
  handlerErrorWrapper(async ({ event, context }) => {
    const presaleContext = await loadPresaleContextOrWarn(context, event, 'EndTimestampSet')
    if (!presaleContext) return
    const { presale, timestamp } = presaleContext

    context.PreSaleContract.set(
      applyPresalePatch(presale, { endTime: event.params.endTimestamp_ }, timestamp)
    )

    recordPresaleConfigEvent({
      context,
      presaleId: presale.id,
      eventType: 'END_TIMESTAMP_SET',
      payload: { endTimestamp: event.params.endTimestamp_.toString() },
      timestamp,
      transactionHash: event.transaction.hash,
      logIndex: event.logIndex,
    })
  })
)

Presale.TimeSafeguardSet.handler(
  handlerErrorWrapper(async ({ event, context }) => {
    const presaleContext = await loadPresaleContextOrWarn(context, event, 'TimeSafeguardSet')
    if (!presaleContext) return
    const { presale, timestamp } = presaleContext

    context.PreSaleContract.set(
      applyPresalePatch(presale, { timeSafeguardTs: event.params.timeSafeguardTs_ }, timestamp)
    )

    recordPresaleConfigEvent({
      context,
      presaleId: presale.id,
      eventType: 'TIME_SAFEGUARD_SET',
      payload: { timeSafeguard: event.params.timeSafeguardTs_.toString() },
      timestamp,
      transactionHash: event.transaction.hash,
      logIndex: event.logIndex,
    })
  })
)

Presale.LendingFacilitySet.handler(
  handlerErrorWrapper(async ({ event, context }) => {
    const presaleContext = await loadPresaleContextOrWarn(context, event, 'LendingFacilitySet')
    if (!presaleContext) return
    const { presale, timestamp } = presaleContext

    const lendingFacility = normalizeAddress(event.params.lendingFacility_)
    context.PreSaleContract.set(applyPresalePatch(presale, { lendingFacility }, timestamp))

    recordPresaleConfigEvent({
      context,
      presaleId: presale.id,
      eventType: 'LENDING_FACILITY_SET',
      payload: { lendingFacility },
      timestamp,
      transactionHash: event.transaction.hash,
      logIndex: event.logIndex,
    })
  })
)

Presale.WhitelistUpdated.handler(
  handlerErrorWrapper(async ({ event, context }) => {
    const presaleContext = await loadPresaleContextOrWarn(context, event, 'WhitelistUpdated')
    if (!presaleContext) return
    const { presale, timestamp } = presaleContext

    const change = BigInt(event.params.addresses_.length)
    const nextWhitelistSize = event.params.added_
      ? presale.whitelistSize + change
      : presale.whitelistSize > change
        ? presale.whitelistSize - change
        : 0n

    context.PreSaleContract.set(
      applyPresalePatch(presale, { whitelistSize: nextWhitelistSize }, timestamp)
    )

    recordPresaleConfigEvent({
      context,
      presaleId: presale.id,
      eventType: 'WHITELIST_UPDATED',
      payload: {
        added: event.params.added_,
        addresses: event.params.addresses_.map((addr) => normalizeAddress(addr)),
      },
      timestamp,
      transactionHash: event.transaction.hash,
      logIndex: event.logIndex,
    })
  })
)

Presale.ModuleInitialized.handler(
  handlerErrorWrapper(async ({ event, context }) => {
    const presaleContext = await loadPresaleContextOrWarn(context, event, 'ModuleInitialized')
    if (!presaleContext) return
    const { presale, timestamp } = presaleContext

    const floorAddress = normalizeAddress(event.params.floor)
    context.PreSaleContract.set(
      applyPresalePatch(
        presale,
        {
          market_id: floorAddress,
        },
        timestamp
      )
    )

    recordPresaleConfigEvent({
      context,
      presaleId: presale.id,
      eventType: 'MODULE_INITIALIZED',
      payload: {
        floor: floorAddress,
        authorizer: normalizeAddress(event.params.authorizer),
        feeTreasury: normalizeAddress(event.params.feeTreasury),
        configData: event.params.configData,
      },
      timestamp,
      transactionHash: event.transaction.hash,
      logIndex: event.logIndex,
    })
  })
)

Presale.Initialized.handler(
  handlerErrorWrapper(async ({ event, context }) => {
    const presaleContext = await loadPresaleContextOrWarn(context, event, 'Initialized')
    if (!presaleContext) return
    const { presale, timestamp } = presaleContext

    context.PreSaleContract.set(applyPresalePatch(presale, {}, timestamp))

    recordPresaleConfigEvent({
      context,
      presaleId: presale.id,
      eventType: 'GENERIC',
      payload: {
        version: event.params.version.toString(),
        type: 'Initialized',
      },
      timestamp,
      transactionHash: event.transaction.hash,
      logIndex: event.logIndex,
    })
  })
)
