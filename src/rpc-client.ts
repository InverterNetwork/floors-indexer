// RPC client helper for making contract calls via viem
// Chain-aware public client getter

import { type Address, createPublicClient, http, type PublicClient } from 'viem'

// RPC URL mapping from config.yaml
const DEFAULT_RPC_URL_31337 = 'https://vfgvanuabr.eu-central-1.awsapprunner.com/'

const RPC_URLS: Record<number, string> = {
  31337: process.env.RPC_URL_31337?.trim() || DEFAULT_RPC_URL_31337,
}

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
    transport: http(rpcUrl, { batch: true }),
  })

  clientCache.set(chainId, client)
  return client
}
