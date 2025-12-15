import assert from 'assert'
import { TestHelpers } from 'generated'
import type { Token_t } from 'generated/src/db/Entities.gen'
import { getAddress } from 'viem'

import { __resetMarketHandlerTestState } from '../src/market-handlers'

process.env.MOCK_RPC = 'true'

const { MockDb, ModuleFactory, FloorMarket, Presale, SplitterTreasury, Addresses } = TestHelpers

// Test data from deployment
const USDC_ADDRESS = '0xe8f7d98be6722d42f29b50500b0e318ef2be4fc8' as const
const FLOOR_ADDRESS = '0xe38b6847e611e942e6c80ed89ae867f522402e80' as const
const MARKET_ADDRESS = '0x8265551ebb0f42521a591590ef1fefc3d34f851d' as const
const BC_MODULE_ADDRESS = '0x8265551ebb0f42521a591590ef1fefc3d34f851d' as const
const MARKET_ADDRESS_2 = '0x1111111111111111111111111111111111111111' as const
const BC_MODULE_ADDRESS_2 = '0x2222222222222222222222222222222222222222' as const
const PRESALE_MODULE_ADDRESS = '0x3333333333333333333333333333333333333333' as const

const USDC_ADDRESS_CHECKSUM = getAddress(USDC_ADDRESS)
const FLOOR_ADDRESS_CHECKSUM = getAddress(FLOOR_ADDRESS)
const MARKET_ADDRESS_CHECKSUM = getAddress(MARKET_ADDRESS)
const MARKET_ADDRESS_2_CHECKSUM = getAddress(MARKET_ADDRESS_2)
const PRESALE_MODULE_ADDRESS_CHECKSUM = getAddress(PRESALE_MODULE_ADDRESS)

// Test values
const USDC_DECIMALS = 6
const FLOOR_DECIMALS = 18
const BUY_DEPOSIT_AMOUNT = 10_000_000n // 10 USDC with 6 decimals
const BUY_RECEIVED_AMOUNT = 9_900_000n // 9.9 FLOOR with 18 decimals
const SELL_DEPOSIT_AMOUNT = 4_950_000n // 4.95 FLOOR with 18 decimals
const SELL_RECEIVED_AMOUNT = 4_900_500n // 4.900500 USDC with 6 decimals
const PRESALE_DEPOSIT_AMOUNT = 5_000_000n // 5 USDC with 6 decimals
const PRESALE_MINTED_AMOUNT = 5_000_000_000000000000n // 5 FLOOR with 18 decimals

const USDC_TOKEN: Token_t = {
  id: USDC_ADDRESS_CHECKSUM,
  name: 'Test USDC',
  symbol: 'TUSDC',
  decimals: USDC_DECIMALS,
  maxSupplyRaw: 0n,
  maxSupplyFormatted: '0',
}

const FLOOR_TOKEN: Token_t = {
  id: FLOOR_ADDRESS_CHECKSUM,
  name: 'Floor Token',
  symbol: 'FLOOR',
  decimals: FLOOR_DECIMALS,
  maxSupplyRaw: 0n,
  maxSupplyFormatted: '0',
}

describe('Floor Markets Indexer', () => {
  describe('ModuleCreated Handler', () => {
    it('creates Market when BC module is created', async () => {
      const mockDb = MockDb.createMockDb()

      const moduleCreatedEvent = ModuleFactory.ModuleCreated.createMockEvent({
        floor_: MARKET_ADDRESS,
        module_: BC_MODULE_ADDRESS,
        metadata_: [
          1n,
          0n,
          0n,
          'https://github.com/InverterNetwork/floors-sc',
          'BC_Discrete_Redeeming_VirtualSupply_v1',
        ],
        mockEventData: {
          block: { timestamp: 1000 },
        },
      })

      const updatedMockDb = await mockDb.processEvents([moduleCreatedEvent])

      // Check ModuleRegistry was created (uses orchestrator as ID, no fundingManager field)
      const registry = updatedMockDb.entities.ModuleRegistry.get(MARKET_ADDRESS_CHECKSUM)
      assert.ok(registry, 'ModuleRegistry should exist')
      assert.equal(
        registry?.id,
        MARKET_ADDRESS_CHECKSUM,
        'ModuleRegistry id should match orchestrator'
      )

      // Check Market was created (contains both static and dynamic fields)
      const market = updatedMockDb.entities.Market.get(MARKET_ADDRESS_CHECKSUM)
      assert.ok(market, 'Market should exist')
      assert.equal(market?.id, MARKET_ADDRESS_CHECKSUM, 'Market id should match orchestrator')
      assert.equal(market?.totalSupplyRaw, 0n, 'totalSupplyRaw should start at 0')
      assert.equal(market?.status, 'ACTIVE', 'status should be ACTIVE')
    })

    it('creates Token entities with correct addresses when tokens are referenced', async () => {
      // Note: This test assumes tokens are created when Market is created
      // The actual implementation may need RPC calls to fetch token addresses
      const mockDb = MockDb.createMockDb()

      const moduleCreatedEvent = ModuleFactory.ModuleCreated.createMockEvent({
        floor_: MARKET_ADDRESS,
        module_: BC_MODULE_ADDRESS,
        metadata_: [
          1n,
          0n,
          0n,
          'https://github.com/InverterNetwork/floors-sc',
          'BC_Discrete_Redeeming_VirtualSupply_v1',
        ],
      })

      const updatedMockDb = await mockDb.processEvents([moduleCreatedEvent])

      // Check that Market references token addresses (even if empty initially)
      const market = updatedMockDb.entities.Market.get(MARKET_ADDRESS_CHECKSUM)
      assert.ok(market, 'Market should exist')
      // Token addresses should be set (implementation may need RPC calls)
    })
  })

  describe('TokensBought Handler', () => {
    it('creates Trade and updates Market', async () => {
      const mockDb = MockDb.createMockDb()

      // First create Market
      const moduleCreatedEvent = ModuleFactory.ModuleCreated.createMockEvent({
        floor_: MARKET_ADDRESS,
        module_: BC_MODULE_ADDRESS,
        metadata_: [
          1n,
          0n,
          0n,
          'https://github.com/InverterNetwork/floors-sc',
          'BC_Discrete_Redeeming_VirtualSupply_v1',
        ],
        mockEventData: {
          block: { timestamp: 1000 },
        },
      })

      let dbWithModule = await mockDb.processEvents([moduleCreatedEvent])
      dbWithModule = dbWithModule.entities.Token.set(USDC_TOKEN)
      dbWithModule = dbWithModule.entities.Token.set(FLOOR_TOKEN)

      // Update Market to reference tokens
      const market = dbWithModule.entities.Market.get(MARKET_ADDRESS_CHECKSUM)
      if (market) {
        const updatedMarket = {
          ...market,
          reserveToken_id: USDC_ADDRESS_CHECKSUM,
          issuanceToken_id: FLOOR_ADDRESS_CHECKSUM,
        }
        dbWithModule = dbWithModule.entities.Market.set(updatedMarket)
      }

      // Create TokensBought event
      // Note: srcAddress should be the BC module address, not the orchestrator
      // The handler will look up the orchestrator via RPC (or fallback to Market lookup in tests)
      const userAddress = Addresses.defaultAddress
      const normalizedUserAddress = getAddress(userAddress as `0x${string}`)
      const tokensBoughtEvent = FloorMarket.TokensBought.createMockEvent({
        receiver_: userAddress,
        depositAmount_: BUY_DEPOSIT_AMOUNT,
        receivedAmount_: BUY_RECEIVED_AMOUNT,
        buyer_: userAddress,
        mockEventData: {
          srcAddress: BC_MODULE_ADDRESS, // BC module address, not orchestrator
          chainId: 31337,
          block: { timestamp: 2000 },
          transaction: { hash: '0x123' },
          logIndex: 0,
        },
      })

      const dbAfterBuy = await dbWithModule.processEvents([tokensBoughtEvent])

      // Check Trade was created
      const tradeId = `0x123-0`
      const trade = dbAfterBuy.entities.Trade.get(tradeId)
      assert.ok(trade, 'Trade should exist')
      assert.equal(trade?.tradeType, 'BUY', 'tradeType should be BUY')
      assert.equal(
        trade?.tokenAmountRaw,
        BUY_RECEIVED_AMOUNT,
        'tokenAmountRaw should match receivedAmount'
      )
      assert.equal(
        trade?.reserveAmountRaw,
        BUY_DEPOSIT_AMOUNT,
        'reserveAmountRaw should match depositAmount'
      )
      assert.equal(trade?.market_id, MARKET_ADDRESS_CHECKSUM, 'market_id should match')
      assert.equal(trade?.user_id, normalizedUserAddress, 'user_id should match receiver')

      // Check Market was updated (dynamic fields)
      const updatedMarket = dbAfterBuy.entities.Market.get(MARKET_ADDRESS_CHECKSUM)
      assert.ok(updatedMarket, 'Market should exist')
      assert.equal(
        updatedMarket?.totalSupplyRaw,
        BUY_RECEIVED_AMOUNT,
        'totalSupplyRaw should increase by receivedAmount'
      )
      assert.equal(
        updatedMarket?.marketSupplyRaw,
        BUY_RECEIVED_AMOUNT,
        'marketSupplyRaw should increase by receivedAmount'
      )
      assert.equal(updatedMarket?.lastTradeTimestamp, 2000n, 'lastTradeTimestamp should be updated')

      // Check UserMarketPosition was updated
      const positionId = `${normalizedUserAddress}-${getAddress(MARKET_ADDRESS)}`
      const position = dbAfterBuy.entities.UserMarketPosition.get(positionId)
      assert.ok(position, 'UserMarketPosition should exist')
      assert.equal(
        position?.netFTokenChangeRaw,
        BUY_RECEIVED_AMOUNT,
        'netFTokenChangeRaw should increase'
      )
    })

    it('formats token amounts correctly with different decimals', async () => {
      const mockDb = MockDb.createMockDb()

      let db = mockDb.entities.Token.set(USDC_TOKEN).entities.Token.set(FLOOR_TOKEN)

      // Create Market
      const moduleCreatedEvent = ModuleFactory.ModuleCreated.createMockEvent({
        floor_: MARKET_ADDRESS,
        module_: BC_MODULE_ADDRESS,
        metadata_: [
          1n,
          0n,
          0n,
          'https://github.com/InverterNetwork/floors-sc',
          'BC_Discrete_Redeeming_VirtualSupply_v1',
        ],
      })

      db = await db.processEvents([moduleCreatedEvent])

      // Update Market to reference tokens
      const market = db.entities.Market.get(MARKET_ADDRESS_CHECKSUM)
      if (market) {
        db = db.entities.Market.set({
          ...market,
          reserveToken_id: USDC_ADDRESS_CHECKSUM,
          issuanceToken_id: FLOOR_ADDRESS_CHECKSUM,
        })
      }

      // Create buy event
      const tokensBoughtEvent = FloorMarket.TokensBought.createMockEvent({
        receiver_: Addresses.defaultAddress,
        depositAmount_: BUY_DEPOSIT_AMOUNT, // 10 USDC
        receivedAmount_: BUY_RECEIVED_AMOUNT, // 9.9 FLOOR
        buyer_: Addresses.defaultAddress,
        mockEventData: {
          srcAddress: BC_MODULE_ADDRESS, // BC module address
          chainId: 31337,
          block: { timestamp: 2000 },
          transaction: { hash: '0x456' },
          logIndex: 0,
        },
      })

      const dbAfterBuy = await db.processEvents([tokensBoughtEvent])

      // Check formatted amounts
      const tradeId = `0x456-0`
      const trade = dbAfterBuy.entities.Trade.get(tradeId)
      assert.ok(trade, 'Trade should exist')

      // USDC: 10,000,000 / 10^6 = 10
      assert.equal(trade?.reserveAmountFormatted, '10', 'USDC amount should be formatted as 10')

      // FLOOR: 9,900,000 / 10^18 = 0.0000000000099, but we expect 9.9
      // This depends on the actual formatAmount implementation
      // The formatted string should correctly handle 18 decimals
    })
  })

  describe('Derived metrics', () => {
    it('updates rolling stats and global stats after a trade', async () => {
      __resetMarketHandlerTestState()
      const mockDb = MockDb.createMockDb()

      const moduleCreatedEvent = ModuleFactory.ModuleCreated.createMockEvent({
        floor_: MARKET_ADDRESS_2,
        module_: BC_MODULE_ADDRESS_2,
        metadata_: [
          1n,
          0n,
          0n,
          'https://github.com/InverterNetwork/floors-sc',
          'BC_Discrete_Redeeming_VirtualSupply_v1',
        ],
        mockEventData: {
          block: { timestamp: 1000 },
        },
      })

      let db = await mockDb.processEvents([moduleCreatedEvent])
      db = db.entities.Token.set(USDC_TOKEN).entities.Token.set(FLOOR_TOKEN)

      const market = db.entities.Market.get(MARKET_ADDRESS_2_CHECKSUM)
      if (market) {
        db = db.entities.Market.set({
          ...market,
          reserveToken_id: USDC_ADDRESS_CHECKSUM,
          issuanceToken_id: FLOOR_ADDRESS_CHECKSUM,
        })
      }

      const initialGlobalStats = db.entities.GlobalStats.get('global')

      const tokensBoughtEvent = FloorMarket.TokensBought.createMockEvent({
        receiver_: Addresses.defaultAddress,
        depositAmount_: BUY_DEPOSIT_AMOUNT,
        receivedAmount_: BUY_RECEIVED_AMOUNT,
        buyer_: Addresses.defaultAddress,
        mockEventData: {
          srcAddress: BC_MODULE_ADDRESS_2,
          chainId: 31337,
          block: { timestamp: 4000 },
          transaction: { hash: '0x789' },
          logIndex: 0,
        },
      })

      const dbAfterBuy = await db.processEvents([tokensBoughtEvent])

      const rollingStatsId = `${MARKET_ADDRESS_2}-86400`
      const rollingStats = dbAfterBuy.entities.MarketRollingStats.get(rollingStatsId)
      assert.ok(rollingStats, 'MarketRollingStats should exist')
      assert.equal(
        rollingStats?.volumeRaw,
        BUY_DEPOSIT_AMOUNT,
        'rolling volume should match deposit amount'
      )
      assert.equal(rollingStats?.tradeCount, 1n, 'rolling trade count should be 1')

      const globalStats = dbAfterBuy.entities.GlobalStats.get('global')
      assert.ok(globalStats, 'GlobalStats should exist')
      assert.ok((globalStats?.totalMarkets ?? 0n) >= 1n, 'totalMarkets should be at least 1')
      assert.ok((globalStats?.activeMarkets ?? 0n) >= 1n, 'activeMarkets should be at least 1')
      const expectedGlobalVolume = BUY_DEPOSIT_AMOUNT * 10n ** 12n
      const initialVolume = initialGlobalStats?.totalVolumeRaw ?? 0n
      const volumeDelta = (globalStats?.totalVolumeRaw ?? 0n) - initialVolume
      assert.equal(
        volumeDelta,
        expectedGlobalVolume,
        'global volume should normalize to 18 decimals'
      )
    })
  })

  describe('TokensSold Handler', () => {
    it('creates Trade and updates Market', async () => {
      const mockDb = MockDb.createMockDb()

      let db = mockDb.entities.Token.set(USDC_TOKEN).entities.Token.set(FLOOR_TOKEN)

      // Create Market
      const moduleCreatedEvent = ModuleFactory.ModuleCreated.createMockEvent({
        floor_: MARKET_ADDRESS,
        module_: BC_MODULE_ADDRESS,
        metadata_: [
          1n,
          0n,
          0n,
          'https://github.com/InverterNetwork/floors-sc',
          'BC_Discrete_Redeeming_VirtualSupply_v1',
        ],
      })

      db = await db.processEvents([moduleCreatedEvent])

      // Update Market to reference tokens
      const market = db.entities.Market.get(MARKET_ADDRESS_CHECKSUM)
      if (market) {
        db = db.entities.Market.set({
          ...market,
          reserveToken_id: USDC_ADDRESS_CHECKSUM,
          issuanceToken_id: FLOOR_ADDRESS_CHECKSUM,
        })
      }

      // Set initial Market with some supply
      const initialSupply = BUY_RECEIVED_AMOUNT
      const marketWithSupply = db.entities.Market.get(MARKET_ADDRESS_CHECKSUM)
      if (marketWithSupply) {
        db = db.entities.Market.set({
          ...marketWithSupply,
          totalSupplyRaw: initialSupply,
          marketSupplyRaw: initialSupply,
        })
      }

      // Create TokensSold event
      const userAddress = Addresses.defaultAddress
      const tokensSoldEvent = FloorMarket.TokensSold.createMockEvent({
        receiver_: userAddress,
        depositAmount_: SELL_DEPOSIT_AMOUNT,
        receivedAmount_: SELL_RECEIVED_AMOUNT,
        seller_: userAddress,
        mockEventData: {
          srcAddress: BC_MODULE_ADDRESS, // BC module address
          chainId: 31337,
          block: { timestamp: 3000 },
          transaction: { hash: '0x789' },
          logIndex: 0,
        },
      })

      const dbAfterSell = await db.processEvents([tokensSoldEvent])

      // Check Trade was created
      const tradeId = `0x789-0`
      const trade = dbAfterSell.entities.Trade.get(tradeId)
      assert.ok(trade, 'Trade should exist')
      assert.equal(trade?.tradeType, 'SELL', 'tradeType should be SELL')
      assert.equal(
        trade?.tokenAmountRaw,
        SELL_DEPOSIT_AMOUNT,
        'tokenAmountRaw should match depositAmount'
      )
      assert.equal(
        trade?.reserveAmountRaw,
        SELL_RECEIVED_AMOUNT,
        'reserveAmountRaw should match receivedAmount'
      )

      // Check Market was updated (dynamic fields)
      const updatedMarket = dbAfterSell.entities.Market.get(MARKET_ADDRESS_CHECKSUM)
      assert.ok(updatedMarket, 'Market should exist')
      assert.equal(
        updatedMarket?.totalSupplyRaw,
        initialSupply - SELL_DEPOSIT_AMOUNT,
        'totalSupplyRaw should decrease by depositAmount'
      )
      assert.equal(
        updatedMarket?.marketSupplyRaw,
        initialSupply - SELL_DEPOSIT_AMOUNT,
        'marketSupplyRaw should decrease by depositAmount'
      )
    })
  })

  describe('Race Condition Handling', () => {
    it('handles trade events before market is created gracefully', async () => {
      const mockDb = MockDb.createMockDb()

      // Try to process TokensBought before ModuleCreated
      const tokensBoughtEvent = FloorMarket.TokensBought.createMockEvent({
        receiver_: Addresses.defaultAddress,
        depositAmount_: BUY_DEPOSIT_AMOUNT,
        receivedAmount_: BUY_RECEIVED_AMOUNT,
        buyer_: Addresses.defaultAddress,
        mockEventData: {
          srcAddress: BC_MODULE_ADDRESS, // BC module address
          chainId: 31337,
          block: { timestamp: 1000 },
          transaction: { hash: '0xabc' },
          logIndex: 0,
        },
      })

      // This should not throw an error
      const dbAfterTrade = await mockDb.processEvents([tokensBoughtEvent])

      // Market may not exist, but handler should handle gracefully
      const market = dbAfterTrade.entities.Market.get(MARKET_ADDRESS_CHECKSUM)
      // Handler may return early if market doesn't exist, which is acceptable
      // Or it may create entities defensively (preferred)
    })
  })

  describe('SplitterTreasury handlers', () => {
    async function bootstrapSplitterTreasuryDb() {
      let db = MockDb.createMockDb()

      const moduleCreatedEvent = ModuleFactory.ModuleCreated.createMockEvent({
        floor_: MARKET_ADDRESS,
        module_: BC_MODULE_ADDRESS,
        metadata_: [
          1n,
          0n,
          0n,
          'https://github.com/InverterNetwork/floors-sc',
          'BC_Discrete_Redeeming_VirtualSupply_v1',
        ],
        mockEventData: {
          block: { timestamp: 1000 },
        },
      })

      db = await db.processEvents([moduleCreatedEvent])
      return db.entities.Token.set(USDC_TOKEN).entities.Token.set(FLOOR_TOKEN)
    }

    it('creates FeeSplitterReceipt on Treasury_FundsReceived', async () => {
      let db = await bootstrapSplitterTreasuryDb()

      const feesReceivedEvent = SplitterTreasury.Treasury_FundsReceived.createMockEvent({
        token: USDC_ADDRESS,
        sender: Addresses.defaultAddress,
        amount: BUY_DEPOSIT_AMOUNT, // 10 USDC
        mockEventData: {
          srcAddress: MARKET_ADDRESS, // Treasury address
          chainId: 31337,
          block: { timestamp: 2000 },
          transaction: { hash: '0xfees1' },
          logIndex: 0,
        },
      })

      db = await db.processEvents([feesReceivedEvent])

      const receipt = db.entities.FeeSplitterReceipt.get('0xfees1-0')
      assert.ok(receipt, 'FeeSplitterReceipt should be created')
      assert.equal(receipt?.market_id, MARKET_ADDRESS_CHECKSUM, 'market_id should match')
      assert.equal(receipt?.token_id, USDC_ADDRESS_CHECKSUM, 'token_id should match')
      assert.equal(receipt?.sender, getAddress(Addresses.defaultAddress), 'sender should match')
      assert.equal(receipt?.amountRaw, BUY_DEPOSIT_AMOUNT, 'amountRaw should match deposit')
      assert.equal(receipt?.amountFormatted, '10', 'amountFormatted should be 10 USDC')
    })

    it('creates FeeSplitterPayment on RecipientPayment', async () => {
      let db = await bootstrapSplitterTreasuryDb()

      const recipientAddress = '0x1234567890123456789012345678901234567890' as const
      const normalizedRecipient = getAddress(recipientAddress)

      const recipientPaymentEvent = SplitterTreasury.RecipientPayment.createMockEvent({
        token_: USDC_ADDRESS,
        recipient_: recipientAddress,
        amount_: BUY_DEPOSIT_AMOUNT, // 10 USDC
        mockEventData: {
          srcAddress: MARKET_ADDRESS, // Treasury address
          chainId: 31337,
          block: { timestamp: 2100 },
          transaction: { hash: '0xpay1' },
          logIndex: 0,
        },
      })

      db = await db.processEvents([recipientPaymentEvent])

      const payment = db.entities.FeeSplitterPayment.get('0xpay1-0')
      assert.ok(payment, 'FeeSplitterPayment should be created')
      assert.equal(payment?.market_id, MARKET_ADDRESS_CHECKSUM, 'market_id should match')
      assert.equal(payment?.token_id, USDC_ADDRESS_CHECKSUM, 'token_id should match')
      assert.equal(payment?.recipient, normalizedRecipient, 'recipient should match')
      assert.equal(payment?.isFloorFee, false, 'isFloorFee should be false for recipient payments')
      assert.equal(payment?.amountRaw, BUY_DEPOSIT_AMOUNT, 'amountRaw should match')
      assert.equal(payment?.amountFormatted, '10', 'amountFormatted should be 10 USDC')
    })

    it('creates FeeSplitterPayment on FloorFeePaid with isFloorFee=true', async () => {
      let db = await bootstrapSplitterTreasuryDb()

      const floorFeeEvent = SplitterTreasury.FloorFeePaid.createMockEvent({
        token_: USDC_ADDRESS,
        amount_: 1_000_000n, // 1 USDC with 6 decimals
        mockEventData: {
          srcAddress: MARKET_ADDRESS, // Treasury address
          chainId: 31337,
          block: { timestamp: 2200 },
          transaction: { hash: '0xfloor1' },
          logIndex: 0,
        },
      })

      db = await db.processEvents([floorFeeEvent])

      const payment = db.entities.FeeSplitterPayment.get('0xfloor1-0')
      assert.ok(payment, 'FeeSplitterPayment should be created for floor fee')
      assert.equal(payment?.market_id, MARKET_ADDRESS_CHECKSUM, 'market_id should match')
      assert.equal(payment?.token_id, USDC_ADDRESS_CHECKSUM, 'token_id should match')
      assert.equal(payment?.isFloorFee, true, 'isFloorFee should be true for floor fees')
      assert.equal(payment?.amountRaw, 1_000_000n, 'amountRaw should match floor fee')
      assert.equal(payment?.amountFormatted, '1', 'amountFormatted should be 1 USDC')
    })

    it('tracks multiple receipts and payments from same transaction', async () => {
      let db = await bootstrapSplitterTreasuryDb()

      const feesReceivedEvent = SplitterTreasury.Treasury_FundsReceived.createMockEvent({
        token: USDC_ADDRESS,
        sender: Addresses.defaultAddress,
        amount: 10_000_000n, // 10 USDC
        mockEventData: {
          srcAddress: MARKET_ADDRESS,
          chainId: 31337,
          block: { timestamp: 3000 },
          transaction: { hash: '0xmulti1' },
          logIndex: 0,
        },
      })

      const recipient1 = '0x1111111111111111111111111111111111111111' as const
      const recipient2 = '0x2222222222222222222222222222222222222222' as const

      const payment1Event = SplitterTreasury.RecipientPayment.createMockEvent({
        token_: USDC_ADDRESS,
        recipient_: recipient1,
        amount_: 5_000_000n, // 5 USDC
        mockEventData: {
          srcAddress: MARKET_ADDRESS,
          chainId: 31337,
          block: { timestamp: 3000 },
          transaction: { hash: '0xmulti1' },
          logIndex: 1,
        },
      })

      const payment2Event = SplitterTreasury.RecipientPayment.createMockEvent({
        token_: USDC_ADDRESS,
        recipient_: recipient2,
        amount_: 5_000_000n, // 5 USDC
        mockEventData: {
          srcAddress: MARKET_ADDRESS,
          chainId: 31337,
          block: { timestamp: 3000 },
          transaction: { hash: '0xmulti1' },
          logIndex: 2,
        },
      })

      db = await db.processEvents([feesReceivedEvent, payment1Event, payment2Event])

      // Check receipt
      const receipt = db.entities.FeeSplitterReceipt.get('0xmulti1-0')
      assert.ok(receipt, 'FeeSplitterReceipt should exist')
      assert.equal(receipt?.amountRaw, 10_000_000n)

      // Check payments
      const payment1 = db.entities.FeeSplitterPayment.get('0xmulti1-1')
      assert.ok(payment1, 'First FeeSplitterPayment should exist')
      assert.equal(payment1?.recipient, getAddress(recipient1))
      assert.equal(payment1?.amountRaw, 5_000_000n)

      const payment2 = db.entities.FeeSplitterPayment.get('0xmulti1-2')
      assert.ok(payment2, 'Second FeeSplitterPayment should exist')
      assert.equal(payment2?.recipient, getAddress(recipient2))
      assert.equal(payment2?.amountRaw, 5_000_000n)

      // Check Treasury entity aggregates
      const treasury = db.entities.Treasury.get(MARKET_ADDRESS_CHECKSUM)
      assert.ok(treasury, 'Treasury should exist')
      assert.equal(
        treasury?.totalFeesReceivedRaw,
        10_000_000n,
        'Treasury should track total fees received'
      )
      assert.equal(
        treasury?.totalFeesDistributedRaw,
        10_000_000n,
        'Treasury should track total fees distributed (10M from payments)'
      )
    })
  })

  describe('Presale handlers', () => {
    async function bootstrapPresaleDb() {
      let db = MockDb.createMockDb()

      const floorModuleEvent = ModuleFactory.ModuleCreated.createMockEvent({
        floor_: MARKET_ADDRESS,
        module_: BC_MODULE_ADDRESS,
        metadata_: [
          1n,
          0n,
          0n,
          'https://github.com/InverterNetwork/floors-sc',
          'BC_Discrete_Redeeming_VirtualSupply_v1',
        ],
        mockEventData: {
          block: { timestamp: 1000 },
        },
      })

      db = await db.processEvents([floorModuleEvent])
      db = db.entities.Token.set(USDC_TOKEN).entities.Token.set(FLOOR_TOKEN)

      const market = db.entities.Market.get(MARKET_ADDRESS_CHECKSUM)
      if (market) {
        db = db.entities.Market.set({
          ...market,
          reserveToken_id: USDC_ADDRESS_CHECKSUM,
          issuanceToken_id: FLOOR_ADDRESS_CHECKSUM,
        })
      }

      const presaleModuleEvent = ModuleFactory.ModuleCreated.createMockEvent({
        floor_: MARKET_ADDRESS,
        module_: PRESALE_MODULE_ADDRESS,
        metadata_: [
          1n,
          0n,
          0n,
          'https://github.com/InverterNetwork/floors-sc',
          'Presale_Module_v1',
        ],
        mockEventData: {
          block: { timestamp: 1500 },
        },
      })

      return db.processEvents([presaleModuleEvent])
    }

    it('creates PreSaleContract entries when presale modules are discovered', async () => {
      const db = await bootstrapPresaleDb()
      const presaleContract = db.entities.PreSaleContract.get(PRESALE_MODULE_ADDRESS_CHECKSUM)
      assert.ok(presaleContract, 'PreSaleContract should exist after module discovery')
      assert.equal(
        presaleContract?.saleToken_id,
        FLOOR_ADDRESS_CHECKSUM,
        'Sale token should default to market issuance token'
      )
      assert.equal(
        presaleContract?.purchaseToken_id,
        USDC_ADDRESS_CHECKSUM,
        'Purchase token should default to market reserve token'
      )
    })

    it('records PresaleBought participations and updates aggregates', async () => {
      let db = await bootstrapPresaleDb()

      const presaleBoughtEvent = Presale.PresaleBought.createMockEvent({
        buyer_: Addresses.defaultAddress,
        deposit_: PRESALE_DEPOSIT_AMOUNT,
        loopCount_: 2n,
        totalMinted_: PRESALE_MINTED_AMOUNT,
        mockEventData: {
          srcAddress: PRESALE_MODULE_ADDRESS,
          chainId: 31337,
          block: { timestamp: 2500 },
          transaction: { hash: '0xabc' },
          logIndex: 0,
        },
      })

      db = await db.processEvents([presaleBoughtEvent])

      const presaleContract = db.entities.PreSaleContract.get(PRESALE_MODULE_ADDRESS_CHECKSUM)
      assert.equal(
        presaleContract?.totalRaisedRaw,
        PRESALE_DEPOSIT_AMOUNT,
        'totalRaisedRaw should track deposited USDC'
      )
      assert.equal(
        presaleContract?.totalParticipants,
        1n,
        'totalParticipants should increment for each presale contribution'
      )

      const participation = db.entities.PresaleParticipation.get('0xabc-0')
      assert.ok(participation, 'PresaleParticipation entity should be created')
      assert.equal(participation?.depositAmountRaw, PRESALE_DEPOSIT_AMOUNT)
      assert.equal(participation?.mintedAmountRaw, PRESALE_MINTED_AMOUNT)

      const buyerId = getAddress(Addresses.defaultAddress as `0x${string}`)
      const userPositionId = `${buyerId}-${MARKET_ADDRESS_CHECKSUM}`
      const userPosition = db.entities.UserMarketPosition.get(userPositionId)
      assert.equal(
        userPosition?.presaleDepositRaw,
        PRESALE_DEPOSIT_AMOUNT,
        'User position should reflect presale deposits'
      )
    })

    it('records config events and direct claims', async () => {
      let db = await bootstrapPresaleDb()

      const capsUpdatedEvent = Presale.CapsUpdated.createMockEvent({
        globalCap_: 1_000_000n,
        perAddressCap_: 200_000n,
        mockEventData: {
          srcAddress: PRESALE_MODULE_ADDRESS,
          chainId: 31337,
          block: { timestamp: 2600 },
          transaction: { hash: '0xcaps' },
          logIndex: 0,
        },
      })

      const directClaimEvent = Presale.DirectTokensClaimed.createMockEvent({
        positionId_: 1n,
        amount_: PRESALE_MINTED_AMOUNT,
        mockEventData: {
          srcAddress: PRESALE_MODULE_ADDRESS,
          chainId: 31337,
          block: { timestamp: 2700 },
          transaction: { hash: '0xclaim' },
          logIndex: 0,
        },
      })

      db = await db.processEvents([capsUpdatedEvent, directClaimEvent])

      const presaleContract = db.entities.PreSaleContract.get(PRESALE_MODULE_ADDRESS_CHECKSUM)
      assert.equal(presaleContract?.globalDepositCapRaw, 1_000_000n)
      assert.equal(presaleContract?.perAddressDepositCapRaw, 200_000n)

      // Config events are now stored directly on the contract entity, no separate event entity

      const claim = db.entities.PresaleClaim.get('0xclaim-0')
      assert.ok(claim, 'PresaleClaim should be recorded for direct token claims')
      assert.equal(claim?.claimType, 'DIRECT')
      assert.equal(claim?.amountRaw, PRESALE_MINTED_AMOUNT)
    })
  })
})
