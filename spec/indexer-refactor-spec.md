# Floor Markets Indexer Refactor Spec

## Objective

- Deliver every data point enumerated in `spec/frontend-data-requirements.md` through the Envio indexer so the frontend can query a single source for markets, user positions, loans, presale, staking, and fee flows.
- Close the gap between the current schema/handler implementation and the on-chain behavior exercised in the Solidity E2E + invariant suites.
- Define the work required to make market analytics (prices, volume, floor history) reliable and to expose module discovery that the dapp can trust.

## Progress

- [x] Define detailed implementation plan & sequencing
- [x] Execute schema & discovery cleanup (Workstream A) – schema, helpers, and generated types now match the normalized ID + loan model (incl. loanId primary keys, collateral/fee snapshots, user position counters, LoanStatusHistory, registry floor pointer, and removal of the deprecated `Loan.timestamp` field)
- [x] Expand event coverage and handlers (Workstream B) – Floor config now listens for gate/floor/fee/collateral events, `market-handlers` pull on-chain pricing + fee bps via viem, emit `FloorElevation` entries, keep `Market` fee flags in sync, and respond to gate toggles; credit handler upgrades underway (treasury/presale/staking still pending in the remaining checklist items below)
- [x] Build derived metrics & snapshots (Workstream C) – price candles now update for 1h/4h/1d periods, a rolling 24h stats cache backs the `MarketRollingStats` table, hourly `MarketSnapshot` rows capture supply/price/floor + 24h volume/trades, and `GlobalStats` tracks system-wide counts/volume (normalized to 18 decimals)
- [x] Update config/infra/tests (Workstream D)

## Inputs Reviewed

- Frontend data contract (`spec/frontend-data-requirements.md`)
- Schema + config (`schema.graphql`, `config.yaml`)
- Runtime handlers (`src/factory-handlers.ts`, `src/market-handlers.ts`, `src/credit-handlers.ts`, helpers)
- Solidity tests showing canonical flows (`contracts/test/e2e/core/modules/CreditFacility_v1_E2E.t.sol`, `contracts/test/e2e/core/issuance/Floor_v1_E2E.t.sol`, `contracts/test/invariant/workflows/FullProtocolWorkflow_InvariantTest.t.sol`)

## Key Findings

### 1. Schema misalignment

- `ModuleRegistry` never stores the floor module address, so clients cannot resolve the bonding curve; only authorizer/treasury/credit/presale/staking slots exist. (`schema.graphql`, `ModuleRegistry` type)
- `Loan` entities use `txHash-logIndex` as ID, lack the on-chain `loanId`, and omit collateral/fee/floor snapshots required by the frontend and tests.
  ```264:282:indexer/schema.graphql
  type Loan {
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
  ```
- `UserMarketPosition` includes `reserveBalance`, `lockedCollateral`, `stakedAmount`, etc., but handlers never populate them, so values remain zero and misleading to the frontend.
- Entities for presale, staking, fee distributions, and floor elevations exist in the schema but no handler ever sets them; snapshots (`MarketSnapshot`, `PriceCandle`) are defined but never written.

### 2. Handler shortcomings

- Trade handlers hardcode `fee` and `newPrice` to zero, never call the Floor contract for real prices/fees, and adjust supplies by naïvely adding/subtracting event payloads.
  ```88:138:src/market-handlers.ts
    const fee = formatAmount(0n, reserveToken.decimals) // TODO
    const newPrice = formatAmount(0n, reserveToken.decimals) // TODO
    ...
      newPriceRaw: newPrice.raw,
      newPriceFormatted: newPrice.formatted,
      totalSupplyRaw: market.totalSupplyRaw + event.params.receivedAmount_,
      marketSupplyRaw: market.marketSupplyRaw + event.params.receivedAmount_,
  ```
- `getOrCreateMarket` seeds `creator_id` with the market address itself and leaves `factory_id` blank, so we lose provenance and cannot join back to ModuleFactory deployments.
- Credit handlers ignore the `loanId` emitted by the contract, create duplicate loan rows for every repayment, and never update `totalDebt`, `lockedCollateral`, or user positions.
  ```11:140:src/credit-handlers.ts
  const loanId = `${event.transaction.hash}-${event.logIndex}` // ignores on-chain loanId
  ...
      collateralAmountRaw: 0n,
      originationFeeRaw: 0n,
      status: 'ACTIVE' as LoanStatus_t,
  ```

````
- `IssuanceTokensLocked/Unlocked` handlers simply log and exit—no state change.
- No handlers exist for `FloorIncreased`, `BuyingEnabled/Disabled`, `SellingEnabled/Disabled`, fee treasury events, staking, or presale despite explicit frontend needs (`spec/frontend-data-requirements.md` §§1-8).

### 3. Config & contract coverage
- `config.yaml` only listens to four Floor events and five CreditFacility events; it omits all floor management, gating, fee, and staking signals.
  ```15:45:indexer/config.yaml
  - name: FloorMarket
    ...
    events:
      - event: TokensBought
      - event: TokensSold
      - event: VirtualCollateralAmountAdded
      - event: VirtualCollateralAmountSubtracted
  ...
      - name: CreditFacility
        address:
````

- Floor & credit addresses are blank. Dynamic discovery works only if ModuleFactory emits events on the same chain; for testnets/mainnet we still need explicit overrides for historical backfills.

### 4. Frontend requirements currently impossible

- Marketplace cards need floor history, 24h volume, and fee splits (§1.1–1.4, §2.2), but we never write `FloorElevation` or `FeeDistribution` entities.
  ```238:257:spec/frontend-data-requirements.md

  ```

### 2.5 Floor Injection History

... FloorIncreased(oldFloorPrice, newFloorPrice, collateralConsumed, supplyIncrease) ...

````
- Borrow/loop panels need per-user debt, locked collateral, LTV, and protocol totals (§4–§5). Credit handlers do not expose any of these metrics, and schema lacks aggregates.
- Presale/staking data is marked TBD in the spec, yet our indexer provides zero entities or handlers, so the frontend cannot even display placeholder progress/eligibility.
- Tests show real workflows (credit borrow/repay, role assignments, floor raises) that emit events we ignore; the invariant suite expects collateral accounting that we never track.
```168:220:contracts/test/e2e/core/modules/CreditFacility_v1_E2E.t.sol
      authorizer.addAccessPermission(target, credit.borrow.selector, borrowerRoleId);
      ...
      uint256 loanId = credit.borrow(200e18);
      ...
      credit.repay(loanId, l2.remainingLoanAmount - repayHalf);
````

## Requirement ↔ Gap Matrix

| Frontend requirement                                              | Source (§)       | Needed signals                                                 | Current state                                            | Gap                                                        |
| ----------------------------------------------------------------- | ---------------- | -------------------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------- |
| Floor price history, injections, APR                              | §1.4, §2.2, §2.5 | `FloorIncreased`, VC deltas, on-chain price                    | Not indexed (only VC add/sub)                            | Implement Floor events, compute floor/floorAPR metadata    |
| Market price history & volume                                     | §1.3, §2.3       | Accurate trade price, OHLC candles, 24h aggregates             | Trade handlers store 0 price/fee, candles useless        | Fetch price/fee from contract, maintain rolling aggregates |
| Loan lifecycle & user debt                                        | §4, §5, §9       | `loanId`, amount, fee, floor snapshot, user debt totals        | Loan IDs fabricated per tx; no debt/locking updates      | Store on-chain IDs, update aggregates + user positions     |
| Module discovery (authorizer, credit, treasury, presale, staking) | §1.4, §9         | Registry keyed by canonical market + actual floor module field | Registry lacks floor pointer; duplicates by address form | Normalize IDs, add explicit floor module reference         |
| Gate/fee state (isBuyOpen, fee bps)                               | §2.1, §3         | `BuyingEnabled/Disabled`, `Selling*`, `*FeeSet` events         | Not listened to or stored                                | Extend config + handlers, update Market flags              |
| Treasury inflows/outflows                                         | §1.4, §2.2       | `Treasury_FundsReceived`, `RecipientPayment`                   | Not in config                                            | Add ABIs & entities to surface fee splits                  |
| Presale progress & user participation                             | §1.1, §8         | Presale contract events                                        | No ABI/handlers                                          | Add once ABI delivered; schema ready                       |
| Staking balances/APY                                              | §6               | Staking contract events                                        | No ABI/handlers                                          | Same as presale                                            |

## Refactor Workstreams

### Workstream A – Schema & Discovery Cleanup

1. **Normalize IDs:** Use the Floor (bonding-curve) module / orchestrator
   address as the canonical `id` for `Market` and every market-adjacent
   entity—no extra `floorModuleId` or `orchestratorId` columns required—and
   ensure `ModuleRegistry` references follow the same convention so handlers
   and the frontend can deterministically map modules (no guessing via
   `resolveMarketId`).
   - [x] Update `schema.graphql` so `Market.id`, `ModuleRegistry.id`, and all
         foreign keys referencing markets adopt the Floor/orchestrator address.
   - [x] Regenerate Envio types/codegen and update helper factories
         (`src/helpers/registry.ts`, `src/helpers/market.ts`) to enforce the
         normalized ID shape.
   - [x] Backfill `factory_id` and `creator_id` in `getOrCreateMarket`
         using `ModuleCreated` data to preserve provenance.
2. **Loan redesign:** Persist `loanId` (uint256) as primary key, add fields for
   `floorPriceAtBorrow`, `lockedCollateral`, `remainingDebt`,
   `originationFee`, `statusHistory`. Update `CreditFacilityContract` with
   `totalDebtRaw` & `totalLockedCollateralRaw`.
   - [x] Replace synthetic IDs inside `src/credit-handlers.ts` with the
         on-chain `loanId` and migrate helper functions accordingly.
   - [x] Extend the schema to capture price/fee snapshots and a normalized
         `LoanStatusHistory` child table for frontend timelines (deprecated `Loan.timestamp`
         field removed to avoid redundant storage).
   - [x] Ensure facility-level aggregates stay in sync on every borrow/repay
         by adding dedicated mutation helpers.
3. **User positions:** Remove pseudo `reserveBalance` (we cannot track wallet
   balances) and replace with derived fields we can compute (`netFTokenChangeRaw`,
   `lockedCollateralRaw`, `totalDebtRaw`, `stakedAmountRaw`,
   `presaleDepositRaw`).
   - [x] Update schema + generated types for the new fields and delete
         unused columns to avoid misleading zeros.
   - [x] Introduce helper utilities to incrementally adjust these derived
         counters per event (credit borrow/repay, staking, presale).
4. **New aggregates:** Add `MarketRollingStats` (24h volume, trades, avg price)
   and `GlobalStats` tables to satisfy dashboard requirements without N+1
   queries.
   - [x] Define schema entities with indexes keyed by `(marketId, window)`.
   - [x] Document the rolling-window policy (24h sliding bucket) so handler
         implementers can follow a deterministic rule set.
   - [x] Plan reindex impact: aggregates will be recomputed from genesis,
         so note in rollout doc that a full reindex is mandatory.

### Workstream B – Event Coverage & Handlers

1. **Factory:** When registering modules, persist floor module address plus metadata (version, title) and connect to existing Market/Registry rows.
2. **Market/Floor handlers:**
   - [x] Extend config to include `FloorIncreased`, `BuyingEnabled/Disabled`, `SellingEnabled/Disabled`, `BuyFeeUpdated`, `SellFeeUpdated`, `CollateralDeposited/Withdrawn`.
   - [x] On each trade, call `getStaticPriceForBuying/Selling`, `getBuyFee`, `getSellFee` via viem to populate accurate price/fee fields and update rolling supply/reserve data.
   - [x] Emit `FloorElevation` entities using floor events, keep `floorPriceRaw` current, and persist gate/fee state on `Market`.
   - [ ] Maintain `PriceCandle` and `MarketSnapshot` using real data (candles wired; snapshots + rolling stats still tracked under Workstream C).
3. **Credit facility:**
   - [x] Parse `loanId` from events, fetch `getLoan(loanId)` to capture collateral + debt, and update both facility totals and `UserMarketPosition`.
   - [ ] Handle remaining events (`LoanRebalanced`, `LoansConsolidated`, `BuyingEnabled` credit analogues, etc.) per ABI/test coverage.
   - [ ] Maintain per-market protocol debt + locked issuance supply for circulation calculations (partially covered via existing aggregates; treasury/presale/staking hooks outstanding).
4. **Treasury + fees:** Add handlers for `Treasury_FundsReceived` and `RecipientPayment` to populate `FeeDistribution`. _(pending)_
5. **Optional modules:** Wire presale/staking handlers once ABIs exist, following the schema placeholders already defined. _(pending)_

### Workstream C – Derived Metrics & Snapshots

1. **Rolling windows:** [x] Use an in-memory accumulator (per market) to track the last 24h of trade volume/trade count for rapid queries and persist into `MarketRollingStats`.
2. **Candles:** [x] Backfill `PriceCandle` creation at multiple periods (1h, 4h, 1d) using actual trade price; support re-org safe updates.
3. **Market snapshots:** [x] Schedule hourly snapshots triggered by trades (rounded to the nearest hour) to capture supply/price/floor/volume plus 24h stats.
4. **Global stats:** [x] After each trade/floor elevation, recompute aggregated totals (active markets, global volume) for the dashboard, normalized to 18 decimals; outstanding debt/locked collateral fields remain populated via credit handlers in Workstream B.

### Workstream D – Config, Infra, & Testing

1. **Config expansion:** Enumerated Floor + Credit events (including gate toggles, fee updates, collateral flows, Splitter treasury) inside `config.yaml` with the corresponding ABIs so discovery + historical replays cover every frontend dependency. Treasury ingestion now rides through the new `SplitterTreasury` handlers and fee distribution schema.
2. **RPC strategy:** `rpc-client.ts` block-level cache is live (buy/sell price + fee lookups only hit RPC once per block), and helpers route through a single `normalizeAddress()` wrapper so handler caches, registries, and DB entities share checksum IDs.
3. **Testing:**
   - Added handler unit coverage for module creation, buy/sell trades, rolling stats, and the new checksum enforcement; tests assert registry/market IDs, user positions, and global stats using `viem.getAddress`.
   - Credit + treasury handler tests piggyback on the same harness (credit suite still expanding for the remaining Workstream B items, but the infra + regression scaffolding from D is in place).
   - Regression runs (pnpm test) are wired into CI docs; remaining spec-driven queries reuse the new normalized IDs to avoid mismatched casing.

## Implementation Plan

1. **Planning & sequencing (current step)**
   - Finalize scope confirmation with stakeholders.
   - Define rollout order for schema and handler updates (reindex-only rollout, no bespoke migrations).
2. **Phase 1 – Schema & discovery**
   - Update `schema.graphql`, regenerate codegen, and ensure ModuleRegistry/Market IDs align (reindex to populate).
   - Ship helper updates (`registry`, `market`) with the new ID model.
3. **Phase 2 – Handler refactors**
   - Market/Floor handlers: add price/fee RPC reads, floor events, gate toggles.
   - Credit handlers: adopt on-chain `loanId`, debt/lock tracking, new events.
   - Treasury handlers + optional module hooks.
4. **Phase 3 – Metrics & snapshots**
   - Implement rolling stats, candles, snapshots, and global aggregates.
   - Wire helper utilities + persistence.
5. **Phase 4 – Config/infra/tests**
   - Expand `config.yaml`, add ABIs, enhance `rpc-client`.
   - Author replay/unit/integration tests mapped to frontend queries.
   - Update documentation + monitoring dashboards.
6. **QA & rollout**
   - Reindex on dev, validate GraphQL against frontend contract.
   - Promote to staging/mainnet once data parity confirmed.

## Acceptance Criteria

- Every field listed in `spec/frontend-data-requirements.md` is either (a) supplied by the indexer or (b) explicitly annotated as on-chain/Oracle-only in docs.
- Trades include accurate price/fee data and price candles reflect actual movement (verified against a mainnet fork scenario).
- Per-market totals (supply, floor reserves, protocol debt) reconcile with invariant test expectations within ±1 wei.
- User positions show correct `lockedCollateralRaw` and `totalDebtRaw` after running the CreditFacility E2E script on a fork.
- Module discovery query returns consistent records for floor, authorizer, treasury, credit facility, staking, and presale modules for each market.
- Presale/staking handlers are added (even if behind feature flags) once ABIs land, keeping schema + code in sync.

## Next Steps

1. Approve this refactor scope.
2. Prioritize workstreams A → D (schema first to avoid rework).
3. Schedule time to sync with frontend team to confirm query contracts and with Solidity team to lock event coverage (especially for presale/staking ABIs).
4. Implement instrumentation dashboards (Grafana/Logs) to monitor handler successes and data freshness once refactor ships.
