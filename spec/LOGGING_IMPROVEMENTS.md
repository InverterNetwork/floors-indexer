# Logging Improvements Implementation Guide

This document provides specific code changes to add comprehensive logging throughout the indexer handlers to improve debugging and monitoring capabilities.

## Overview

Based on the log analysis, we need to add logging at critical points to:
1. Track entity creation vs retrieval
2. Understand event processing order
3. Diagnose race conditions
4. Monitor RPC call success/failure
5. Track cross-entity dependencies

---

## 1. Factory Handlers (`src/factory-handlers.ts`)

### 1.1 Add Logging to ModuleRegistry Creation

**Location**: After line 60, in `getOrCreateModuleRegistry` call

**Current Code**:
```typescript
const registry = await getOrCreateModuleRegistry(
  context,
  marketId,
  moduleType,
  module,
  BigInt(event.block.timestamp)
)
```

**Add After**:
```typescript
context.log.debug(
  `[ModuleCreated] ModuleRegistry processed | marketId=${marketId} | moduleType=${moduleType} | module=${module} | creditFacility=${registry.creditFacility || 'none'} | floor=${registry.fundingManager || 'none'}`
)
```

**Note**: The logging should be added inside `getOrCreateModuleRegistry` helper - see section 2.1

### 1.2 Add Logging to Token Fetching

**Location**: Lines 70-79

**Current Code**:
```typescript
if (moduleType === 'floor') {
  // Try to fetch token addresses from the BC contract via RPC
  const tokenAddresses = await fetchTokenAddressesFromBC(event.chainId, module as `0x${string}`)

  let reserveTokenId: string | undefined
  let issuanceTokenId: string | undefined

  if (tokenAddresses) {
    reserveTokenId = tokenAddresses.reserveToken
    issuanceTokenId = tokenAddresses.issuanceToken
  }
```

**Change To**:
```typescript
if (moduleType === 'floor') {
  // Try to fetch token addresses from the BC contract via RPC
  context.log.debug(
    `[ModuleCreated] Fetching token addresses from BC | chainId=${event.chainId} | bcAddress=${module}`
  )
  const tokenAddresses = await fetchTokenAddressesFromBC(event.chainId, module as `0x${string}`)

  let reserveTokenId: string | undefined
  let issuanceTokenId: string | undefined

  if (tokenAddresses) {
    reserveTokenId = tokenAddresses.reserveToken
    issuanceTokenId = tokenAddresses.issuanceToken
    context.log.info(
      `[ModuleCreated] ✅ Tokens fetched from BC | reserveToken=${reserveTokenId} | issuanceToken=${issuanceTokenId}`
    )
  } else {
    context.log.warn(
      `[ModuleCreated] ⚠️ Failed to fetch tokens from BC | bcAddress=${module} | Will use placeholders`
    )
  }
```

### 1.3 Add Logging to Market Creation

**Location**: Lines 83-91

**Current Code**:
```typescript
const result = await getOrCreateMarket(
  context,
  event.chainId,
  marketId,
  BigInt(event.block.timestamp),
  reserveTokenId,
  issuanceTokenId,
  module as `0x${string}`
)
```

**Change To**:
```typescript
context.log.debug(
  `[ModuleCreated] Creating/retrieving Market | marketId=${marketId} | reserveToken=${reserveTokenId || 'fetching'} | issuanceToken=${issuanceTokenId || 'fetching'}`
)
const result = await getOrCreateMarket(
  context,
  event.chainId,
  marketId,
  BigInt(event.block.timestamp),
  reserveTokenId,
  issuanceTokenId,
  module as `0x${string}`
)

if (result) {
  context.log.info(
    `[ModuleCreated] ✅ Market ready | id=${result.id} | reserveToken=${result.reserveToken_id} | issuanceToken=${result.issuanceToken_id}`
  )
} else {
  context.log.error(`[ModuleCreated] ❌ Failed to create Market | marketId=${marketId}`)
}
```

### 1.4 Enhanced CreditFacility Creation Logging

**Location**: Lines 94-118

**Current Code**:
```typescript
if (moduleType === 'creditFacility') {
  // Get the Market entity to get token addresses
  const market = await context.Market.get(marketId)
  if (market) {
    const facilityId = module.toLowerCase()
    const facility = {
      id: facilityId,
      collateralToken_id: market.issuanceToken_id,
      borrowToken_id: market.reserveToken_id,
      totalLoans: 0n,
      totalVolumeRaw: 0n,
      totalVolumeFormatted: '0',
      createdAt: BigInt(event.block.timestamp),
    }
    context.CreditFacilityContract.set(facility)
    context.log.info(
      `[ModuleCreated] CreditFacility created | id=${facilityId} | collateralToken=${market.issuanceToken_id} | borrowToken=${market.reserveToken_id}`
    )
  } else {
    context.log.warn(
      `[ModuleCreated] Market not found for creditFacility | marketId=${marketId}`
    )
  }
}
```

**Change To**:
```typescript
if (moduleType === 'creditFacility') {
  const facilityId = module.toLowerCase()
  context.log.debug(
    `[ModuleCreated] Creating CreditFacility | facilityId=${facilityId} | marketId=${marketId} | block=${event.block.number}`
  )
  
  // Get the Market entity to get token addresses
  let market = await context.Market.get(marketId)
  
  // Try alternative lookup if market not found by orchestrator ID
  if (!market) {
    context.log.debug(
      `[ModuleCreated] Market not found by orchestrator, trying BC module address | marketId=${marketId} | module=${module}`
    )
    // Try using module address as marketId (in case orchestrator = BC module)
    market = await context.Market.get(module.toLowerCase())
  }
  
  // Try to find market via ModuleRegistry
  if (!market) {
    const registry = await context.ModuleRegistry.get(marketId)
    if (registry) {
      context.log.debug(
        `[ModuleCreated] Registry found, checking for floor module | registry=${JSON.stringify({
          id: registry.id,
          creditFacility: registry.creditFacility,
          // Note: floor module may not be in registry yet
        })}`
      )
    }
  }
  
  if (market) {
    const facility = {
      id: facilityId,
      collateralToken_id: market.issuanceToken_id,
      borrowToken_id: market.reserveToken_id,
      totalLoans: 0n,
      totalVolumeRaw: 0n,
      totalVolumeFormatted: '0',
      createdAt: BigInt(event.block.timestamp),
    }
    context.CreditFacilityContract.set(facility)
    context.log.info(
      `[ModuleCreated] ✅ CreditFacility created | id=${facilityId} | collateralToken=${market.issuanceToken_id} | borrowToken=${market.reserveToken_id} | marketId=${marketId}`
    )
  } else {
    // Create facility with placeholder tokens to prevent event loss
    // This is a workaround for the race condition
    const facility = {
      id: facilityId,
      collateralToken_id: 'unknown-collateral',
      borrowToken_id: 'unknown-borrow',
      totalLoans: 0n,
      totalVolumeRaw: 0n,
      totalVolumeFormatted: '0',
      createdAt: BigInt(event.block.timestamp),
    }
    context.CreditFacilityContract.set(facility)
    context.log.warn(
      `[ModuleCreated] ⚠️ CreditFacility created with placeholder tokens | id=${facilityId} | marketId=${marketId} | block=${event.block.number} | Will update when Market becomes available`
    )
  }
}
```

---

## 2. Helper Functions

### 2.1 ModuleRegistry Helper (`src/helpers/registry.ts`)

**Location**: Lines 25-44

**Current Code**:
```typescript
const existingRegistry = await context.ModuleRegistry.get(normalizedMarketId)

// Create or update registry with new module address
const registry: ModuleRegistry_t = {
  id: normalizedMarketId,
  authorizer: moduleType === 'authorizer' ? normalizedModule : existingRegistry?.authorizer || '',
  // ... rest of fields
}

context.ModuleRegistry.set(registry)

return registry
```

**Change To**:
```typescript
const existingRegistry = await context.ModuleRegistry.get(normalizedMarketId)

if (existingRegistry) {
  context.log.debug(
    `[getOrCreateModuleRegistry] Updating existing registry | marketId=${normalizedMarketId} | moduleType=${moduleType} | module=${normalizedModule} | previous_${moduleType}=${existingRegistry[moduleType as keyof ModuleRegistry_t] || 'none'}`
  )
} else {
  context.log.info(
    `[getOrCreateModuleRegistry] Creating new registry | marketId=${normalizedMarketId} | moduleType=${moduleType} | module=${normalizedModule}`
  )
}

// Create or update registry with new module address
const registry: ModuleRegistry_t = {
  id: normalizedMarketId,
  authorizer: moduleType === 'authorizer' ? normalizedModule : existingRegistry?.authorizer || '',
  feeTreasury:
    moduleType === 'feeTreasury' ? normalizedModule : existingRegistry?.feeTreasury || '',
  creditFacility:
    moduleType === 'creditFacility' ? normalizedModule : existingRegistry?.creditFacility || '',
  presale: moduleType === 'presale' ? normalizedModule : existingRegistry?.presale || '',
  staking: moduleType === 'staking' ? normalizedModule : existingRegistry?.staking || '',
  createdAt: existingRegistry?.createdAt || timestamp,
  lastUpdatedAt: timestamp,
}

context.ModuleRegistry.set(registry)

context.log.debug(
  `[getOrCreateModuleRegistry] ✅ Registry ${existingRegistry ? 'updated' : 'created'} | marketId=${normalizedMarketId} | modules=${JSON.stringify({
    authorizer: registry.authorizer || 'none',
    feeTreasury: registry.feeTreasury || 'none',
    creditFacility: registry.creditFacility || 'none',
  })}`
)

return registry
```

### 2.2 Market Helper (`src/helpers/market.ts`)

**Location**: Lines 27-110

**Current Code**:
```typescript
let market = await context.Market.get(normalizedMarketId)

// If market exists, return it
if (market) return market

// Create new market
const creator = await getOrCreateAccount(context, normalizedMarketId)
```

**Change To**:
```typescript
let market = await context.Market.get(normalizedMarketId)

// If market exists, return it
if (market) {
  context.log.debug(
    `[getOrCreateMarket] Market exists | id=${normalizedMarketId} | reserveToken=${market.reserveToken_id} | issuanceToken=${market.issuanceToken_id} | totalSupply=${market.totalSupplyFormatted}`
  )
  return market
}

// Create new market
context.log.info(
  `[getOrCreateMarket] Creating new market | id=${normalizedMarketId} | bcAddress=${bcAddress || 'none'} | reserveToken=${reserveTokenId || 'fetching'} | issuanceToken=${issuanceTokenId || 'fetching'} | chainId=${chainId}`
)

const creator = await getOrCreateAccount(context, normalizedMarketId)
```

**Also Add After Line 45**:
```typescript
if ((!finalReserveTokenId || !finalIssuanceTokenId) && bcAddress) {
  context.log.debug(
    `[getOrCreateMarket] Fetching token addresses from BC | bcAddress=${bcAddress} | chainId=${chainId}`
  )
  const tokenAddresses = await fetchTokenAddressesFromBC(chainId, bcAddress)
  if (tokenAddresses) {
    if (!finalReserveTokenId) finalReserveTokenId = tokenAddresses.reserveToken
    if (!finalIssuanceTokenId) finalIssuanceTokenId = tokenAddresses.issuanceToken
    context.log.info(
      `[getOrCreateMarket] ✅ Tokens fetched | reserveToken=${finalReserveTokenId} | issuanceToken=${finalIssuanceTokenId}`
    )
  } else {
    context.log.warn(
      `[getOrCreateMarket] ⚠️ Failed to fetch tokens from BC | bcAddress=${bcAddress} | Will use placeholders`
    )
  }
}
```

**Add Before Return (Line 109)**:
```typescript
context.Market.set(market)

context.log.info(
  `[getOrCreateMarket] ✅ Market created | id=${market.id} | reserveToken=${market.reserveToken_id} | issuanceToken=${market.issuanceToken_id} | creator=${market.creator_id}`
)

return market
```

### 2.3 Token Helper (`src/helpers/token.ts`)

**Location**: Lines 87-125

**Current Code**:
```typescript
export async function fetchTokenAddressesFromBC(
  chainId: number,
  bcAddress: `0x${string}`
): Promise<{ issuanceToken: `0x${string}`; reserveToken: `0x${string}` } | null> {
  try {
    const publicClient = getPublicClient(chainId)

    // Call getIssuanceToken() view function
    const issuanceToken = await publicClient.readContract({
      address: bcAddress,
      abi: FLOOR_ABI,
      functionName: 'getIssuanceToken',
    })

    // Call getCollateralToken() view function (reserve token)
    const reserveToken = await publicClient.readContract({
      address: bcAddress,
      abi: FLOOR_ABI,
      functionName: 'getCollateralToken',
    })

    if (
      issuanceToken &&
      reserveToken &&
      typeof issuanceToken === 'string' &&
      typeof reserveToken === 'string'
    ) {
      return {
        issuanceToken: issuanceToken.toLowerCase() as `0x${string}`,
        reserveToken: reserveToken.toLowerCase() as `0x${string}`,
      }
    }
  } catch (error) {
    // RPC call failed - return null
    // Tokens can be created later with placeholder values
  }

  return null
}
```

**Change To**:
```typescript
export async function fetchTokenAddressesFromBC(
  chainId: number,
  bcAddress: `0x${string}`
): Promise<{ issuanceToken: `0x${string}`; reserveToken: `0x${string}` } | null> {
  try {
    const publicClient = getPublicClient(chainId)

    // Call getIssuanceToken() view function
    const issuanceToken = await publicClient.readContract({
      address: bcAddress,
      abi: FLOOR_ABI,
      functionName: 'getIssuanceToken',
    })

    // Call getCollateralToken() view function (reserve token)
    const reserveToken = await publicClient.readContract({
      address: bcAddress,
      abi: FLOOR_ABI,
      functionName: 'getCollateralToken',
    })

    if (
      issuanceToken &&
      reserveToken &&
      typeof issuanceToken === 'string' &&
      typeof reserveToken === 'string'
    ) {
      const result = {
        issuanceToken: issuanceToken.toLowerCase() as `0x${string}`,
        reserveToken: reserveToken.toLowerCase() as `0x${string}`,
      }
      // Note: Logging should be done at call site, not here (to avoid log spam)
      return result
    } else {
      // Invalid response format
      return null
    }
  } catch (error) {
    // RPC call failed - return null
    // Tokens can be created later with placeholder values
    // Note: Error logging should be done at call site with context
    return null
  }
}
```

**Note**: The logging is intentionally kept at the call site to provide better context.

---

## 3. Credit Handlers (`src/credit-handlers.ts`)

### 3.1 Enhanced LoanCreated Handler Logging

**Location**: Lines 11-73

**Current Code**:
```typescript
const facilityId = event.srcAddress
const facility = await context.CreditFacilityContract.get(facilityId)

if (!facility) {
  context.log.warn(
    `[LoanCreated] Facility not found | facilityId=${facilityId} - skipping event`
  )
  return
}
```

**Change To**:
```typescript
const facilityId = event.srcAddress.toLowerCase()
context.log.debug(
  `[LoanCreated] Looking up facility | facilityId=${facilityId} | block=${event.block.number} | logIndex=${event.logIndex}`
)

let facility = await context.CreditFacilityContract.get(facilityId)

if (!facility) {
  context.log.error(
    `[LoanCreated] ❌ CRITICAL: Facility not found | facilityId=${facilityId} | block=${event.block.number} | tx=${event.transaction.hash} | logIndex=${event.logIndex} | Event will be lost!`
  )
  // TODO: Implement recovery mechanism to create facility on-demand
  return
}

context.log.debug(
  `[LoanCreated] Facility found | id=${facility.id} | collateralToken=${facility.collateralToken_id} | borrowToken=${facility.borrowToken_id} | totalLoans=${facility.totalLoans}`
)
```

### 3.2 Enhanced LoanRepaid Handler Logging

**Location**: Lines 79-123

**Current Code**:
```typescript
const facilityId = event.srcAddress
const facility = await context.CreditFacilityContract.get(facilityId)
if (!facility) {
  context.log.warn(`[LoanRepaid] Facility not found | facilityId=${facilityId}`)
  return
}
```

**Change To**:
```typescript
const facilityId = event.srcAddress.toLowerCase()
context.log.debug(
  `[LoanRepaid] Looking up facility | facilityId=${facilityId} | block=${event.block.number} | logIndex=${event.logIndex}`
)

const facility = await context.CreditFacilityContract.get(facilityId)
if (!facility) {
  context.log.error(
    `[LoanRepaid] ❌ CRITICAL: Facility not found | facilityId=${facilityId} | block=${event.block.number} | tx=${event.transaction.hash} | logIndex=${event.logIndex} | Event will be lost!`
  )
  return
}

context.log.debug(
  `[LoanRepaid] Facility found | id=${facility.id} | totalLoans=${facility.totalLoans}`
)
```

### 3.3 Complete IssuanceTokensLocked Implementation

**Location**: Lines 162-171

**Current Code**:
```typescript
CreditFacility.IssuanceTokensLocked.handler(
  handlerErrorWrapper(async ({ event, context }) => {
    context.log.info(
      `[IssuanceTokensLocked] Handler invoked | facility=${event.srcAddress} | user=${event.params.user_}`
    )

    const user = await getOrCreateAccount(context, event.params.user_)
    context.log.debug(`[IssuanceTokensLocked] Updating portfolio | userId=${user.id}`)
  })
)
```

**Change To** (requires finding market by collateral token):
```typescript
CreditFacility.IssuanceTokensLocked.handler(
  handlerErrorWrapper(async ({ event, context }) => {
    context.log.info(
      `[IssuanceTokensLocked] Handler invoked | facility=${event.srcAddress} | user=${event.params.user_} | amount=${event.params.amount_} | block=${event.block.number}`
    )

    const facilityId = event.srcAddress.toLowerCase()
    const facility = await context.CreditFacilityContract.get(facilityId)
    
    if (!facility) {
      context.log.warn(
        `[IssuanceTokensLocked] Facility not found | facilityId=${facilityId} | skipping`
      )
      return
    }

    const collateralToken = await context.Token.get(facility.collateralToken_id)
    if (!collateralToken) {
      context.log.warn(
        `[IssuanceTokensLocked] Collateral token not found | tokenId=${facility.collateralToken_id}`
      )
      return
    }

    // Find market by issuanceToken_id matching collateralToken_id
    // Note: This requires a query - for now, we'll need to iterate or use a helper
    // TODO: Implement findMarketByIssuanceToken helper or use GraphQL query
    
    context.log.debug(
      `[IssuanceTokensLocked] Facility and token verified | facilityId=${facilityId} | collateralToken=${facility.collateralToken_id} | decimals=${collateralToken.decimals}`
    )
    
    // For now, log that we need to implement market lookup
    context.log.warn(
      `[IssuanceTokensLocked] ⚠️ Market lookup not implemented | collateralToken=${facility.collateralToken_id} | Position update skipped`
    )

    const user = await getOrCreateAccount(context, event.params.user_)
    context.log.debug(`[IssuanceTokensLocked] User account | userId=${user.id}`)
    
    // TODO: Once market lookup is implemented:
    // const market = await findMarketByIssuanceToken(context, facility.collateralToken_id)
    // const position = await getOrCreateUserMarketPosition(...)
    // Update lockedCollateral fields
  })
)
```

---

## 4. Market Handlers (`src/market-handlers.ts`)

### 4.1 Enhanced TokensBought Logging

**Location**: Lines 19-170

**Add After Line 26**:
```typescript
context.log.debug(
  `[TokensBought] Processing trade | block=${event.block.number} | logIndex=${event.logIndex} | tx=${event.transaction.hash}`
)
```

**Add After Line 37** (after getOrCreateMarket):
```typescript
if (!market) {
  context.log.error(
    `[TokensBought] ❌ Failed to get/create market | marketId=${marketId} | block=${event.block.number} | Event will be lost!`
  )
  return
}

context.log.debug(
  `[TokensBought] Market retrieved/created | id=${market.id} | wasNew=${market.createdAt === BigInt(event.block.timestamp)}`
)
```

**Add After Line 50** (after token verification):
```typescript
context.log.debug(
  `[TokensBought] Tokens verified | reserveToken=${reserveToken.id} (${reserveToken.decimals} decimals) | issuanceToken=${issuanceToken.id} (${issuanceToken.decimals} decimals)`
)
```

### 4.2 Enhanced TokensSold Logging

**Apply same changes as TokensBought** (lines 176-327)

---

## 5. Batch Processing Context

### 5.1 Add Handler Entry Logging

**Location**: At the start of each handler function

**Pattern to Add**:
```typescript
context.log.debug(
  `[HandlerName] Handler entry | block=${event.block.number} | logIndex=${event.logIndex} | tx=${event.transaction.hash} | timestamp=${event.block.timestamp}`
)
```

**Apply To**:
- `ModuleCreated.handler` (factory-handlers.ts)
- `TokensBought.handler` (market-handlers.ts)
- `TokensSold.handler` (market-handlers.ts)
- `LoanCreated.handler` (credit-handlers.ts)
- `LoanRepaid.handler` (credit-handlers.ts)
- `LoanClosed.handler` (credit-handlers.ts)
- `IssuanceTokensLocked.handler` (credit-handlers.ts)
- `VirtualCollateralAmountAdded.handler` (market-handlers.ts)
- `VirtualCollateralAmountSubtracted.handler` (market-handlers.ts)

---

## 6. Summary of Logging Levels

- **TRACE**: Very detailed, low-level operations (RPC calls, entity lookups)
- **DEBUG**: Detailed flow information (entity creation vs retrieval, handler entry)
- **INFO**: Important state changes (entity created, trade processed, handler completed)
- **WARN**: Recoverable issues (missing optional data, fallback logic triggered)
- **ERROR**: Critical issues (missing required data, event loss, permanent failures)

---

## 7. Implementation Priority

1. **High Priority** (Fix Critical Issues):
   - CreditFacility creation race condition fix (Section 1.4)
   - Enhanced error logging in LoanCreated/LoanRepaid (Section 3.1, 3.2)

2. **Medium Priority** (Improve Debugging):
   - ModuleRegistry logging (Section 2.1)
   - Market creation logging (Section 2.2)
   - Token fetching logging (Section 1.2)

3. **Low Priority** (Nice to Have):
   - Handler entry logging (Section 5.1)
   - Batch context logging

---

## 8. Testing Checklist

After implementing logging improvements:

- [ ] Verify all handlers log entry points
- [ ] Verify entity creation vs retrieval is logged
- [ ] Verify RPC call success/failure is logged
- [ ] Verify error cases log sufficient context
- [ ] Verify log levels are appropriate (not too verbose in production)
- [ ] Test CreditFacility creation with missing Market
- [ ] Test LoanCreated with missing Facility
- [ ] Verify logs contain enough context to debug issues

