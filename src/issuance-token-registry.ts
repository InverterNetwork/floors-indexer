/**
 * In-memory registry mapping issuance token address → market ID.
 *
 * Kept in its own module (no Envio runtime imports) so it can be
 * imported by unit tests without triggering handler registration.
 *
 * Populated by:
 *  - ModuleCreated handler (factory-handlers.ts)
 *  - IssuanceTokenSet handler (market-handlers.ts)
 *
 * Consumed by:
 *  - ERC20IssuanceToken.Transfer handler (issuance-token-handlers.ts)
 */
export const issuanceTokenToMarketId = new Map<string, string>()
