# Envio Indexer Log Analysis

## Executive Summary

This document analyzes the Envio indexer execution logs to understand the event processing flow, identify gaps in the system, and recommend improvements. The analysis reveals a critical timing issue where CreditFacility events are processed before the CreditFacilityContract entity is created, causing multiple warnings and missed data.

---

## 1. Chronological Flow Analysis

### Phase 1: Database Setup (Lines 1-140)
- **Time**: 14:54:30 - 14:54:36
- **Events**: Database migrations, Hasura table tracking, permissions setup
- **Status**: ✅ Successful
- **Tables Created**: 22 tables including `Market`, `Trade`, `Loan`, `CreditFacilityContract`, `ModuleRegistry`, etc.

### Phase 2: Indexer Initialization (Lines 141-198)
- **Time**: 14:54:41 - 14:54:43
- **Events**:
  - Indexer starts checking for new blocks
  - Current block height: 0
  - New blocks found: 356
  - First partition query (blocks 0-356): 4 events found
- **Status**: ✅ Successful

### Phase 3: Contract Registration (Lines 170-197)
- **Time**: 14:54:43
- **Events**: `contractRegister` handlers fire to dynamically register contracts
- **Modules Detected**:
  1. **Floor_v1** (floor) at `0xA5e3bFA98103595c9cE1565913e0c810B178fF72` - Block 310
  2. **AUT_Roles_v2** (authorizer) at `0x63902b335255a59F6b29973551CaeecFf4E127c3` - Block 310
  3. **SplitterTreasury_v1** (feeTreasury) at `0xEE3c5841F19F9bC5e62bdDebb832b32a1E13D96B` - Block 310
  4. **CreditFacility_v1** (creditFacility) at `0xAB73095BAc270EB0d173d2B1AD7e5be19064bbEc` - Block 311
- **Status**: ✅ All modules registered successfully

### Phase 4: Event Batch Processing (Lines 214-535)
- **Time**: 14:54:44 - 14:54:48
- **Batch Size**: 15 events
- **Processing Time**: 4074ms (handlers) + 44ms (write)

#### 4.1 ModuleCreated Regular Handlers (Lines 233-264)
- **Processing Order**: Handlers execute sequentially
- **Events Processed**:
  1. Floor_v1 → Creates Market entity
  2. AUT_Roles_v2 → Updates ModuleRegistry
  3. SplitterTreasury_v1 → Updates ModuleRegistry
  4. CreditFacility_v1 → **⚠️ WARNING**: Market not found (line 265)
- **Issue**: CreditFacility handler runs before Market entity is fully persisted/available

#### 4.2 Market Events (Lines 272-396)
- **TokensBought** (Block 345): ✅ Successfully processed
  - Trade created: `0xf478434e8fdba95ff48006163d6ae2ec4e61f7d62aabd35f5428ce303aa40ab8-9`
  - Market updated: totalSupply = 0.0000000000099
  - UserPosition updated
  
- **TokensSold** (Block 347): ✅ Successfully processed
  - Trade created: `0x3ff7a9d1848229a4383da6f569b21a9961a33b3b542889bef8a2a16863affbc4-10`
  - Market updated: totalSupply = 0.00000000000495
  - UserPosition updated

#### 4.3 Collateral Events (Lines 398-494)
- **VirtualCollateralAmountAdded** (Blocks 351, 355, 356): ✅ Successfully processed
- **VirtualCollateralAmountSubtracted** (Block 353): ✅ Successfully processed

#### 4.4 Credit Facility Events (Lines 412-522)
- **IssuanceTokensLocked** (Block 353): ✅ Handler invoked (no errors)
- **LoanCreated** (Block 353): ⚠️ **FAILED** - Facility not found
- **LoanRepaid** (Blocks 355, 356): ⚠️ **FAILED** - Facility not found (2x)
- **LoanClosed** (Block 356): ✅ Successfully processed

---

## 2. Critical Gaps Identified

### Gap 1: Race Condition - CreditFacilityContract Creation Timing ⚠️ CRITICAL

**Problem**: 
- CreditFacility module is created at block 311
- The `ModuleCreated` handler tries to create `CreditFacilityContract` entity but Market doesn't exist yet
- CreditFacility events (LoanCreated, LoanRepaid) fire at blocks 353, 355, 356 but the facility entity was never created
- Result: 3 loan events are skipped, data loss occurs

**Root Cause**:
```typescript:src/factory-handlers.ts
// Line 95-117: CreditFacility creation depends on Market existing
if (moduleType === 'creditFacility') {
  const market = await context.Market.get(marketId)  // marketId = orchestrator
  if (market) {
    // Create facility...
  } else {
    context.log.warn(`Market not found for creditFacility | marketId=${marketId}`)
    // ⚠️ Facility is NEVER created, but events will still fire!
  }
}
```

**Evidence from Logs**:
- Line 265: `[ModuleCreated] Market not found for creditFacility | marketId=0xa5e3bfa98103595c9ce1565913e0c810b178ff72`
- Line 447: `[LoanCreated] Facility not found | facilityId=0xAB73095BAc270EB0d173d2B1AD7e5be19064bbEc`
- Line 475: `[LoanRepaid] Facility not found | facilityId=0xAB73095BAc270EB0d173d2B1AD7e5be19064bbEc` (2x)

**Impact**: 
- Loan data is lost (3 loan events skipped)
- Facility statistics are incorrect
- User positions may be incomplete

### Gap 2: Missing Logging in Critical Paths

**Problem**: Several handlers lack sufficient logging to diagnose issues:

1. **ModuleRegistry Creation**: No log when registry is created vs updated
2. **Market Creation**: No log showing which path was taken (new vs existing)
3. **Token Fetching**: No log when RPC calls fail or succeed
4. **Facility Creation**: No log when facility creation is skipped

**Impact**: Difficult to debug timing issues and understand execution flow

### Gap 3: Market ID Mismatch Risk

**Problem**: 
- `ModuleCreated` handler uses `orchestrator` as `marketId` (line 57)
- `TokensBought/TokensSold` handlers use `event.srcAddress` (BC module address) as `marketId` (line 25)
- These may not match if orchestrator ≠ BC module address

**Evidence**:
- Floor module address: `0xA5e3bFA98103595c9cE1565913e0c810B178fF72`
- Market ID used: `0xa5e3bfa98103595c9ce1565913e0c810b178ff72` (same, but case-sensitive comparison could fail)

**Impact**: Potential for Market entity lookup failures

### Gap 4: Incomplete Handler Implementation

**Problem**: 
- `IssuanceTokensLocked` handler (line 162-171) only logs but doesn't update `UserMarketPosition.lockedCollateral`
- `IssuanceTokensUnlocked` handler (line 177-186) only logs but doesn't update position

**Impact**: User position data is incomplete

### Gap 5: Missing Error Recovery

**Problem**: 
- When `CreditFacilityContract` creation fails, there's no retry mechanism
- When `LoanCreated` fails due to missing facility, the event is permanently lost
- No mechanism to backfill missing entities

**Impact**: Permanent data loss for events that fire before entity creation

---

## 3. Recommended Changes

### Change 1: Fix CreditFacility Creation Race Condition

**Location**: `src/factory-handlers.ts` lines 94-118

**Current Code**:
```typescript
if (moduleType === 'creditFacility') {
  const market = await context.Market.get(marketId)
  if (market) {
    // Create facility...
  } else {
    context.log.warn(`Market not found for creditFacility | marketId=${marketId}`)
  }
}
```

**Recommended Fix**:
```typescript
if (moduleType === 'creditFacility') {
  // Try to get Market entity
  let market = await context.Market.get(marketId)
  
  // If Market doesn't exist, try to find it by BC module address
  // The orchestrator might be the BC module address
  if (!market) {
    // Try using module address as marketId (BC module = market)
    market = await context.Market.get(module.toLowerCase())
  }
  
  // If still not found, try to fetch from ModuleRegistry to find BC module
  if (!market) {
    const registry = await context.ModuleRegistry.get(marketId)
    if (registry) {
      // Look for floor module in registry (if it exists)
      // Note: This may not exist yet if floor module created after creditFacility
      context.log.debug(
        `[ModuleCreated] Registry found but no Market | registry=${JSON.stringify(registry)}`
      )
    }
  }
  
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
    // Create facility with placeholder tokens - will be updated when Market is created
    // This prevents event loss
    const facilityId = module.toLowerCase()
    const facility = {
      id: facilityId,
      collateralToken_id: 'unknown-collateral', // Placeholder
      borrowToken_id: 'unknown-borrow', // Placeholder
      totalLoans: 0n,
      totalVolumeRaw: 0n,
      totalVolumeFormatted: '0',
      createdAt: BigInt(event.block.timestamp),
    }
    context.CreditFacilityContract.set(facility)
    context.log.warn(
      `[ModuleCreated] CreditFacility created with placeholder tokens | id=${facilityId} | marketId=${marketId} | Will update when Market is available`
    )
  }
}
```

**Alternative Approach**: Defer CreditFacility creation until Market exists by checking in a later batch or using a retry mechanism.

---

## 4. Credit Facility Re-index Checklist

Follow this checklist after deploying fixes so CreditFacility data is rebuilt from block 0:

1. Stop any running indexer processes and delete persisted state to force a full replay:
   ```bash
   pkill -9 -f "ts-node\|envio\|bun dev" || true
   lsof -ti:9898 | xargs kill -9 2> /dev/null || true
   rm -f generated/persisted_state.envio.json
   ```
2. Export the logging env vars, then start the indexer (e.g. `TUI_OFF=true LOG_LEVEL=debug LOG_STRATEGY=console-pretty bun dev > /tmp/indexer.log 2>&1 &`) and wait ~45s for the initial sync.
3. Verify that a `CreditFacilityContract` row exists for each facility:
   ```bash
   curl -s http://localhost:8080/v1/graphql \
     -H "Content-Type: application/json" \
     -d '{"query":"{ CreditFacilityContract { id borrowToken_id collateralToken_id } }"}' | python3 -m json.tool
   ```
4. Confirm that handler logs no longer emit `Facility not found` warnings:
   ```bash
   grep "Facility not found" /tmp/indexer.log || echo "No missing facility warnings"
   ```
5. Run the quick sanity query for loans to ensure events were persisted:
   ```bash
   curl -s http://localhost:8080/v1/graphql \
     -H "Content-Type: application/json" \
     -d '{"query":"{ Loan { id facility_id status } }"}' | python3 -m json.tool
   ```
If any step fails, repeat the cleanup and restart to guarantee the registry/market/facility entities are rebuilt before credit facility events replay.

### Change 2: Add Comprehensive Logging

**Location**: Multiple files

#### 2a. ModuleRegistry Creation (`src/helpers/registry.ts`)
```typescript
export async function getOrCreateModuleRegistry(...) {
  const existingRegistry = await context.ModuleRegistry.get(normalizedMarketId)
  
  if (existingRegistry) {
    context.log.debug(
      `[getOrCreateModuleRegistry] Updating existing registry | marketId=${normalizedMarketId} | moduleType=${moduleType} | module=${normalizedModule}`
    )
  } else {
    context.log.info(
      `[getOrCreateModuleRegistry] Creating new registry | marketId=${normalizedMarketId} | moduleType=${moduleType} | module=${normalizedModule}`
    )
  }
  
  // ... rest of function
}
```

#### 2b. Market Creation (`src/helpers/market.ts`)
```typescript
export async function getOrCreateMarket(...) {
  let market = await context.Market.get(normalizedMarketId)
  
  if (market) {
    context.log.debug(
      `[getOrCreateMarket] Market exists | id=${normalizedMarketId} | reserveToken=${market.reserveToken_id} | issuanceToken=${market.issuanceToken_id}`
    )
    return market
  }
  
  context.log.info(
    `[getOrCreateMarket] Creating new market | id=${normalizedMarketId} | bcAddress=${bcAddress || 'none'} | reserveToken=${reserveTokenId || 'fetching'} | issuanceToken=${issuanceTokenId || 'fetching'}`
  )
  
  // ... rest of function
  
  context.log.info(
    `[getOrCreateMarket] ✅ Market created | id=${market.id} | reserveToken=${market.reserveToken_id} | issuanceToken=${market.issuanceToken_id}`
  )
  
  return market
}
```

#### 2c. Token Fetching (`src/helpers/token.ts` - if exists)
```typescript
// Add logging when fetching token addresses from BC contract
context.log.debug(
  `[fetchTokenAddressesFromBC] Fetching tokens | chainId=${chainId} | bcAddress=${bcAddress}`
)
// ... RPC call ...
if (tokenAddresses) {
  context.log.info(
    `[fetchTokenAddressesFromBC] ✅ Tokens fetched | reserveToken=${tokenAddresses.reserveToken} | issuanceToken=${tokenAddresses.issuanceToken}`
  )
} else {
  context.log.warn(
    `[fetchTokenAddressesFromBC] ⚠️ Failed to fetch tokens | bcAddress=${bcAddress}`
  )
}
```

### Change 3: Implement Missing Handler Logic

**Location**: `src/credit-handlers.ts` lines 162-186

**Current Code**:
```typescript
CreditFacility.IssuanceTokensLocked.handler(
  handlerErrorWrapper(async ({ event, context }) => {
    context.log.info(`[IssuanceTokensLocked] Handler invoked | ...`)
    const user = await getOrCreateAccount(context, event.params.user_)
    context.log.debug(`[IssuanceTokensLocked] Updating portfolio | userId=${user.id}`)
    // ⚠️ Missing: Actual position update logic
  })
)
```

**Recommended Fix**:
```typescript
CreditFacility.IssuanceTokensLocked.handler(
  handlerErrorWrapper(async ({ event, context }) => {
    context.log.info(
      `[IssuanceTokensLocked] Handler invoked | facility=${event.srcAddress} | user=${event.params.user_} | amount=${event.params.amount_}`
    )
    
    const facilityId = event.srcAddress.toLowerCase()
    const facility = await context.CreditFacilityContract.get(facilityId)
    
    if (!facility) {
      context.log.warn(`[IssuanceTokensLocked] Facility not found | facilityId=${facilityId}`)
      return
    }
    
    const collateralToken = await context.Token.get(facility.collateralToken_id)
    if (!collateralToken) {
      context.log.warn(`[IssuanceTokensLocked] Collateral token not found | tokenId=${facility.collateralToken_id}`)
      return
    }
    
    // Find the market associated with this facility
    // Need to find Market where issuanceToken_id matches facility.collateralToken_id
    // This requires a query or helper function
    const market = await findMarketByIssuanceToken(context, facility.collateralToken_id)
    
    if (!market) {
      context.log.warn(`[IssuanceTokensLocked] Market not found for collateral token | tokenId=${facility.collateralToken_id}`)
      return
    }
    
    const user = await getOrCreateAccount(context, event.params.user_)
    const position = await getOrCreateUserMarketPosition(
      context,
      user.id,
      market.id,
      collateralToken.decimals
    )
    
    const amountFormatted = formatAmount(event.params.amount_, collateralToken.decimals)
    const updatedPosition = {
      ...position,
      lockedCollateralRaw: position.lockedCollateralRaw + event.params.amount_,
      lockedCollateralFormatted: formatAmount(
        position.lockedCollateralRaw + event.params.amount_,
        collateralToken.decimals
      ).formatted,
      lastUpdatedAt: BigInt(event.block.timestamp),
    }
    
    context.UserMarketPosition.set(updatedPosition)
    context.log.info(
      `[IssuanceTokensLocked] ✅ Position updated | userId=${user.id} | marketId=${market.id} | lockedCollateral=${updatedPosition.lockedCollateralFormatted}`
    )
  })
)
```

**Note**: Requires helper function `findMarketByIssuanceToken` or query mechanism.

### Change 4: Add Defensive Facility Lookup in Loan Handlers

**Location**: `src/credit-handlers.ts` lines 11-73

**Current Code**:
```typescript
const facilityId = event.srcAddress
const facility = await context.CreditFacilityContract.get(facilityId)

if (!facility) {
  context.log.warn(`[LoanCreated] Facility not found | facilityId=${facilityId} - skipping event`)
  return
}
```

**Recommended Fix**:
```typescript
const facilityId = event.srcAddress.toLowerCase()
let facility = await context.CreditFacilityContract.get(facilityId)

if (!facility) {
  // Try to create facility from ModuleRegistry if it exists
  // This handles the case where CreditFacility was created before Market
  context.log.warn(
    `[LoanCreated] Facility not found, attempting recovery | facilityId=${facilityId}`
  )
  
  // Try to find Market via ModuleRegistry
  // This is a fallback - ideally facility should exist
  // For now, log error and skip, but add detailed logging
  context.log.error(
    `[LoanCreated] ⚠️ CRITICAL: Facility missing, event will be lost | facilityId=${facilityId} | block=${event.block.number} | tx=${event.transaction.hash}`
  )
  return
}
```

**Better Approach**: Implement a recovery mechanism that creates the facility on-demand when a loan event fires, using data from the event and ModuleRegistry.

### Change 5: Add Batch Processing Logging

**Location**: Add logging at batch boundaries to understand event ordering

**Recommended**: Add logging in the indexer's batch processing logic (if accessible) or add handler-level batch markers:

```typescript
// At start of each handler, log batch context
context.log.debug(
  `[Handler] Processing event | handler=${handlerName} | block=${event.block.number} | logIndex=${event.logIndex} | batchSize=${batchSize}`
)
```

---

## 4. Logging Placement Recommendations

### Critical Logging Points

1. **Entity Creation/Update Boundaries**
   - When Market is created vs retrieved
   - When CreditFacilityContract is created vs retrieved
   - When ModuleRegistry is created vs updated

2. **Cross-Entity Dependencies**
   - When CreditFacility handler looks for Market
   - When Loan handlers look for CreditFacilityContract
   - When Market handlers look for Tokens

3. **RPC Call Boundaries**
   - Before/after token address fetching
   - Success/failure of RPC calls

4. **Event Processing Order**
   - Log block number and log index at handler entry
   - Log when events are skipped vs processed

5. **Error Recovery Points**
   - When fallback logic is triggered
   - When placeholder entities are created
   - When events are permanently lost

### Specific Logging Additions

#### In `src/factory-handlers.ts`:
- Line 60: Log registry creation vs update
- Line 71: Log RPC token fetch attempt
- Line 83: Log market creation vs retrieval
- Line 97: Log market lookup for creditFacility (with all attempted IDs)
- Line 109: Log facility creation success
- Line 114: Log facility creation failure with context

#### In `src/credit-handlers.ts`:
- Line 18: Log facility lookup with normalization
- Line 21: Log facility not found with recovery attempt
- Line 27: Log token lookups
- Line 50: Log borrower account creation
- Line 69: Log loan creation success with full context

#### In `src/market-handlers.ts`:
- Line 29: Log market lookup/creation
- Line 49: Log token verification
- Line 72: Log account creation
- Line 99: Log trade creation with full details

---

## 5. Testing Recommendations

1. **Test CreditFacility Creation Order**:
   - Create CreditFacility module before Market exists
   - Verify facility is created with placeholder tokens
   - Verify facility is updated when Market becomes available

2. **Test Event Processing Order**:
   - Verify events process in block/logIndex order
   - Verify handlers can access entities created in same batch

3. **Test Recovery Mechanisms**:
   - Test LoanCreated handler when facility doesn't exist
   - Verify recovery logic creates facility on-demand

4. **Test Logging Coverage**:
   - Verify all critical paths have logging
   - Verify logs contain enough context to debug issues

---

## 6. Summary of Gaps

| Gap | Severity | Impact | Status |
|-----|----------|--------|--------|
| CreditFacility creation race condition | 🔴 CRITICAL | Data loss (3 loan events) | Needs fix |
| Missing logging in critical paths | 🟡 MEDIUM | Difficult debugging | Needs improvement |
| Market ID mismatch risk | 🟡 MEDIUM | Potential lookup failures | Needs validation |
| Incomplete handler implementations | 🟡 MEDIUM | Incomplete user positions | Needs completion |
| Missing error recovery | 🟡 MEDIUM | Permanent data loss | Needs mechanism |

---

## 7. Next Steps

1. **Immediate**: Fix CreditFacility creation race condition (Change 1)
2. **Short-term**: Add comprehensive logging (Change 2)
3. **Short-term**: Complete handler implementations (Change 3)
4. **Medium-term**: Add error recovery mechanisms (Change 4)
5. **Ongoing**: Monitor logs for similar issues

---

## Appendix: Log Event Timeline

```
Block 310: Floor_v1 module created
Block 310: AUT_Roles_v2 module created  
Block 310: SplitterTreasury_v1 module created
Block 311: CreditFacility_v1 module created ⚠️ Market not found
Block 345: TokensBought ✅
Block 347: TokensSold ✅
Block 351: VirtualCollateralAmountAdded ✅
Block 353: IssuanceTokensLocked ✅
Block 353: VirtualCollateralAmountSubtracted ✅
Block 353: LoanCreated ⚠️ Facility not found
Block 355: VirtualCollateralAmountAdded ✅
Block 355: LoanRepaid ⚠️ Facility not found
Block 356: VirtualCollateralAmountAdded ✅
Block 356: LoanRepaid ⚠️ Facility not found
Block 356: LoanClosed ✅ (works because doesn't need facility)
```

**Key Insight**: CreditFacility events fire 42-45 blocks after module creation, but facility entity was never created due to missing Market at block 311.

