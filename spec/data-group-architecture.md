# Indexer Data Group Architecture

Three-tier data organization optimizing query performance and contract discovery through update frequency separation.

## Data Groups

| Group | Updates | Purpose | Payload Reduction |
|-------|---------|---------|-------------------|
| **User** | On user actions | Portfolio positions & aggregations | Query only when wallet connected |
| **Static** | On deployment/config | Contract metadata & module addresses | 60-80% reduction via one-time fetch |
| **Dynamic** | Real-time | Market state, trades, events | Poll frequently, small payloads |

**Key Benefit**: ModuleRegistry enables single-query contract discovery (eliminates factory event filtering)

## Module Registration

**Flow**: Market Factory → ModuleFactory emits `ModuleCreated(orchestrator, module, metadata)` → Indexer maps modules → Frontend queries

### Event Processing

```typescript
// Handler Implementation (factory-handlers.ts)
import { ModuleFactory } from '../generated/src/Handlers.gen'
import { extractModuleType } from './helpers'

ModuleFactory.ModuleCreated.handler(async ({ event, context }) => {
  // ModuleCreated event has: orchestrator, module, metadata
  // metadata is a tuple: [majorVersion, minorVersion, patchVersion, url, title]
  const orchestrator = event.params.orchestrator
  const module = event.params.module
  const metadata = event.params.metadata
  const marketId = orchestrator // orchestrator is the floor/market address

  // Get or create ModuleRegistry for this market
  const existingRegistry = await context.ModuleRegistry.get(marketId)

  // Extract module type from metadata title (metadata[4] is the title)
  const title = metadata[4]
  const moduleType = extractModuleType(title)

  // Create or update registry with new module address
  // Note: Entities are readonly, so we create a new object
  const registry = {
    id: marketId,
    market_id: marketId,
    fundingManager: moduleType === 'fundingManager' ? module : (existingRegistry?.fundingManager || ''),
    authorizer: moduleType === 'authorizer' ? module : (existingRegistry?.authorizer || ''),
    feeTreasury: moduleType === 'feeTreasury' ? module : (existingRegistry?.feeTreasury || ''),
    creditFacility: moduleType === 'creditFacility' ? module : (existingRegistry?.creditFacility || ''),
    presale: moduleType === 'presale' ? module : (existingRegistry?.presale || ''),
    staking: moduleType === 'staking' ? module : (existingRegistry?.staking || ''),
    createdAt: existingRegistry?.createdAt || BigInt(event.block.timestamp),
    lastUpdatedAt: BigInt(event.block.timestamp),
  }

  context.ModuleRegistry.set(registry)
})

// Helper function (helpers.ts)
export function extractModuleType(title: string): string {
  const lower = title.toLowerCase()
  
  if (lower.includes('creditfacility')) return 'creditFacility'
  if (lower.includes('treasury') || lower.includes('splitter')) return 'feeTreasury'
  if (lower.includes('presale')) return 'presale'
  if (lower.includes('staking')) return 'staking'
  
  const prefix = title.split('_')[0]
  const prefixMap: Record<string, string> = {
    BC: 'fundingManager',
    AUT: 'authorizer',
  }
  
  return prefixMap[prefix] || 'unknown'
}
```

### Module Type Mapping

| Title Pattern | Registry Field | Example | Required |
|--------------|----------------|---------|----------|
| `BC_*` | `fundingManager` | `BC_Discrete_Redeeming_VirtualSupply_v1` | ✅ |
| `AUT_*` | `authorizer` | `AUT_Roles_v2` | ✅ |
| `*Treasury*` | `feeTreasury` | `SplitterTreasury_v1` | ✅ |
| `*CreditFacility*` | `creditFacility` | `CreditFacility_v1` | Optional |
| `*Presale*` | `presale` | `PresaleModule_v1` | Optional |
| `*Staking*` | `staking` | `StakingModule_v1` | Optional |

**Race Conditions**: Handler creates ModuleRegistry on first event, populates fields as subsequent events arrive. Market relationship resolves via `market_id` field (no `@derivedFrom` for 1:1 relationships in Envio).

### Dynamic Contract Registration

Contracts discovered via `ModuleCreated` events **do not need addresses** in `config.yaml`. They are registered automatically as events are processed.

**Config Pattern**:
```yaml
contracts:
  - name: ModuleFactory
    abi_file_path: abis/ModuleFactory_v1.json
    handler: src/index.ts
    events:
      - event: ModuleCreated

  - name: FloorMarket
    abi_file_path: abis/BC_Discrete_Redeeming_VirtualSupply_v1.json
    handler: src/index.ts
    events:
      - event: TokensBought
      - event: TokensSold
      # ... more events

networks:
  - id: 31337
    contracts:
      - name: ModuleFactory
        address: '0x...'  # Factory has fixed address
      - name: FloorMarket
        address:  # Empty - discovered dynamically
      - name: CreditFacility
        address:  # Empty - discovered dynamically
```

### Frontend Usage

```typescript
// Single query gets all module addresses
const { moduleRegistry } = await client.request(`
  query { moduleRegistry(id: $marketId) {
    fundingManager authorizer feeTreasury
    creditFacility presale staking
  }}
`)

// Use with viem for RPC calls
const price = await viemClient.readContract({
  address: moduleRegistry.fundingManager,
  abi: BondingCurveABI,
  functionName: 'getCurrentPrice'
})

// Check optional modules
if (moduleRegistry.creditFacility) {
  // Enable lending UI
}
```

---

## Schema Design

### Core Types & Conventions

**Important**: Envio requires all `type` definitions to be entities with `id` fields. We cannot use embedded types like `Amount`. Instead, monetary values are stored as separate `{field}Raw: BigInt!` and `{field}Formatted: String!` fields.

```graphql
# Token type (entity with id)
type Token {
  id: ID!
  name: String!
  symbol: String!
  decimals: Int!
}

# Enums for status fields
enum MarketStatus { ACTIVE PAUSED CLOSED }
enum TradeType { BUY SELL }
enum LoanStatus { ACTIVE REPAID DEFAULTED }
enum StakeStatus { ACTIVE UNSTAKED LOCKED }
enum CandlePeriod { ONE_HOUR FOUR_HOURS ONE_DAY }
```

**Conventions**:
- Events: `id` (txHash-logIndex), `timestamp`, `transactionHash`
- Contracts: `id` (address), `createdAt`
- All monetary fields use `{field}Raw: BigInt!` and `{field}Formatted: String!` (never just `BigInt!`)
- All status fields use enums (never `String!`)
- Frontend calculates USD from `{field}Raw` + external oracles
- 1:1 relationships use `{entity}_id: ID!` fields instead of `@derivedFrom` (Envio limitation)

## Schema by Data Group

### 1. User Group (Query only when wallet connected)

```graphql
type Account {
  id: ID!  # User address
  # @derivedFrom: marketsCreated, trades, loans, stakes, presaleParticipations, userMarketPositions
}

type UserMarketPosition {
  id: ID!  # userAddress-marketAddress
  user_id: ID!
  market_id: ID!
  fTokenBalanceRaw: BigInt!
  fTokenBalanceFormatted: String!
  reserveBalanceRaw: BigInt!
  reserveBalanceFormatted: String!
  totalDebtRaw: BigInt!
  totalDebtFormatted: String!
  lockedCollateralRaw: BigInt!
  lockedCollateralFormatted: String!
  stakedAmountRaw: BigInt!
  stakedAmountFormatted: String!
  claimableRewardsRaw: BigInt!
  claimableRewardsFormatted: String!
  presaleDepositRaw: BigInt!
  presaleDepositFormatted: String!
  presaleLeverage: BigInt!
  lastUpdatedAt: BigInt!
}

type UserPortfolioSummary {
  id: ID!  # userAddress
  user_id: ID!
  totalPortfolioValueRaw: BigInt!
  totalPortfolioValueFormatted: String!
  totalDebtRaw: BigInt!
  totalDebtFormatted: String!
  totalCollateralValueRaw: BigInt!
  totalCollateralValueFormatted: String!
  totalStakedValueRaw: BigInt!
  totalStakedValueFormatted: String!
  activeMarkets: BigInt!
  activeLoans: BigInt!
  activeStakes: BigInt!
  lastUpdatedAt: BigInt!
}
```

### 2. Static Group (Fetch once, cache client-side)

```graphql
type Market {
  id: ID!  # Market address (same as fundingManager/orchestrator)
  name: String!
  symbol: String!
  description: String!
  creator_id: ID!
  factory_id: ID!
  reserveToken_id: ID!
  issuanceToken_id: ID!
  initialPriceRaw: BigInt!
  initialPriceFormatted: String!
  tradingFeeBps: BigInt!
  maxLTV: BigInt!
  maxSupplyRaw: BigInt!
  maxSupplyFormatted: String!
  createdAt: BigInt!
  # @derivedFrom: trades, floorElevations, feeDistributions
}

type ModuleRegistry {
  id: ID!  # Market address
  market_id: ID!
  fundingManager: String!  # BC address
  authorizer: String!      # AUT address
  feeTreasury: String!     # Treasury address
  creditFacility: String   # Optional
  presale: String          # Optional
  staking: String          # Optional
  createdAt: BigInt!
  lastUpdatedAt: BigInt!
}

type FactoryContract {
  id: ID!
  totalMarkets: BigInt!
  creationFeeRaw: BigInt!
  creationFeeFormatted: String!
  feeCollector: String!
  createdAt: BigInt!
  # @derivedFrom: markets
}

type CreditFacilityContract {
  id: ID!
  collateralToken_id: ID!
  borrowToken_id: ID!
  totalLoans: BigInt!
  totalVolumeRaw: BigInt!
  totalVolumeFormatted: String!
  createdAt: BigInt!
  # @derivedFrom: loans
}

type StakingContract {
  id: ID!
  stakingToken_id: ID!
  rewardToken_id: ID!
  totalStakedRaw: BigInt!
  totalStakedFormatted: String!
  totalRewardsRaw: BigInt!
  totalRewardsFormatted: String!
  createdAt: BigInt!
  # @derivedFrom: stakes
}

type PreSaleContract {
  id: ID!
  saleToken_id: ID!
  purchaseToken_id: ID!
  startTime: BigInt!
  endTime: BigInt!
  maxLeverage: BigInt!
  totalRaisedRaw: BigInt!
  totalRaisedFormatted: String!
  totalParticipants: BigInt!
  createdAt: BigInt!
  # @derivedFrom: participations
}
```

### 3. Dynamic Group (Poll frequently, small payloads)

```graphql
type MarketState {  # Updated every trade/elevation
  id: ID!  # Same as Market id
  market_id: ID!
  currentPriceRaw: BigInt!
  currentPriceFormatted: String!
  floorPriceRaw: BigInt!
  floorPriceFormatted: String!
  totalSupplyRaw: BigInt!
  totalSupplyFormatted: String!
  marketSupplyRaw: BigInt!
  marketSupplyFormatted: String!
  floorSupplyRaw: BigInt!
  floorSupplyFormatted: String!
  status: MarketStatus!
  isBuyOpen: Boolean!
  isSellOpen: Boolean!
  lastTradeTimestamp: BigInt!
  lastElevationTimestamp: BigInt!
  lastUpdatedAt: BigInt!
}

type Trade {  # id: txHash-logIndex
  id: ID!
  market_id: ID!
  user_id: ID!
  tradeType: TradeType!
  tokenAmountRaw: BigInt!
  tokenAmountFormatted: String!
  reserveAmountRaw: BigInt!
  reserveAmountFormatted: String!
  feeRaw: BigInt!
  feeFormatted: String!
  newPriceRaw: BigInt!
  newPriceFormatted: String!
  timestamp: BigInt!
  transactionHash: String!
}

type FloorElevation {  # id: txHash-logIndex
  id: ID!
  market_id: ID!
  oldFloorPriceRaw: BigInt!
  oldFloorPriceFormatted: String!
  newFloorPriceRaw: BigInt!
  newFloorPriceFormatted: String!
  deployedAmountRaw: BigInt!
  deployedAmountFormatted: String!
  timestamp: BigInt!
  transactionHash: String!
}

type FeeDistribution {  # id: txHash-logIndex
  id: ID!
  market_id: ID!
  floorAmountRaw: BigInt!
  floorAmountFormatted: String!
  stakingAmountRaw: BigInt!
  stakingAmountFormatted: String!
  treasuryAmountRaw: BigInt!
  treasuryAmountFormatted: String!
  timestamp: BigInt!
  transactionHash: String!
}

type Loan {  # id: txHash-logIndex
  id: ID!
  borrower_id: ID!
  facility_id: ID!
  collateralAmountRaw: BigInt!
  collateralAmountFormatted: String!
  borrowAmountRaw: BigInt!
  borrowAmountFormatted: String!
  originationFeeRaw: BigInt!
  originationFeeFormatted: String!
  status: LoanStatus!
  timestamp: BigInt!
  transactionHash: String!
}

type Stake {  # id: txHash-logIndex
  id: ID!
  user_id: ID!
  contract_id: ID!
  amountRaw: BigInt!
  amountFormatted: String!
  lockDuration: BigInt!
  status: StakeStatus!
  timestamp: BigInt!
  transactionHash: String!
}

type PresaleParticipation {  # id: txHash-logIndex
  id: ID!
  user_id: ID!
  presale_id: ID!
  amountRaw: BigInt!
  amountFormatted: String!
  leverage: BigInt!
  timestamp: BigInt!
  transactionHash: String!
}

type MarketSnapshot {  # id: marketAddress-timestamp
  id: ID!
  market_id: ID!
  timestamp: BigInt!
  priceRaw: BigInt!
  priceFormatted: String!
  floorPriceRaw: BigInt!
  floorPriceFormatted: String!
  totalSupplyRaw: BigInt!
  totalSupplyFormatted: String!
  marketSupplyRaw: BigInt!
  marketSupplyFormatted: String!
  volume24hRaw: BigInt!
  volume24hFormatted: String!
  trades24h: BigInt!
}

type PriceCandle {  # id: marketAddress-period-timestamp
  id: ID!
  market_id: ID!
  period: CandlePeriod!
  timestamp: BigInt!
  openRaw: BigInt!
  openFormatted: String!
  highRaw: BigInt!
  highFormatted: String!
  lowRaw: BigInt!
  lowFormatted: String!
  closeRaw: BigInt!
  closeFormatted: String!
  volumeRaw: BigInt!
  volumeFormatted: String!
  trades: BigInt!
}
```

---

## Implementation Details

### Handler Organization

Handlers are organized by domain in separate files:

```
indexer/src/
├── index.ts              # Exports all handlers
├── helpers.ts            # Shared utilities
├── factory-handlers.ts   # ModuleFactory events
├── market-handlers.ts    # FloorMarket trading events
├── credit-handlers.ts    # CreditFacility loan events
├── staking-handlers.ts   # Staking events (commented until ABI available)
└── presale-handlers.ts   # Presale events (commented until ABI available)
```

### Type Safety

All handlers use generated types from Envio codegen:

```typescript
// Import generated handlers
import { ModuleFactory, FloorMarket, CreditFacility } from '../generated/src/Handlers.gen'

// Import generated types
import type { HandlerContext } from '../generated/src/Types'
import type { Account_t, Token_t, Market_t } from '../generated/src/db/Entities.gen'
import type { TradeType_t, LoanStatus_t } from '../generated/src/db/Enums.gen'

// Handlers are fully typed - no @ts-ignore needed
ModuleFactory.ModuleCreated.handler(async ({ event, context }) => {
  // event and context are properly typed
  const registry = await context.ModuleRegistry.get(marketId)
  // ...
})
```

### Helper Functions

```typescript
// helpers.ts
import type { HandlerContext } from '../generated/src/Types'
import type { Account_t, Token_t, UserMarketPosition_t } from '../generated/src/db/Entities.gen'

/**
 * Format a raw BigInt amount with decimals
 */
export function formatAmount(raw: bigint, decimals: number): { raw: bigint; formatted: string } {
  const divisor = BigInt(10 ** decimals)
  const whole = raw / divisor
  const fractional = raw % divisor
  const fractionalStr = fractional.toString().padStart(decimals, '0')
  
  // Remove trailing zeros from fractional part
  const trimmedFractional = fractionalStr.replace(/0+$/, '')
  const formatted = trimmedFractional ? `${whole}.${trimmedFractional}` : whole.toString()
  
  return { raw, formatted }
}

/**
 * Get or create Account entity
 */
export async function getOrCreateAccount(
  context: HandlerContext,
  address: string
): Promise<Account_t> {
  let account = await context.Account.get(address)
  if (!account) {
    account = { id: address }
    context.Account.set(account)
  }
  return account
}

/**
 * Get or create Token entity
 * TODO: Fetch ERC20 metadata via RPC call
 */
export async function getOrCreateToken(
  context: HandlerContext,
  address: string
): Promise<Token_t> {
  let token = await context.Token.get(address)
  if (!token) {
    // Placeholder - will need to implement RPC call to fetch name, symbol, decimals
    token = {
      id: address,
      name: 'Unknown Token',
      symbol: 'UNK',
      decimals: 18,
    }
    context.Token.set(token)
  }
  return token
}
```

### Event Handlers

#### Market Handlers (market-handlers.ts)

```typescript
// TokensBought event handler
FloorMarket.TokensBought.handler(async ({ event, context }) => {
  const market = await context.Market.get(event.srcAddress)
  if (!market) return

  const marketState = await context.MarketState.get(event.srcAddress)
  if (!marketState) return

  const reserveToken = await context.Token.get(market.reserveToken_id)
  const issuanceToken = await context.Token.get(market.issuanceToken_id)
  if (!reserveToken || !issuanceToken) return

  const userAddress = event.params.receiver_ || event.params.buyer_
  const user = await getOrCreateAccount(context, userAddress)

  // Create Trade entity
  const tokenAmount = formatAmount(event.params.receivedAmount_, issuanceToken.decimals)
  const reserveAmount = formatAmount(event.params.depositAmount_, reserveToken.decimals)
  
  const trade = {
    id: `${event.transaction.hash}-${event.logIndex}`,
    market_id: market.id,
    user_id: user.id,
    tradeType: 'BUY' as TradeType_t,
    tokenAmountRaw: event.params.receivedAmount_,
    tokenAmountFormatted: tokenAmount.formatted,
    reserveAmountRaw: event.params.depositAmount_,
    reserveAmountFormatted: reserveAmount.formatted,
    feeRaw: 0n, // TODO: Fetch from contract
    feeFormatted: '0',
    newPriceRaw: 0n, // TODO: Fetch from contract
    newPriceFormatted: '0',
    timestamp: BigInt(event.block.timestamp),
    transactionHash: event.transaction.hash,
  }
  context.Trade.set(trade)

  // Update MarketState
  const updatedMarketState = {
    ...marketState,
    totalSupplyRaw: marketState.totalSupplyRaw + event.params.receivedAmount_,
    totalSupplyFormatted: formatAmount(
      marketState.totalSupplyRaw + event.params.receivedAmount_,
      issuanceToken.decimals
    ).formatted,
    marketSupplyRaw: marketState.marketSupplyRaw + event.params.receivedAmount_,
    marketSupplyFormatted: formatAmount(
      marketState.marketSupplyRaw + event.params.receivedAmount_,
      issuanceToken.decimals
    ).formatted,
    lastTradeTimestamp: BigInt(event.block.timestamp),
    lastUpdatedAt: BigInt(event.block.timestamp),
  }
  context.MarketState.set(updatedMarketState)

  // Update UserMarketPosition
  const position = await getOrCreateUserMarketPosition(context, user.id, market.id, issuanceToken.decimals)
  const updatedPosition = {
    ...position,
    fTokenBalanceRaw: position.fTokenBalanceRaw + event.params.receivedAmount_,
    fTokenBalanceFormatted: formatAmount(
      position.fTokenBalanceRaw + event.params.receivedAmount_,
      issuanceToken.decimals
    ).formatted,
    reserveBalanceRaw: position.reserveBalanceRaw - event.params.depositAmount_,
    reserveBalanceFormatted: formatAmount(
      position.reserveBalanceRaw - event.params.depositAmount_,
      reserveToken.decimals
    ).formatted,
    lastUpdatedAt: BigInt(event.block.timestamp),
  }
  context.UserMarketPosition.set(updatedPosition)
})
```

#### Credit Handlers (credit-handlers.ts)

```typescript
// LoanCreated event handler
CreditFacility.LoanCreated.handler(async ({ event, context }) => {
  const facilityId = event.srcAddress
  let facility = await context.CreditFacilityContract.get(facilityId)

  if (!facility) {
    const collateralToken = await getOrCreateToken(context, '')
    const borrowToken = await getOrCreateToken(context, '')
    
    facility = {
      id: facilityId,
      collateralToken_id: collateralToken.id,
      borrowToken_id: borrowToken.id,
      totalLoans: 0n,
      totalVolumeRaw: 0n,
      totalVolumeFormatted: '0',
      createdAt: BigInt(event.block.timestamp),
    }
  }

  const borrowToken = await context.Token.get(facility.borrowToken_id)
  if (!borrowToken) return

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

  // Create Loan entity
  const borrower = await getOrCreateAccount(context, event.params.borrower_)
  const loan = {
    id: `${event.transaction.hash}-${event.logIndex}`,
    borrower_id: borrower.id,
    facility_id: facility.id,
    collateralAmountRaw: 0n, // TODO: Fetch from contract
    collateralAmountFormatted: '0',
    borrowAmountRaw: event.params.loanAmount_,
    borrowAmountFormatted: loanAmount.formatted,
    originationFeeRaw: 0n, // TODO: Fetch from contract
    originationFeeFormatted: '0',
    status: 'ACTIVE' as LoanStatus_t,
    timestamp: BigInt(event.block.timestamp),
    transactionHash: event.transaction.hash,
  }
  context.Loan.set(loan)
})
```

---

## Query Patterns

```graphql
# USER GROUP - Only when wallet connected
query UserPositions($user: ID!) {
  account(id: $user) {
    userMarketPositions {
      market { id symbol }
      fTokenBalanceRaw
      fTokenBalanceFormatted
      totalDebtRaw
      totalDebtFormatted
    }
    userPortfolioSummary {
      totalPortfolioValueRaw
      totalPortfolioValueFormatted
      totalDebtRaw
      totalDebtFormatted
      activeMarkets
    }
  }
}

# STATIC GROUP - Fetch once, cache forever
query MarketConfigs {
  markets {
    id name symbol description
    creator_id factory_id
    reserveToken_id issuanceToken_id
    initialPriceRaw initialPriceFormatted
    tradingFeeBps maxLTV createdAt
    moduleRegistry {
      fundingManager authorizer feeTreasury
      creditFacility presale staking
    }
  }
}

# DYNAMIC GROUP - Poll frequently
query MarketActivity($marketId: ID!) {
  marketState(id: $marketId) {
    currentPriceRaw currentPriceFormatted
    floorPriceRaw floorPriceFormatted
    totalSupplyRaw totalSupplyFormatted
    status isBuyOpen isSellOpen
  }
  trades(
    where: { market_id: $marketId }
    orderBy: timestamp
    orderDirection: desc
    first: 50
  ) {
    user_id tradeType
    tokenAmountRaw reserveAmountRaw
    newPriceRaw timestamp
  }
}
```

### Frontend Data Flow

```typescript
// Separate queries by update frequency
const static = await queryMarketConfigs()     // Cache forever
const dynamic = await queryMarketStates()     // Poll every 5s
const user = walletConnected ? await queryUserPositions() : null  // On connect

// Combine client-side with proper typing
const markets = static.map(config => ({
  ...config,
  ...dynamic.find(s => s.id === config.id),
  userPosition: user?.find(u => u.market.id === config.id)
}))
```

---

## Design Principles

### Data Group Separation
- **Market** = static config only (name, symbol, fees, tokens, etc.)
- **MarketState** = dynamic data only (prices, supplies, status)
- **Benefit**: 60-80% smaller payloads when querying static configs

### Naming Patterns
| Pattern | Rule | Example |
|---------|------|---------|
| Events | `id` (txHash-logIndex), `timestamp`, `transactionHash` | Trade, FloorElevation |
| Contracts | `id` (address), `createdAt`, ends with `Contract` | FactoryContract, CreditFacilityContract |
| Monetary | `{field}Raw: BigInt!` and `{field}Formatted: String!` | prices, balances, fees |
| Status | Always use enums (never `String!`) | MarketStatus, TradeType |
| Relationships | Use `{entity}_id: ID!` for 1:1, `@derivedFrom` for 1:many | `market_id`, `user_id` |

### Type Safety
- All handlers use generated types from `Handlers.gen.ts` and `Types.ts`
- No `@ts-ignore` comments - full type safety
- Entities are readonly - create new objects instead of mutating
- Use type assertions for enums: `'BUY' as TradeType_t`

### Dynamic Contract Registration
- Contracts discovered via events don't need addresses in config
- Empty `address:` field in networks section
- Envio automatically registers contracts as events are processed
- ModuleRegistry enables single-query contract discovery

---

## Implementation Checklist

### Schema (`indexer/schema.graphql`)
- [x] Core types: `Token`, enums (`MarketStatus`, `TradeType`, `LoanStatus`, `StakeStatus`, `CandlePeriod`)
- [x] Static group: `Market`, `ModuleRegistry`, `FactoryContract`, `CreditFacilityContract`, `StakingContract`, `PresaleContract`
- [x] Dynamic group: `MarketState`, `Trade`, `FloorElevation`, `FeeDistribution`, `Loan`, `Stake`, `PresaleParticipation`, `MarketSnapshot`, `PriceCandle`
- [x] User group: `Account`, `UserMarketPosition`, `UserPortfolioSummary`
- [x] Verify: All monetary = `{field}Raw` + `{field}Formatted`, all status = enums, `Market` has no dynamic fields
- [x] Removed legacy `YieldStrategy` type

### Config (`indexer/config.yaml`)
- [x] Add ModuleFactory contract + `ModuleCreated` event
- [x] Add FloorMarket contract with `TokensBought`, `TokensSold`, `VirtualCollateralAmountAdded`, `VirtualCollateralAmountSubtracted`
- [x] Add CreditFacility contract with `LoanCreated`, `LoanRepaid`, `LoanClosed`, `IssuanceTokensLocked`, `IssuanceTokensUnlocked`
- [x] Use `abi_file_path` instead of inline ABIs
- [x] Dynamic contracts have empty `address:` fields

### Handlers (`indexer/src/`)
- [x] `ModuleFactory.ModuleCreated` handler + `extractModuleType()` function
- [x] `FloorMarket.TokensBought` and `TokensSold` handlers
- [x] `FloorMarket.VirtualCollateralAmountAdded` and `VirtualCollateralAmountSubtracted` handlers
- [x] `CreditFacility.LoanCreated`, `LoanRepaid`, `LoanClosed` handlers
- [x] Format all monetary values using `formatAmount()` helper
- [x] Handle race conditions (ModuleCreated before MarketCreated)
- [x] Organize handlers by domain (factory, market, credit)
- [x] Remove all `@ts-ignore` comments
- [x] Full type safety with generated types

### Helpers (`indexer/src/helpers.ts`)
- [x] `formatAmount()` - Format BigInt with decimals
- [x] `extractModuleType()` - Map module titles to registry fields
- [x] `getOrCreateAccount()` - Account entity helper
- [x] `getOrCreateToken()` - Token entity helper (placeholder for RPC)
- [x] `getOrCreateUserMarketPosition()` - User position helper
- [x] `updateUserPortfolioSummary()` - Portfolio aggregation (placeholder)
- [x] `createMarketSnapshot()` - Historical snapshot helper
- [x] `updatePriceCandles()` - OHLCV candle helper

### Type Safety
- [x] Import `HandlerContext` from generated types
- [x] Import entity types from `Entities.gen.ts`
- [x] Import enum types from `Enums.gen.ts`
- [x] All handlers properly typed
- [x] No TypeScript errors
- [x] No linter errors

### Performance Targets
| Metric | Target | Method |
|--------|--------|--------|
| Payload size | 60-80% ↓ | Separate queries by group |
| Static queries | Cache forever | Fetch once on load |
| Dynamic queries | 5s polling | Small payloads, fast updates |
| Contract discovery | 1 query | ModuleRegistry (no factory loops) |

---

## Notes

- **Envio Limitations**: 
  - Cannot use embedded types (like `Amount`) - must flatten to `Raw`/`Formatted` fields
  - `@derivedFrom` only works for 1:many relationships, not 1:1
  - Entities are readonly - must create new objects instead of mutating

- **Future Enhancements**:
  - Implement RPC calls in `getOrCreateToken()` to fetch ERC20 metadata
  - Implement `updateUserPortfolioSummary()` with proper aggregation queries
  - Add Staking and Presale handlers when ABIs are available
  - Fetch fee and price data from contracts in trade handlers
