// Factory event handlers for Floor Markets DeFi Platform
// Discovers new BC (bonding curve) and CreditFacility contracts

import { FloorFactory, ModuleFactory } from '../generated/src/Handlers.gen'
import {
  extractModuleType,
  fetchTokenAddressesFromBC,
  fetchTrustedForwarder,
  getOrCreateMarket,
  getOrCreateModuleRegistry,
  normalizeAddress,
  resolveMarketId,
} from './helpers'
import { handlerErrorWrapper } from './helpers/error'

/**
 * @notice Contract registration handler for FloorFactoryInitialized event
 * Fires BEFORE regular handlers to dynamically register the module factory
 * This tells Envio to start listening for events from the module factory
 */
FloorFactory.FloorFactoryInitialized.contractRegister(async ({ event, context }) => {
  const moduleFactoryAddress = event.params.moduleFactory_
  context.log.info(
    `[FloorFactoryInitialized] Registering module factory | moduleFactoryAddress=${moduleFactoryAddress}`
  )
  context.addModuleFactory(moduleFactoryAddress)
})

/**
 * @notice Regular event handler for FloorFactoryInitialized event
 * Populates GlobalRegistry with the floor factory, module factory, and trusted forwarder addresses
 */
FloorFactory.FloorFactoryInitialized.handler(async ({ event, context }) => {
  const moduleFactoryAddress = event.params.moduleFactory_
  const floorFactoryAddress = event.srcAddress as `0x${string}`

  context.log.info(
    `[FloorFactoryInitialized] Handler entry | moduleFactoryAddress=${moduleFactoryAddress}`
  )

  // Fetch trusted forwarder address from FloorFactory via RPC
  const trustedForwarderAddress = await fetchTrustedForwarder(event.chainId, floorFactoryAddress)

  if (trustedForwarderAddress) {
    context.log.info(
      `[FloorFactoryInitialized] ✅ Fetched trustedForwarder | address=${trustedForwarderAddress}`
    )
  } else {
    context.log.warn(
      `[FloorFactoryInitialized] ⚠️ Could not fetch trustedForwarder | floorFactory=${floorFactoryAddress}`
    )
  }

  context.GlobalRegistry.set({
    id: 'global-registry',
    floorFactoryAddress: normalizeAddress(floorFactoryAddress),
    moduleFactoryAddress: normalizeAddress(moduleFactoryAddress),
    trustedForwarderAddress: trustedForwarderAddress || '',
    createdAt: BigInt(event.block.timestamp),
    lastUpdatedAt: BigInt(event.block.timestamp),
  })
})

/**
 * @notice Contract registration handler for ModuleCreated event
 * Fires BEFORE regular handlers to dynamically register contracts
 * This tells Envio to start listening for events from newly created modules
 */
ModuleFactory.ModuleCreated.contractRegister(async ({ event, context }) => {
  const module = event.params.module_
  const metadata = event.params.metadata_
  const title = metadata[4]
  const moduleType = extractModuleType(title)

  context.log.info(
    `[contractRegister] Module detected | title=${title} | moduleType=${moduleType} | address=${module}`
  )

  // Register BC (bonding curve) modules for TokensBought/TokensSold event listening
  if (moduleType === 'floor') {
    context.addFloorMarket(module as `0x${string}`)
  }

  // Register CreditFacility modules for LoanCreated/LoanRepaid event listening
  if (moduleType === 'creditFacility') {
    context.addCreditFacility(module as `0x${string}`)
  }

  if (moduleType === 'presale') {
    context.addPresale(module as `0x${string}`)
  }

  // Register SplitterTreasury modules for fee distribution event listening
  if (moduleType === 'feeTreasury') {
    context.addSplitterTreasury(module as `0x${string}`)
  }

  // Register Authorizer modules for role management event listening
  if (moduleType === 'authorizer') {
    context.addAuthorizer(module as `0x${string}`)
  }
})

/**
 * @notice Regular event handler for ModuleCreated event
 * Populates ModuleRegistry and creates Market entity
 * for BC modules when they are first created
 */
ModuleFactory.ModuleCreated.handler(
  handlerErrorWrapper(async ({ event, context }) => {
    const orchestrator = event.params.floor_
    const module = event.params.module_
    const metadata = event.params.metadata_
    const title = metadata[4]
    const moduleType = extractModuleType(title)

    context.log.debug(
      `[ModuleCreated] Handler entry | moduleType=${moduleType} | address=${module} | block=${event.block.number} | logIndex=${event.logIndex}`
    )

    context.log.info(
      `[ModuleCreated] Regular event handler | title=${title} | moduleType=${moduleType} | address=${module}`
    )

    // Derive the canonical market ID shared by registry/market/facility records
    const marketId = resolveMarketId(orchestrator, module)

    // Get or create ModuleRegistry for this market using helper
    const registry = await getOrCreateModuleRegistry(
      context,
      marketId,
      moduleType,
      module,
      BigInt(event.block.timestamp)
    )

    // If this is a fundingManager module, create the Market entity
    let createdMarketForFloor: Awaited<ReturnType<typeof getOrCreateMarket>> = null

    if (moduleType === 'floor') {
      // Try to fetch token addresses from the BC contract via RPC
      context.log.debug(
        `[ModuleCreated] Fetching BC tokens | chainId=${event.chainId} | bcAddress=${module}`
      )
      const tokenAddresses = await fetchTokenAddressesFromBC(event.chainId, module as `0x${string}`)

      let reserveTokenId: string | undefined
      let issuanceTokenId: string | undefined

      if (tokenAddresses) {
        reserveTokenId = tokenAddresses.reserveToken
        issuanceTokenId = tokenAddresses.issuanceToken
        context.log.info(
          `[ModuleCreated] ✅ BC tokens fetched | reserveToken=${reserveTokenId} | issuanceToken=${issuanceTokenId}`
        )
      } else {
        context.log.warn(
          `[ModuleCreated] ⚠️ Unable to fetch BC tokens | bcAddress=${module} | falling back to placeholders`
        )
      }

      // Use the canonical market ID to ensure Market.id matches ModuleRegistry.id
      const creatorAddress = event.transaction.from || orchestrator

      const market = await getOrCreateMarket(
        context,
        event.chainId,
        marketId,
        BigInt(event.block.timestamp),
        reserveTokenId,
        issuanceTokenId,
        module as `0x${string}`,
        creatorAddress,
        event.srcAddress
      )

      if (!market) {
        context.log.error(
          `[ModuleCreated] ❌ Failed to initialize Market | marketId=${marketId} | bcAddress=${module}`
        )
      } else {
        createdMarketForFloor = market
        context.log.info(
          `[ModuleCreated] Market ready | id=${market.id} | reserveToken=${market.reserveToken_id} | issuanceToken=${market.issuanceToken_id}`
        )
      }
    }

    // If this is a creditFacility module, create the CreditFacilityContract entity
    if (moduleType === 'creditFacility') {
      const facilityId = normalizeAddress(module)
      context.log.debug(
        `[ModuleCreated] Preparing CreditFacility | facilityId=${facilityId} | marketId=${marketId}`
      )

      // Get the Market entity to get token addresses
      let market = await context.Market.get(marketId)

      if (!market && marketId !== facilityId) {
        context.log.debug(
          `[ModuleCreated] Market lookup fallback | trying facilityId=${facilityId}`
        )
        market = await context.Market.get(facilityId)
      }

      if (market) {
        const facility = {
          id: facilityId,
          market_id: market.id,
          collateralToken_id: market.issuanceToken_id,
          borrowToken_id: market.reserveToken_id,
          totalLoans: 0n,
          totalVolumeRaw: 0n,
          totalVolumeFormatted: '0',
          totalDebtRaw: 0n,
          totalDebtFormatted: '0',
          totalLockedCollateralRaw: 0n,
          totalLockedCollateralFormatted: '0',
          lastUpdatedAt: BigInt(event.block.timestamp),
          createdAt: BigInt(event.block.timestamp),
        }
        context.CreditFacilityContract.set(facility)
        context.log.info(
          `[ModuleCreated] CreditFacility created | id=${facilityId} | collateralToken=${market.issuanceToken_id} | borrowToken=${market.reserveToken_id}`
        )
      } else {
        context.log.warn(
          `[ModuleCreated] Market not found for creditFacility | marketId=${marketId} | facilityId=${facilityId} | action=Re-sync floor modules (clean restart) before processing facility events`
        )
      }
    }

    if (moduleType === 'presale') {
      const presaleId = normalizeAddress(module)
      const existing = await context.PreSaleContract.get(presaleId)

      if (existing) {
        context.log.debug(
          `[ModuleCreated] Presale already registered | presale=${presaleId} | marketId=${existing.market_id}`
        )
        return
      }

      let market = createdMarketForFloor
      if (!market) {
        market = (await context.Market.get(marketId)) ?? null
      }

      if (!market) {
        context.log.warn(
          `[ModuleCreated] Skipping presale bootstrap - market missing | presale=${presaleId} | marketId=${marketId}`
        )
        return
      }

      if (!market.issuanceToken_id || !market.reserveToken_id) {
        context.log.warn(
          `[ModuleCreated] Skipping presale bootstrap - token metadata missing | presale=${presaleId} | market=${market.id}`
        )
        return
      }

      const timestamp = BigInt(event.block.timestamp)
      const presaleRecord = {
        id: normalizeAddress(presaleId),
        saleToken_id: normalizeAddress(market.issuanceToken_id),
        purchaseToken_id: normalizeAddress(market.reserveToken_id),
        market_id: normalizeAddress(market.id),
        startTime: 0n,
        endTime: 0n,
        timeSafeguardTs: 0n,
        maxLeverage: 0n,
        currentState: 0,
        totalParticipants: 0n,
        totalRaisedRaw: 0n,
        totalRaisedFormatted: '0',
        globalDepositCapRaw: 0n,
        globalDepositCapFormatted: '0',
        perAddressDepositCapRaw: 0n,
        perAddressDepositCapFormatted: '0',
        whitelistSize: 0n,
        commissionBps: undefined,
        priceBreakpointsFlat: [],
        priceBreakpointOffsets: [],
        whitelistedAddresses: [],
        lendingFacility: undefined,
        authorizer: undefined,
        feeTreasury: undefined,
        createdAt: timestamp,
        lastUpdatedAt: timestamp,
      }

      context.PreSaleContract.set(presaleRecord)
      context.log.info(
        `[ModuleCreated] Presale contract registered | presale=${presaleRecord.id} | market=${presaleRecord.market_id}`
      )
    }

    // If this is an authorizer module, create the AuthorizerContract entity
    if (moduleType === 'authorizer') {
      const authorizerId = normalizeAddress(module)
      const existing = await context.AuthorizerContract.get(authorizerId)

      if (existing) {
        context.log.debug(
          `[ModuleCreated] Authorizer already registered | authorizer=${authorizerId}`
        )
        return
      }

      const timestamp = BigInt(event.block.timestamp)

      // Create AuthorizerContract entity
      const authorizerRecord = {
        id: authorizerId,
        floor: normalizeAddress(orchestrator),
        lastAssignedRoleId: 1n, // Start at 1 for DEFAULT_ADMIN_ROLE (0) and PUBLIC_ROLE (1)
        createdAt: timestamp,
        lastUpdatedAt: timestamp,
      }

      context.AuthorizerContract.set(authorizerRecord)

      // Create static roles: DEFAULT_ADMIN_ROLE and PUBLIC_ROLE
      const DEFAULT_ADMIN_ROLE =
        '0x0000000000000000000000000000000000000000000000000000000000000000'
      const PUBLIC_ROLE = '0x0000000000000000000000000000000000000000000000000000000000000001'

      // DEFAULT_ADMIN_ROLE (roleId = 0)
      context.Role.set({
        id: `${authorizerId}-${DEFAULT_ADMIN_ROLE}`,
        authorizer_id: authorizerId,
        roleId: DEFAULT_ADMIN_ROLE,
        name: 'DEFAULT_ADMIN_ROLE',
        adminRole: DEFAULT_ADMIN_ROLE,
        adminRoleName: 'DEFAULT_ADMIN_ROLE',
        isAdminBurned: false,
        createdAt: timestamp,
        lastUpdatedAt: timestamp,
      })

      // PUBLIC_ROLE (roleId = 1)
      context.Role.set({
        id: `${authorizerId}-${PUBLIC_ROLE}`,
        authorizer_id: authorizerId,
        roleId: PUBLIC_ROLE,
        name: 'PUBLIC_ROLE',
        adminRole: DEFAULT_ADMIN_ROLE,
        adminRoleName: 'DEFAULT_ADMIN_ROLE',
        isAdminBurned: false,
        createdAt: timestamp,
        lastUpdatedAt: timestamp,
      })

      context.log.info(
        `[ModuleCreated] Authorizer contract registered | authorizer=${authorizerId} | floor=${orchestrator}`
      )
    }
  })
)
