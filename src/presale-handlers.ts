import type { PreSaleContract_t } from '../generated/src/db/Entities.gen'
import { Presale } from '../generated/src/Handlers.gen'
import {
  applyPresalePatch,
  decodePresaleConfig,
  flattenPriceBreakpoints,
  formatAmount,
  handleParticipation,
  handlerErrorWrapper,
  loadPresaleContextOrWarn,
  normalizeAddress,
  PRESALE_LOG_PREFIX,
  updateWhitelist,
} from './helpers'

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
  })
)

Presale.BaseCommissionUpdated.handler(
  handlerErrorWrapper(async ({ event, context }) => {
    const presaleContext = await loadPresaleContextOrWarn(context, event, 'BaseCommissionUpdated')
    if (!presaleContext) return

    const { presale, timestamp } = presaleContext
    const commissionBps = Array.from(event.params.baseCommissionBps_)
    context.PreSaleContract.set(applyPresalePatch(presale, { commissionBps }, timestamp))
  })
)

Presale.PriceBreakpointsSet.handler(
  handlerErrorWrapper(async ({ event, context }) => {
    const presaleContext = await loadPresaleContextOrWarn(context, event, 'PriceBreakpointsSet')
    if (!presaleContext) return
    const { presale, timestamp } = presaleContext

    const flattenedBreakpoints = flattenPriceBreakpoints(event.params.priceBreakpoints_)
    const priceBreakpointsFlat: bigint[] = flattenedBreakpoints?.flat ?? []
    const priceBreakpointOffsets: number[] = flattenedBreakpoints?.offsets ?? []
    context.PreSaleContract.set(
      applyPresalePatch(
        presale,
        {
          priceBreakpointsFlat,
          priceBreakpointOffsets,
        },
        timestamp
      )
    )
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
  })
)

Presale.CreditFacilitySet.handler(
  handlerErrorWrapper(async ({ event, context }) => {
    const presaleContext = await loadPresaleContextOrWarn(context, event, 'CreditFacilitySet')
    if (!presaleContext) return
    const { presale, timestamp } = presaleContext

    const lendingFacility = normalizeAddress(event.params.creditFacility_)
    context.PreSaleContract.set(applyPresalePatch(presale, { lendingFacility }, timestamp))
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

    const currentWhitelist = presale.whitelistedAddresses ?? []
    const whitelistAddresses = event.params.addresses_.map((address) => String(address))
    const nextWhitelistedAddresses = updateWhitelist(
      currentWhitelist,
      whitelistAddresses,
      event.params.added_
    )

    context.PreSaleContract.set(
      applyPresalePatch(
        presale,
        {
          whitelistSize: nextWhitelistSize,
          whitelistedAddresses: nextWhitelistedAddresses,
        },
        timestamp
      )
    )
  })
)

Presale.ModuleInitialized.handler(
  handlerErrorWrapper(async ({ event, context }) => {
    const presaleContext = await loadPresaleContextOrWarn(context, event, 'ModuleInitialized')
    if (!presaleContext) return
    const { presale, purchaseToken, timestamp } = presaleContext

    const floorAddress = normalizeAddress(event.params.floor)

    let patch: Partial<PreSaleContract_t> = {
      market_id: floorAddress,
      authorizer: normalizeAddress(event.params.authorizer),
      feeTreasury: normalizeAddress(event.params.feeTreasury),
    }

    if (presale.startTime === 0n) {
      patch = { ...patch, startTime: timestamp }
    }

    const decodedConfig = decodePresaleConfig(event.params.configData)
    if (decodedConfig) {
      const depositDecimals = purchaseToken?.decimals ?? 18
      const globalCapAmount = formatAmount(decodedConfig.globalDepositCapRaw, depositDecimals)
      const perAddressCapAmount = formatAmount(
        decodedConfig.perAddressDepositCapRaw,
        depositDecimals
      )

      patch = {
        ...patch,
        lendingFacility: decodedConfig.lendingFacility,
        timeSafeguardTs: decodedConfig.timeSafeguardTs,
        endTime: decodedConfig.endTime,
        globalDepositCapRaw: decodedConfig.globalDepositCapRaw,
        globalDepositCapFormatted: globalCapAmount.formatted,
        perAddressDepositCapRaw: decodedConfig.perAddressDepositCapRaw,
        perAddressDepositCapFormatted: perAddressCapAmount.formatted,
        commissionBps: Array.from(decodedConfig.commissionBps),
        priceBreakpointsFlat: [...decodedConfig.priceBreakpointsFlat],
        priceBreakpointOffsets: [...decodedConfig.priceBreakpointOffsets],
        maxLeverage: BigInt(decodedConfig.maxLeverage),
      }
    }

    context.PreSaleContract.set(applyPresalePatch(presale, patch, timestamp))
  })
)

Presale.Initialized.handler(
  handlerErrorWrapper(async ({ event, context }) => {
    const presaleContext = await loadPresaleContextOrWarn(context, event, 'Initialized')
    if (!presaleContext) return
    const { presale, timestamp } = presaleContext

    context.PreSaleContract.set(applyPresalePatch(presale, {}, timestamp))
  })
)
