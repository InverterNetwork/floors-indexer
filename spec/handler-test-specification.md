# Handler Test Specification

This document specifies the test cases for validating the Floor Markets indexer handlers against actual transaction data.

## Test Data from Deployment

### Token Addresses
- **USDC (Reserve Token)**: `0xe8f7d98be6722d42f29b50500b0e318ef2be4fc8`
  - Decimals: 6
  - Name: "Test USDC"
  - Symbol: "TUSDC"
  
- **FLOOR (Issuance Token)**: `0xe38b6847e611e942e6c80ed89ae867f522402e80`
  - Decimals: 18
  - Name: "Floor Token"
  - Symbol: "FLOOR"

### Market Address
- **Orchestrator/Market**: `0x8265551ebb0f42521a591590ef1fefc3d34f851d`
- **BC Module (Funding Manager)**: `0x8265551ebb0f42521a591590ef1fefc3d34f851d` (same as orchestrator)

### Test Transaction Values

#### Buy Operation
- **Input**: 10,000,000 USDC (10 USDC with 6 decimals)
- **Output**: 9,900,000 FLOOR tokens (9.9 FLOOR with 18 decimals)
- **Fee**: 100,000 USDC (0.1 USDC, 1% fee)
- **Expected**: Trade entity created with correct amounts, MarketState updated

#### Sell Operation
- **Input**: 4,950,000 FLOOR tokens (4.95 FLOOR with 18 decimals)
- **Output**: 4,900,500 USDC (4.900500 USDC with 6 decimals)
- **Fee**: ~49,500 FLOOR tokens (0.0495 FLOOR, 1% fee)
- **Expected**: Trade entity created with correct amounts, MarketState updated

## Expected Behavior

### ModuleCreated Event Handler

When a `ModuleCreated` event is emitted for a BC (bonding curve) module:

1. **ModuleRegistry** entity should be created/updated with:
   - `id`: orchestrator address
   - `market_id`: orchestrator address
   - `fundingManager`: module address (when moduleType is 'fundingManager')
   - `createdAt`: event block timestamp
   - `lastUpdatedAt`: event block timestamp

2. **Market** entity should be created with:
   - `id`: orchestrator address
   - `reserveToken_id`: USDC token address
   - `issuanceToken_id`: FLOOR token address
   - `creator_id`: orchestrator address (or actual creator if available)
   - `createdAt`: event block timestamp

3. **MarketState** entity should be created with:
   - `id`: orchestrator address
   - `market_id`: orchestrator address
   - All monetary fields initialized to 0
   - `status`: ACTIVE
   - `isBuyOpen`: true
   - `isSellOpen`: true

### TokensBought Event Handler

When a `TokensBought` event is emitted:

1. **Trade** entity should be created with:
   - `id`: `${transactionHash}-${logIndex}`
   - `market_id`: market address
   - `user_id`: receiver/buyer address
   - `tradeType`: BUY
   - `tokenAmountRaw`: receivedAmount_ (9,900,000 for test case)
   - `tokenAmountFormatted`: "9.9" (formatted with 18 decimals)
   - `reserveAmountRaw`: depositAmount_ (10,000,000 for test case)
   - `reserveAmountFormatted`: "10" (formatted with 6 decimals)
   - `feeRaw`: calculated fee amount
   - `feeFormatted`: formatted fee string
   - `newPriceRaw`: current price after trade
   - `newPriceFormatted`: formatted price string
   - `timestamp`: event block timestamp
   - `transactionHash`: transaction hash

2. **MarketState** should be updated:
   - `totalSupplyRaw`: increased by receivedAmount_
   - `marketSupplyRaw`: increased by receivedAmount_
   - `currentPriceRaw`: updated to new price
   - `lastTradeTimestamp`: event block timestamp
   - `lastUpdatedAt`: event block timestamp

3. **UserMarketPosition** should be updated:
   - `fTokenBalanceRaw`: increased by receivedAmount_
   - `reserveBalanceRaw`: decreased by depositAmount_
   - `lastUpdatedAt`: event block timestamp

### TokensSold Event Handler

When a `TokensSold` event is emitted:

1. **Trade** entity should be created with:
   - `id`: `${transactionHash}-${logIndex}`
   - `market_id`: market address
   - `user_id`: receiver/seller address
   - `tradeType`: SELL
   - `tokenAmountRaw`: depositAmount_ (4,950,000 for test case)
   - `tokenAmountFormatted`: "4.95" (formatted with 18 decimals)
   - `reserveAmountRaw`: receivedAmount_ (4,900,500 for test case)
   - `reserveAmountFormatted`: "4.900500" (formatted with 6 decimals)
   - `feeRaw`: calculated fee amount
   - `feeFormatted`: formatted fee string
   - `newPriceRaw`: current price after trade
   - `newPriceFormatted`: formatted price string
   - `timestamp`: event block timestamp
   - `transactionHash`: transaction hash

2. **MarketState** should be updated:
   - `totalSupplyRaw`: decreased by depositAmount_
   - `marketSupplyRaw`: decreased by depositAmount_
   - `currentPriceRaw`: updated to new price
   - `lastTradeTimestamp`: event block timestamp
   - `lastUpdatedAt`: event block timestamp

3. **UserMarketPosition** should be updated:
   - `fTokenBalanceRaw`: decreased by depositAmount_
   - `reserveBalanceRaw`: increased by receivedAmount_
   - `lastUpdatedAt`: event block timestamp

## Test Cases

### Test Case 1: Module Creation Initializes Entities

**Setup**: Empty mock database

**Action**: Process ModuleCreated event for BC module

**Assertions**:
- ModuleRegistry exists with correct fundingManager address
- Market entity exists with correct token addresses
- MarketState entity exists with initial zero values
- Token entities exist with correct decimals (6 for USDC, 18 for FLOOR)

### Test Case 2: Buy Operation Creates Trade and Updates State

**Setup**: Mock database with Market and MarketState entities

**Action**: Process TokensBought event with test values

**Assertions**:
- Trade entity created with correct amounts
- MarketState.totalSupplyRaw increased by 9,900,000
- MarketState.marketSupplyRaw increased by 9,900,000
- UserMarketPosition.fTokenBalanceRaw increased by 9,900,000
- UserMarketPosition.reserveBalanceRaw decreased by 10,000,000
- Token amounts formatted correctly (9.9 for FLOOR, 10 for USDC)

### Test Case 3: Sell Operation Creates Trade and Updates State

**Setup**: Mock database with Market, MarketState, and UserMarketPosition (with tokens)

**Action**: Process TokensSold event with test values

**Assertions**:
- Trade entity created with correct amounts
- MarketState.totalSupplyRaw decreased by 4,950,000
- MarketState.marketSupplyRaw decreased by 4,950,000
- UserMarketPosition.fTokenBalanceRaw decreased by 4,950,000
- UserMarketPosition.reserveBalanceRaw increased by 4,900,500
- Token amounts formatted correctly (4.95 for FLOOR, 4.900500 for USDC)

### Test Case 4: Race Condition - Trade Before Market Created

**Setup**: Empty mock database

**Action**: Process TokensBought event before ModuleCreated event

**Assertions**:
- Handler should gracefully handle missing Market/MarketState
- Either create entities defensively or skip processing
- No errors thrown

### Test Case 5: Token Decimals Used Correctly

**Assertions**:
- USDC amounts formatted with 6 decimals
- FLOOR amounts formatted with 18 decimals
- formatAmount helper correctly handles different decimal places

## Known Issues to Test

1. **Empty Token Addresses**: Verify tokens are created with actual addresses, not empty strings
2. **Zero Price/Fee Values**: Verify prices and fees are fetched from contract or calculated, not hardcoded to 0
3. **Early Returns**: Verify handlers don't silently fail when entities are missing
4. **Token Metadata**: Verify token decimals are correctly fetched and stored

## Success Criteria

- [ ] All test cases pass
- [ ] Trade entities created with correct amounts
- [ ] MarketState shows non-zero prices and supplies after trades
- [ ] Token decimals correctly applied (6 for USDC, 18 for FLOOR)
- [ ] UserMarketPosition tracks balances accurately
- [ ] No silent failures or early returns that drop events

