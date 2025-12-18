/**
 * Treasury helper functions for building fee distribution entities
 */

interface TreasuryParams {
  id: string
  marketId: string
  treasuryAddress: string
  createdAt: bigint
  lastUpdatedAt: bigint
}

interface FeeSplitterReceiptParams {
  id: string
  marketId: string
  treasuryId: string
  tokenId: string
  sender: string
  amountRaw: bigint
  amountFormatted: string
  timestamp: bigint
  transactionHash: string
}

interface FeeSplitterPaymentParams {
  id: string
  marketId: string
  treasuryId: string
  tokenId: string
  recipient: string
  isFloorFee: boolean
  amountRaw: bigint
  amountFormatted: string
  timestamp: bigint
  transactionHash: string
}

/**
 * Build a Treasury entity for tracking a fee splitter treasury
 */
export function buildTreasury(params: TreasuryParams) {
  return {
    id: params.id,
    market_id: params.marketId,
    treasuryAddress: params.treasuryAddress,
    totalFeesReceivedRaw: 0n,
    totalFeesReceivedFormatted: '0',
    totalFeesDistributedRaw: 0n,
    totalFeesDistributedFormatted: '0',
    createdAt: params.createdAt,
    lastUpdatedAt: params.lastUpdatedAt,
  }
}

/**
 * Build a FeeSplitterReceipt entity for fees received by the treasury
 */
export function buildFeeSplitterReceipt(params: FeeSplitterReceiptParams) {
  return {
    id: params.id,
    market_id: params.marketId,
    treasury_id: params.treasuryId,
    token_id: params.tokenId,
    sender: params.sender,
    amountRaw: params.amountRaw,
    amountFormatted: params.amountFormatted,
    timestamp: params.timestamp,
    transactionHash: params.transactionHash,
  }
}

/**
 * Build a FeeSplitterPayment entity for fees distributed to recipients
 */
export function buildFeeSplitterPayment(params: FeeSplitterPaymentParams) {
  return {
    id: params.id,
    market_id: params.marketId,
    treasury_id: params.treasuryId,
    token_id: params.tokenId,
    recipient: params.recipient,
    isFloorFee: params.isFloorFee,
    amountRaw: params.amountRaw,
    amountFormatted: params.amountFormatted,
    timestamp: params.timestamp,
    transactionHash: params.transactionHash,
  }
}
