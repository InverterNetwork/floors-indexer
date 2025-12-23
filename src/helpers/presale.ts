import type { handlerContext } from 'generated'
import type { Market_t, PreSaleContract_t, Token_t } from 'generated/src/db/Entities.gen'
import { decodeAbiParameters } from 'viem'

import { formatAmount, normalizeAddress } from './misc'
import { getOrCreateToken } from './token'
import {
  buildUpdatedUserMarketPosition,
  getOrCreateAccount,
  getOrCreateUserMarketPosition,
} from './user'

export const PRESALE_LOG_PREFIX = '[Presale]'

export type PresaleContext = {
  presale: PreSaleContract_t
  marketId: string
  market?: Market_t
  saleToken?: Token_t
  purchaseToken?: Token_t
  timestamp: bigint
}

type ParticipationArgs = {
  userAddress: string
  depositRaw: bigint
  mintedRaw: bigint
  leverage: bigint
  positionId?: bigint
}

/**
 * Resolve the presale contract, market, and token metadata for a module.
 * Returns null if the presale entity has not been registered yet.
 */
export async function resolvePresaleContext(
  context: handlerContext,
  params: { presaleAddress: string; chainId: number; timestamp: bigint }
): Promise<PresaleContext | null> {
  const normalizedAddress = normalizeAddress(params.presaleAddress)
  const presale = await context.PreSaleContract.get(normalizedAddress)

  if (!presale) {
    context.log.warn(
      `[Presale] Missing PreSaleContract entity | address=${normalizedAddress} | action=reindex?`
    )
    return null
  }

  if (!presale.market_id) {
    context.log.error(
      `[Presale] PreSaleContract missing market reference | presale=${normalizedAddress}`
    )
    return null
  }

  const market = await context.Market.get(presale.market_id)

  const saleToken = presale.saleToken_id.startsWith('0x')
    ? await getOrCreateToken(context, params.chainId, presale.saleToken_id)
    : undefined
  const purchaseToken = presale.purchaseToken_id.startsWith('0x')
    ? await getOrCreateToken(context, params.chainId, presale.purchaseToken_id)
    : undefined

  return {
    presale,
    market,
    saleToken,
    purchaseToken,
    marketId: presale.market_id,
    timestamp: params.timestamp,
  }
}

export async function loadPresaleContextOrWarn(
  context: handlerContext,
  event: { srcAddress: string; chainId: number; block: { timestamp: number } },
  handlerName: string
): Promise<PresaleContext | null> {
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

  return presaleContext
}

export function applyPresalePatch(
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

export async function handleParticipation(
  context: handlerContext,
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

export function updateWhitelist(
  currentWhitelist: readonly string[],
  addresses: readonly string[],
  added: boolean
): string[] {
  const normalizedAddresses = addresses.map(normalizeAddress)
  if (added) {
    const set = new Set(currentWhitelist)
    normalizedAddresses.forEach((addr) => set.add(addr))
    return Array.from(set)
  } else {
    const set = new Set(currentWhitelist)
    normalizedAddresses.forEach((addr) => set.delete(addr))
    return Array.from(set)
  }
}

export type FlattenedPriceBreakpoints = {
  flat: bigint[]
  offsets: number[]
}

/**
 * Flatten jagged breakpoint arrays into a single array plus cumulative
 * offsets for compact storage. Consumers can reconstruct row i by slicing
 * `flat[start:end]`, where start is the previous offset (or 0) and end is
 * offsets[i].
 */
export function flattenPriceBreakpoints(
  breakpoints: readonly (readonly bigint[])[] | undefined
): FlattenedPriceBreakpoints | undefined {
  if (!breakpoints) {
    return undefined
  }

  const flat: bigint[] = []
  const offsets: number[] = []
  let runningLength = 0

  breakpoints.forEach((row) => {
    flat.push(...row)
    runningLength += row.length
    offsets.push(runningLength)
  })

  return { flat, offsets }
}

const PRESALE_CONFIG_PARAMS = [
  { type: 'address' },
  { type: 'uint16[]' },
  { type: 'uint64' },
  { type: 'uint256' },
  { type: 'uint256' },
  { type: 'uint256[][]' },
] as const

export type DecodedPresaleConfig = {
  lendingFacility: string
  commissionBps: readonly bigint[]
  endTime: bigint
  globalIssuanceCapRaw: bigint
  perAddressIssuanceCapRaw: bigint
  priceBreakpointsFlat: bigint[]
  priceBreakpointOffsets: number[]
  maxLeverage: number
}

export function decodePresaleConfig(encoded: string): DecodedPresaleConfig | null {
  if (!encoded || encoded === '0x') {
    return null
  }

  try {
    const [
      lendingFacility,
      commissionBps,
      endTime,
      globalIssuanceCapRaw,
      perAddressIssuanceCapRaw,
      priceBreakpoints,
    ] = decodeAbiParameters(PRESALE_CONFIG_PARAMS, encoded as `0x${string}`)

    const commissionValues = (commissionBps as readonly (number | bigint)[]).map((bps) =>
      BigInt(bps)
    )
    const priceBreakpointsValues = (
      priceBreakpoints as readonly (readonly (number | bigint)[])[]
    ).map((row) => row.map((value) => BigInt(value)) as readonly bigint[])

    const flattened = flattenPriceBreakpoints(priceBreakpointsValues)

    // Calculate maxLeverage: commissionBps.length - 1 (index 0 = non-leveraged)
    // Fallback to priceBreakpoints.length if commissionBps is empty
    let maxLeverage = 0
    if (commissionValues.length > 0) {
      maxLeverage = commissionValues.length - 1
    } else if (priceBreakpointsValues.length > 0) {
      // priceBreakpoints array length equals max leverage (one sub-array per leverage level)
      maxLeverage = priceBreakpointsValues.length
    }

    return {
      lendingFacility: normalizeAddress(lendingFacility as string),
      commissionBps: commissionValues,
      endTime: endTime as bigint,
      globalIssuanceCapRaw: globalIssuanceCapRaw as bigint,
      perAddressIssuanceCapRaw: perAddressIssuanceCapRaw as bigint,
      priceBreakpointsFlat: flattened?.flat ?? [],
      priceBreakpointOffsets: flattened?.offsets ?? [],
      maxLeverage,
    }
  } catch (error) {
    return null
  }
}
