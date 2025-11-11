// Envio event handlers for Floor Markets DeFi Platform

import {
  CreditFacility,
  FloorMarket,
  FloorMarketFactory,
  PreSale,
  Staking,
  YieldStrategy,
} from '../generated/src/Handlers.gen'

/**
 * @notice Event handler for MarketCreated event
 */
FloorMarketFactory.MarketCreated.handler(async ({ event, context }) => {
  const factoryId = event.srcAddress
  let factory = await context.Factory.get(factoryId)

  if (!factory) {
    factory = {
      id: factoryId,
      totalMarkets: 0n,
      creationFee: 0n,
      feeCollector: '',
    }
  }

  // Create new factory object with updated totalMarkets
  const updatedFactory = {
    ...factory,
    totalMarkets: factory.totalMarkets + 1n,
  }
  context.Factory.set(updatedFactory)

  const creatorId = event.params.creator
  let creator = await context.Account.get(creatorId)

  if (!creator) {
    creator = {
      id: creatorId,
      balance: 0n,
      totalVolume: 0n,
      totalFeesPaid: 0n,
    }
  }

  context.Account.set(creator)

  const market = {
    id: event.params.market,
    name: event.params.name,
    symbol: event.params.symbol,
    description: '',
    creator_id: creator.id,
    factory_id: factory.id,
    reserveToken: event.params.reserveToken,
    initialPrice: 0n,
    currentPrice: 0n,
    floorPrice: 0n,
    totalSupply: 0n,
    maxSupply: 0n,
    tradingFeeBps: 0n,
    maxLTV: 0n,
    state: 'Active',
    createdAt: BigInt(event.block.timestamp),
  }

  context.Market.set(market)
})

/**
 * @notice Event handler for MarketCreationFeeUpdated event
 */
FloorMarketFactory.MarketCreationFeeUpdated.handler(async ({ event, context }) => {
  const factory = await context.Factory.get(event.srcAddress)
  if (factory) {
    const updatedFactory = {
      ...factory,
      creationFee: event.params.newFee,
    }
    context.Factory.set(updatedFactory)
  }
})

/**
 * @notice Event handler for FeeCollectorUpdated event
 */
FloorMarketFactory.FeeCollectorUpdated.handler(async ({ event, context }) => {
  const factory = await context.Factory.get(event.srcAddress)
  if (factory) {
    const updatedFactory = {
      ...factory,
      feeCollector: event.params.newCollector,
    }
    context.Factory.set(updatedFactory)
  }
})

/**
 * @notice Event handler for Buy event
 */
FloorMarket.Buy.handler(async ({ event, context }) => {
  const market = await context.Market.get(event.srcAddress)
  if (!market) return

  const userId = event.params.user
  let user = await context.Account.get(userId)
  if (!user) {
    user = {
      id: userId,
      balance: 0n,
      totalVolume: 0n,
      totalFeesPaid: 0n,
    }
  }

  const updatedUser = {
    ...user,
    totalVolume: user.totalVolume + event.params.reserveAmount,
    totalFeesPaid: user.totalFeesPaid + event.params.fee,
  }
  context.Account.set(updatedUser)

  const tradeId = `${event.transaction.hash}-${event.logIndex}`
  const trade = {
    id: tradeId,
    market_id: market.id,
    user_id: user.id,
    tradeType: 'Buy',
    tokenAmount: event.params.tokenAmount,
    reserveAmount: event.params.reserveAmount,
    fee: event.params.fee,
    newPrice: event.params.newPrice,
    timestamp: BigInt(event.block.timestamp),
    transactionHash: event.transaction.hash,
  }
  context.Trade.set(trade)

  // Update market current price
  const updatedMarket = {
    ...market,
    currentPrice: event.params.newPrice,
    totalSupply: market.totalSupply + event.params.tokenAmount,
  }
  context.Market.set(updatedMarket)
})

/**
 * @notice Event handler for Sell event
 */
FloorMarket.Sell.handler(async ({ event, context }) => {
  const market = await context.Market.get(event.srcAddress)
  if (!market) return

  const userId = event.params.user
  let user = await context.Account.get(userId)
  if (!user) {
    user = {
      id: userId,
      balance: 0n,
      totalVolume: 0n,
      totalFeesPaid: 0n,
    }
  }

  const updatedUser = {
    ...user,
    totalVolume: user.totalVolume + event.params.reserveAmount,
    totalFeesPaid: user.totalFeesPaid + event.params.fee,
  }
  context.Account.set(updatedUser)

  const tradeId = `${event.transaction.hash}-${event.logIndex}`
  const trade = {
    id: tradeId,
    market_id: market.id,
    user_id: user.id,
    tradeType: 'Sell',
    tokenAmount: event.params.tokenAmount,
    reserveAmount: event.params.reserveAmount,
    fee: event.params.fee,
    newPrice: event.params.newPrice,
    timestamp: BigInt(event.block.timestamp),
    transactionHash: event.transaction.hash,
  }
  context.Trade.set(trade)

  // Update market current price
  const updatedMarket = {
    ...market,
    currentPrice: event.params.newPrice,
    totalSupply: market.totalSupply - event.params.tokenAmount,
  }
  context.Market.set(updatedMarket)
})

/**
 * @notice Event handler for FloorElevated event
 */
FloorMarket.FloorElevated.handler(async ({ event, context }) => {
  const market = await context.Market.get(event.srcAddress)
  if (!market) return

  const elevationId = `${event.transaction.hash}-${event.logIndex}`
  const elevation = {
    id: elevationId,
    market_id: market.id,
    oldFloorPrice: event.params.oldFloorPrice,
    newFloorPrice: event.params.newFloorPrice,
    deployedAmount: event.params.deployedAmount,
    timestamp: BigInt(event.block.timestamp),
    transactionHash: event.transaction.hash,
  }
  context.FloorElevation.set(elevation)

  // Update market floor price
  const updatedMarket = {
    ...market,
    floorPrice: event.params.newFloorPrice,
  }
  context.Market.set(updatedMarket)
})

/**
 * @notice Event handler for FeeDistributed event
 */
FloorMarket.FeeDistributed.handler(async ({ event, context }) => {
  const market = await context.Market.get(event.srcAddress)
  if (!market) return

  const distributionId = `${event.transaction.hash}-${event.logIndex}`
  const distribution = {
    id: distributionId,
    market_id: market.id,
    floorAmount: event.params.floorAmount,
    stakingAmount: event.params.stakingAmount,
    treasuryAmount: event.params.treasuryAmount,
    timestamp: BigInt(event.block.timestamp),
    transactionHash: event.transaction.hash,
  }
  context.FeeDistribution.set(distribution)
})

/**
 * @notice Event handler for LoanOriginated event
 */
CreditFacility.LoanOriginated.handler(async ({ event, context }) => {
  const facilityId = event.srcAddress
  let facility = await context.CreditFacility.get(facilityId)
  if (!facility) {
    facility = {
      id: facilityId,
      collateralToken: '',
      borrowToken: '',
      totalLoans: 0n,
      totalVolume: 0n,
    }
  }

  const updatedFacility = {
    ...facility,
    totalLoans: facility.totalLoans + 1n,
    totalVolume: facility.totalVolume + event.params.borrowAmount,
  }
  context.CreditFacility.set(updatedFacility)

  const borrowerId = event.params.borrower
  let borrower = await context.Account.get(borrowerId)
  if (!borrower) {
    borrower = {
      id: borrowerId,
      balance: 0n,
      totalVolume: 0n,
      totalFeesPaid: 0n,
    }
  }
  context.Account.set(borrower)

  const loanId = `${event.transaction.hash}-${event.logIndex}`
  const loan = {
    id: loanId,
    borrower_id: borrower.id,
    facility_id: facility.id,
    collateralAmount: event.params.collateralAmount,
    borrowAmount: event.params.borrowAmount,
    originationFee: event.params.originationFee,
    timestamp: BigInt(event.block.timestamp),
    transactionHash: event.transaction.hash,
    status: 'Active',
  }
  context.Loan.set(loan)
})

/**
 * @notice Event handler for LoanRepaid event
 */
CreditFacility.LoanRepaid.handler(async ({ event, context }) => {
  const borrowerId = event.params.borrower
  let borrower = await context.Account.get(borrowerId)
  if (!borrower) {
    borrower = {
      id: borrowerId,
      balance: 0n,
      totalVolume: 0n,
      totalFeesPaid: 0n,
    }
  }
  context.Account.set(borrower)

  // Get the facility for the loan
  const facilityId = event.srcAddress
  let facility = await context.CreditFacility.get(facilityId)
  if (!facility) {
    facility = {
      id: facilityId,
      collateralToken: '',
      borrowToken: '',
      totalLoans: 0n,
      totalVolume: 0n,
    }
    context.CreditFacility.set(facility)
  }

  const loanId = `${event.transaction.hash}-${event.logIndex}`
  const loan = {
    id: loanId,
    borrower_id: borrower.id,
    facility_id: facility.id,
    collateralAmount: 0n,
    borrowAmount: event.params.repayAmount,
    originationFee: 0n,
    timestamp: BigInt(event.block.timestamp),
    transactionHash: event.transaction.hash,
    status: 'Repaid',
  }
  context.Loan.set(loan)
})

/**
 * @notice Event handler for Staked event
 */
Staking.Staked.handler(async ({ event, context }) => {
  const contractId = event.srcAddress
  let contract = await context.StakingContract.get(contractId)
  if (!contract) {
    contract = {
      id: contractId,
      stakingToken: '',
      rewardToken: '',
      totalStaked: 0n,
      totalRewards: 0n,
    }
  }

  const updatedContract = {
    ...contract,
    totalStaked: contract.totalStaked + event.params.amount,
  }
  context.StakingContract.set(updatedContract)

  const userId = event.params.user
  let user = await context.Account.get(userId)
  if (!user) {
    user = {
      id: userId,
      balance: 0n,
      totalVolume: 0n,
      totalFeesPaid: 0n,
    }
  }
  context.Account.set(user)

  const stakeId = `${event.transaction.hash}-${event.logIndex}`
  const stake = {
    id: stakeId,
    user_id: user.id,
    contract_id: contract.id,
    amount: event.params.amount,
    lockDuration: event.params.lockDuration,
    timestamp: BigInt(event.block.timestamp),
    transactionHash: event.transaction.hash,
    status: 'Active',
  }
  context.Stake.set(stake)
})

/**
 * @notice Event handler for Unstaked event
 */
Staking.Unstaked.handler(async ({ event, context }) => {
  const userId = event.params.user
  let user = await context.Account.get(userId)
  if (!user) {
    user = {
      id: userId,
      balance: 0n,
      totalVolume: 0n,
      totalFeesPaid: 0n,
    }
  }
  context.Account.set(user)

  // Get the staking contract
  const contractId = event.srcAddress
  let contract = await context.StakingContract.get(contractId)
  if (!contract) {
    contract = {
      id: contractId,
      stakingToken: '',
      rewardToken: '',
      totalStaked: 0n,
      totalRewards: 0n,
    }
    context.StakingContract.set(contract)
  }

  const stakeId = `${event.transaction.hash}-${event.logIndex}`
  const stake = {
    id: stakeId,
    user_id: user.id,
    contract_id: contract.id,
    amount: event.params.amount,
    lockDuration: 0n,
    timestamp: BigInt(event.block.timestamp),
    transactionHash: event.transaction.hash,
    status: 'Unstaked',
  }
  context.Stake.set(stake)
})

/**
 * @notice Event handler for PresaleParticipated event
 */
PreSale.PresaleParticipated.handler(async ({ event, context }) => {
  const presaleId = event.srcAddress
  let presale = await context.PreSaleContract.get(presaleId)
  if (!presale) {
    presale = {
      id: presaleId,
      saleToken: '',
      purchaseToken: '',
      startTime: 0n,
      endTime: 0n,
      maxLeverage: 0n,
      totalRaised: 0n,
      totalParticipants: 0n,
    }
  }

  const updatedPresale = {
    ...presale,
    totalRaised: presale.totalRaised + event.params.amount,
    totalParticipants: presale.totalParticipants + 1n,
  }
  context.PreSaleContract.set(updatedPresale)

  const userId = event.params.user
  let user = await context.Account.get(userId)
  if (!user) {
    user = {
      id: userId,
      balance: 0n,
      totalVolume: 0n,
      totalFeesPaid: 0n,
    }
  }
  context.Account.set(user)

  const participationId = `${event.transaction.hash}-${event.logIndex}`
  const participation = {
    id: participationId,
    user_id: user.id,
    presale_id: presale.id,
    amount: event.params.amount,
    leverage: event.params.leverage,
    timestamp: BigInt(event.block.timestamp),
    transactionHash: event.transaction.hash,
  }
  context.PresaleParticipation.set(participation)
})

/**
 * @notice Event handler for StrategyDeployed event
 */
YieldStrategy.StrategyDeployed.handler(async ({ event, context }) => {
  const strategyId = event.srcAddress
  let strategy = await context.YieldStrategy.get(strategyId)
  if (!strategy) {
    strategy = {
      id: strategyId,
      asset: '',
      totalDeployed: 0n,
      totalHarvested: 0n,
      performanceFee: 0n,
      status: 'Active',
    }
  }

  const updatedStrategy = {
    ...strategy,
    totalDeployed: strategy.totalDeployed + event.params.amount,
  }
  context.YieldStrategy.set(updatedStrategy)
})

/**
 * @notice Event handler for YieldHarvested event
 */
YieldStrategy.YieldHarvested.handler(async ({ event, context }) => {
  const strategy = await context.YieldStrategy.get(event.srcAddress)
  if (strategy) {
    const updatedStrategy = {
      ...strategy,
      totalHarvested: strategy.totalHarvested + event.params.amount,
    }
    context.YieldStrategy.set(updatedStrategy)
  }
})
