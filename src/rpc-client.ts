// RPC client helper for making contract calls via viem
// Chain-aware public client getter

import { createPublicClient, defineChain, http, type PublicClient } from 'viem'
import { avalanche } from 'viem/chains'

// RPC URL mapping from config.yaml
const DEFAULT_RPC_URL_31337 = 'https://vfgvanuabr.eu-central-1.awsapprunner.com/'

const RPC_URLS: Record<number, string> = {
  31337: process.env.RPC_URL_31337?.trim() || DEFAULT_RPC_URL_31337,
}

// Custom chain config for local Anvil (Avalanche fork)
// Spreads Avalanche config to inherit Multicall3 address
const localAnvil = defineChain({
  ...avalanche,
  id: 31337,
  name: 'Local Anvil',
  network: 'anvil',
  rpcUrls: {
    default: { http: [RPC_URLS[31337]] },
  },
})

// Cache for public clients per chain
const clientCache = new Map<number, PublicClient>()

/**
 * Get a viem public client for the specified chain ID
 * Clients are cached and reused for performance
 */
export function getPublicClient(chainId: number): PublicClient {
  // Return cached client if available
  const cached = clientCache.get(chainId)
  if (cached) {
    return cached
  }

  // Get RPC URL for chain
  const rpcUrl = RPC_URLS[chainId]
  if (!rpcUrl) {
    throw new Error(`No RPC URL configured for chain ID ${chainId}`)
  }

  // Create and cache public client
  const client = createPublicClient({
    chain: chainId === 31337 ? localAnvil : undefined,
    transport: http(rpcUrl, { batch: true }),
  })

  clientCache.set(chainId, client)
  return client
}
