import type { handlerContext } from 'generated'
import type { Token_t } from 'generated/src/db/Entities.gen'
import type { Abi } from 'viem'
import { erc20Abi } from 'viem'

import ERC20IssuanceABIJson from '../../abis/ERC20Issuance_v1.json'
import FLOOR_ABI from '../../abis/Floor_v1.json'
import { getPublicClient } from '../rpc-client'
import { formatAmount, normalizeAddress } from './misc'

const ERC20IssuanceABI = ERC20IssuanceABIJson as Abi
const CAP_FUNCTION_ABI = ERC20IssuanceABI.filter(
  (entry: Abi[number]) => entry.type === 'function' && entry.name === 'cap'
) as Abi

/**
 * Fetch token metadata from the contract
 * @param chainId - The chain ID
 * @param tokenAddress - The token address
 * @returns The token metadata
 */
export async function fetchTokenMetadata(chainId: number, tokenAddress: string) {
  let name = 'Unknown Token'
  let symbol = 'UNK'
  let decimals = 18
  let maxSupplyRaw = 0n

  const publicClient = getPublicClient(chainId)

  const contractName = await publicClient.readContract({
    address: tokenAddress as `0x${string}`,
    abi: erc20Abi,
    functionName: 'name',
  })

  if (contractName) {
    name = contractName
  }

  const contractSymbol = await publicClient.readContract({
    address: tokenAddress as `0x${string}`,
    abi: erc20Abi,
    functionName: 'symbol',
  })

  if (contractSymbol) {
    symbol = contractSymbol
  }

  const contractDecimals = await publicClient.readContract({
    address: tokenAddress as `0x${string}`,
    abi: erc20Abi,
    functionName: 'decimals',
  })

  if (contractDecimals) {
    decimals = contractDecimals
  }

  try {
    const capValue = await publicClient.readContract({
      address: tokenAddress as `0x${string}`,
      abi: CAP_FUNCTION_ABI,
      functionName: 'cap',
    })

    if (typeof capValue === 'bigint') {
      maxSupplyRaw = capValue
    }
  } catch {
    try {
      const totalSupplyValue = await publicClient.readContract({
        address: tokenAddress as `0x${string}`,
        abi: erc20Abi,
        functionName: 'totalSupply',
      })

      if (typeof totalSupplyValue === 'bigint') {
        maxSupplyRaw = totalSupplyValue
      }
    } catch {
      maxSupplyRaw = 0n
    }
  }

  return {
    name,
    symbol,
    decimals,
    maxSupplyRaw,
    maxSupplyFormatted: formatAmount(maxSupplyRaw, decimals).formatted,
  }
}

/**
 * Get or create Token entity
 * Stores token info with decimals
 */
export async function getOrCreateToken(
  context: handlerContext,
  chainId: number,
  address: string
): Promise<Token_t> {
  const normalizedAddress = normalizeAddress(address)
  let token = await context.Token.get(normalizedAddress)

  if (!token) {
    const metadata = await fetchTokenMetadata(chainId, normalizedAddress)
    token = {
      id: normalizedAddress,
      name: metadata.name,
      symbol: metadata.symbol,
      decimals: metadata.decimals,
      maxSupplyRaw: metadata.maxSupplyRaw,
      maxSupplyFormatted: metadata.maxSupplyFormatted,
    }
    context.Token.set(token)
  }

  return token
}

/**
 * Fetch token addresses from BC (bonding curve) contract via RPC
 * Calls getIssuanceToken() and getCollateralToken() view functions
 */
export async function fetchTokenAddressesFromBC(
  chainId: number,
  bcAddress: `0x${string}`
): Promise<{ issuanceToken: `0x${string}`; reserveToken: `0x${string}` } | null> {
  if (process.env.MOCK_RPC === 'true') {
    return null
  }

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
        issuanceToken: normalizeAddress(issuanceToken) as `0x${string}`,
        reserveToken: normalizeAddress(reserveToken) as `0x${string}`,
      }
    }
  } catch (error) {
    // RPC call failed - return null
    // Tokens can be created later with placeholder values
  }

  return null
}
