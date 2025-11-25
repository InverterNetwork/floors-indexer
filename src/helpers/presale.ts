import type { HandlerContext } from 'generated'
import type { Market_t, PreSaleContract_t, Token_t } from 'generated/src/db/Entities.gen'
import type { PresaleConfigEventType_t } from 'generated/src/db/Enums.gen'

import { normalizeAddress } from './misc'
import { getOrCreateToken } from './token'

type ConfigEventParams = {
  context: HandlerContext
  presaleId: string
  eventType: PresaleConfigEventType_t
  payload?: Record<string, unknown>
  timestamp: bigint
  transactionHash: string
  logIndex: number
}

export type PresaleContext = {
  presale: PreSaleContract_t
  marketId: string
  market?: Market_t
  saleToken?: Token_t
  purchaseToken?: Token_t
}

/**
 * Resolve the presale contract, market, and token metadata for a module.
 * Returns null if the presale entity has not been registered yet.
 */
export async function resolvePresaleContext(
  context: HandlerContext,
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
  }
}

export function recordPresaleConfigEvent({
  context,
  presaleId,
  eventType,
  payload,
  timestamp,
  transactionHash,
  logIndex,
}: ConfigEventParams) {
  const entityId = `${transactionHash}-${logIndex}`
  context.PresaleConfigEvent.set({
    id: entityId,
    presale_id: normalizeAddress(presaleId),
    eventType,
    payloadJson: JSON.stringify(payload ?? {}),
    timestamp,
    transactionHash,
  })
}
