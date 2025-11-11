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

**Flow**: Market Factory → ModuleFactory emits `ModuleCreated(floor, proxy, metadata)` → Indexer maps modules → Frontend queries

### Event Processing

```typescript
// Handler Pattern
ModuleFactory.ModuleCreated.handler(async ({ event, context }) => {
  const { floor, proxy, metadata } = event.params
  const marketId = floor
  
  let registry = await context.ModuleRegistry.get(marketId) || {
    id: marketId, market_id: marketId,
    fundingManager: '', authorizer: '', feeTreasury: '',
    creditFacility: '', presale: '', staking: '',
    createdAt: event.block.timestamp, lastUpdatedAt: event.block.timestamp
  }
  
  const moduleType = extractModuleType(metadata.title)
  registry[moduleType] = proxy
  registry.lastUpdatedAt = event.block.timestamp
  context.ModuleRegistry.set(registry)
})

function extractModuleType(title: string): string {
  const lower = title.toLowerCase()
  if (lower.includes('creditfacility')) return 'creditFacility'
  if (lower.includes('treasury') || lower.includes('splitter')) return 'feeTreasury'
  if (lower.includes('presale')) return 'presale'
  if (lower.includes('staking')) return 'staking'
  
  const prefix = title.split('_')[0]
  return { 'BC': 'fundingManager', 'AUT': 'authorizer' }[prefix] || 'unknown'
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

**Race Conditions**: Handler creates ModuleRegistry on first event, populates fields as subsequent events arrive. Market relationship resolves via `@derivedFrom` when Market entity indexes.

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

```graphql
type Amount { raw: BigInt!; formatted: String! }  # All monetary values
type Token { id: ID!; name: String!; symbol: String!; decimals: Int! }

enum MarketStatus { ACTIVE PAUSED CLOSED }
enum TradeType { BUY SELL }
enum LoanStatus { ACTIVE REPAID DEFAULTED }
enum StakeStatus { ACTIVE UNSTAKED LOCKED }
enum CandlePeriod { ONE_HOUR FOUR_HOURS ONE_DAY }
```

**Conventions** (Envio doesn't support interfaces):
- Events: `id`, `timestamp`, `transactionHash`
- Contracts: `id`, `createdAt`
- All monetary fields use `Amount!` (never `BigInt!`)
- All status fields use enums (never `String!`)
- Frontend calculates USD from `Amount.raw` + external oracles

## Schema by Data Group

### 1. User Group (Query only when wallet connected)

```graphql
type Account { 
  id: ID!  # User address
  # @derivedFrom: marketsCreated, trades, loans, stakes, presaleParticipations
}

type UserMarketPosition {
  id: ID!  # userAddress-marketAddress
  user: Account!; market: Market!
  fTokenBalance: Amount!; reserveBalance: Amount!
  totalDebt: Amount!; lockedCollateral: Amount!
  stakedAmount: Amount!; claimableRewards: Amount!
  presaleDeposit: Amount!; presaleLeverage: BigInt!
  lastUpdatedAt: BigInt!
}

type UserPortfolioSummary {
  id: ID!  # userAddress
  user: Account!
  totalPortfolioValue: Amount!; totalDebt: Amount!
  totalCollateralValue: Amount!; totalStakedValue: Amount!
  activeMarkets: BigInt!; activeLoans: BigInt!; activeStakes: BigInt!
  lastUpdatedAt: BigInt!
}
```

### 2. Static Group (Fetch once, cache client-side)

```graphql
type Market {
  id: ID!  # Market address (same as fundingManager)
  name: String!; symbol: String!; description: String!
  creator: Account!; factory: FactoryContract!
  reserveToken: Token!; issuanceToken: Token!
  initialPrice: Amount!; tradingFeeBps: BigInt!; maxLTV: BigInt!
  maxSupply: Amount!; createdAt: BigInt!
  # Relations: moduleRegistry, marketState (1:1)
  # @derivedFrom: trades, floorElevations
}

type ModuleRegistry {
  id: ID!  # Market address
  market: Market!
  fundingManager: String!  # BC address
  authorizer: String!      # AUT address
  feeTreasury: String!     # Treasury address
  creditFacility: String!  # Optional
  presale: String!         # Optional
  staking: String!         # Optional
  createdAt: BigInt!; lastUpdatedAt: BigInt!
}

type FactoryContract {
  id: ID!; totalMarkets: BigInt!; creationFee: Amount!
  feeCollector: String!; createdAt: BigInt!
}

type CreditFacilityContract {
  id: ID!; collateralToken: Token!; borrowToken: Token!
  totalLoans: BigInt!; totalVolume: Amount!; createdAt: BigInt!
}

type StakingContract {
  id: ID!; stakingToken: Token!; rewardToken: Token!
  totalStaked: Amount!; totalRewards: Amount!; createdAt: BigInt!
}

type PresaleContract {
  id: ID!; saleToken: Token!; purchaseToken: Token!
  startTime: BigInt!; endTime: BigInt!; maxLeverage: BigInt!
  totalRaised: Amount!; totalParticipants: BigInt!; createdAt: BigInt!
}
```

### 3. Dynamic Group (Poll frequently, small payloads)

```graphql
type MarketState {  # Updated every trade/elevation
  id: ID!  # Same as Market id
  market: Market!
  currentPrice: Amount!; floorPrice: Amount!
  totalSupply: Amount!; marketSupply: Amount!; floorSupply: Amount!
  status: MarketStatus!; isBuyOpen: Boolean!; isSellOpen: Boolean!
  lastTradeTimestamp: BigInt!; lastElevationTimestamp: BigInt!
  lastUpdatedAt: BigInt!
}

type Trade {  # id: txHash-logIndex
  id: ID!; market: Market!; user: Account!; tradeType: TradeType!
  tokenAmount: Amount!; reserveAmount: Amount!; fee: Amount!; newPrice: Amount!
  timestamp: BigInt!; transactionHash: String!
}

type FloorElevation {  # id: txHash-logIndex
  id: ID!; market: Market!
  oldFloorPrice: Amount!; newFloorPrice: Amount!; deployedAmount: Amount!
  timestamp: BigInt!; transactionHash: String!
}

type FeeDistribution {  # id: txHash-logIndex
  id: ID!; market: Market!
  floorAmount: Amount!; stakingAmount: Amount!; treasuryAmount: Amount!
  timestamp: BigInt!; transactionHash: String!
}

type Loan {  # id: txHash-logIndex
  id: ID!; borrower: Account!; facility: CreditFacilityContract!
  collateralAmount: Amount!; borrowAmount: Amount!; originationFee: Amount!
  status: LoanStatus!; timestamp: BigInt!; transactionHash: String!
}

type Stake {  # id: txHash-logIndex
  id: ID!; user: Account!; contract: StakingContract!
  amount: Amount!; lockDuration: BigInt!; status: StakeStatus!
  timestamp: BigInt!; transactionHash: String!
}

type PresaleParticipation {  # id: txHash-logIndex
  id: ID!; user: Account!; presale: PresaleContract!
  amount: Amount!; leverage: BigInt!
  timestamp: BigInt!; transactionHash: String!
}

type MarketSnapshot {  # id: marketAddress-timestamp
  id: ID!; market: Market!; timestamp: BigInt!
  price: Amount!; floorPrice: Amount!
  totalSupply: Amount!; marketSupply: Amount!
  volume24h: Amount!; trades24h: BigInt!
}

type PriceCandle {  # id: marketAddress-period-timestamp
  id: ID!; market: Market!; period: CandlePeriod!; timestamp: BigInt!
  open: Amount!; high: Amount!; low: Amount!; close: Amount!
  volume: Amount!; trades: BigInt!
}
```

---

## Query Patterns

```graphql
# USER GROUP - Only when wallet connected
query UserPositions($user: ID!) {
  account(id: $user) {
    userMarketPositions { market { id symbol } fTokenBalance totalDebt }
    userPortfolioSummary { totalPortfolioValue totalDebt activeMarkets }
  }
}

# STATIC GROUP - Fetch once, cache forever
query MarketConfigs {
  markets {
    id name symbol description creator { id }
    reserveToken { symbol decimals } issuanceToken { symbol decimals }
    initialPrice { raw formatted } tradingFeeBps maxLTV createdAt
    moduleRegistry { fundingManager authorizer feeTreasury creditFacility }
  }
}

# DYNAMIC GROUP - Poll frequently
query MarketActivity($marketId: ID!) {
  marketState(id: $marketId) {
    currentPrice { raw } floorPrice { raw } totalSupply { raw }
    status isBuyOpen isSellOpen
  }
  trades(where: { market: $marketId }, orderBy: timestamp, orderDirection: desc, first: 50) {
    user { id } tradeType tokenAmount { raw } newPrice { raw } timestamp
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
| Contracts | `id` (address), `createdAt`, ends with `Contract` | FactoryContract, MarketState |
| Monetary | Always use `Amount!` type (never `BigInt!`) | prices, balances, fees |
| Status | Always use enums (never `String!`) | MarketStatus, TradeType |

### Token & Amount Helpers

```typescript
// Token population (call when contracts first encountered)
async function getOrCreateToken(context: Context, address: string) {
  let token = await context.Token.get(address)
  if (!token) {
    const [name, symbol, decimals] = await fetchERC20Metadata(address)
    token = { id: address, name, symbol, decimals }
    context.Token.set(token)
  }
  return token
}

// Amount formatting
function formatAmount(raw: bigint, decimals: number): Amount {
  const divisor = BigInt(10 ** decimals)
  const whole = raw / divisor
  const fractional = raw % divisor
  return {
    raw,
    formatted: `${whole}.${fractional.toString().padStart(decimals, '0')}`
  }
}
```

---

## Implementation Checklist

### Schema (`indexer/schema.graphql`)
- [ ] Core types: `Amount`, `Token`, enums (`MarketStatus`, `TradeType`, `LoanStatus`, `StakeStatus`, `CandlePeriod`)
- [ ] Static group: `Market`, `ModuleRegistry`, `FactoryContract`, `CreditFacilityContract`, `StakingContract`, `PresaleContract`
- [ ] Dynamic group: `MarketState`, `Trade`, `FloorElevation`, `FeeDistribution`, `Loan`, `Stake`, `PresaleParticipation`, `MarketSnapshot`, `PriceCandle`
- [ ] User group: `Account`, `UserMarketPosition`, `UserPortfolioSummary`
- [ ] Verify: All monetary = `Amount!`, all status = enums, `Market` has no dynamic fields

### Config (`indexer/config.yaml`)
- [ ] Add ModuleFactory contract + `ModuleCreated` event

### Handlers (`indexer/src/EventHandlers.ts`)
- [ ] `ModuleFactory.ModuleCreated` handler + `extractModuleType()` function
- [ ] Update `MarketCreated` to populate `Token` entities and `ModuleRegistry`
- [ ] Format all monetary values using `Amount` type
- [ ] Handle race conditions (ModuleCreated before MarketCreated)

### Query Helpers (`packages/graphql/src/`)
- [ ] Create `queries/user.ts`, `queries/static.ts`, `queries/dynamic.ts`
- [ ] Export typed query functions

### Performance Targets
| Metric | Target | Method |
|--------|--------|--------|
| Payload size | 60-80% ↓ | Separate queries by group |
| Static queries | Cache forever | Fetch once on load |
| Dynamic queries | 5s polling | Small payloads, fast updates |
| Contract discovery | 1 query | ModuleRegistry (no factory loops) |
