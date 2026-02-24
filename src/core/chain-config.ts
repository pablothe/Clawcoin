/**
 * Per-chain contract addresses and configuration.
 *
 * Addresses are sourced from authoritative packages (address-registry.ts)
 * and cached after first resolution. Tests validate these against the
 * source packages.
 */

import {
  resolveAllowanceModule,
  resolveUniswapContracts,
  validateAddress,
  type UniswapAddresses,
} from "../utils/address-registry.js";

export interface ChainConfig {
  chainId: number;
  name: string;
  rpcUrl: string;
  blockExplorer: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  contracts: {
    usdc: string;
    weth: string;
    uniswap: UniswapAddresses;
    allowanceModule: string;
    // Zodiac Roles Modifier is deployed per-Safe, not a singleton
  };
}

// Static chain metadata (addresses resolved at init time)
const CHAIN_METADATA: Record<
  number,
  Omit<ChainConfig, "contracts"> & {
    contracts: { usdc: string; weth: string };
  }
> = {
  8453: {
    chainId: 8453,
    name: "Base",
    rpcUrl: "https://mainnet.base.org",
    blockExplorer: "https://basescan.org",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    contracts: {
      usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      weth: "0x4200000000000000000000000000000000000006",
    },
  },
  84532: {
    chainId: 84532,
    name: "Base Sepolia",
    rpcUrl: "https://sepolia.base.org",
    blockExplorer: "https://sepolia.basescan.org",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    contracts: {
      // Base Sepolia USDC (Circle's testnet deployment)
      usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      weth: "0x4200000000000000000000000000000000000006",
    },
  },
  1: {
    chainId: 1,
    name: "Ethereum",
    rpcUrl: "https://eth.llamarpc.com",
    blockExplorer: "https://etherscan.io",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    contracts: {
      usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      weth: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    },
  },
};

// Cache for resolved configs
const resolvedCache = new Map<number, ChainConfig>();

/**
 * Get the full chain configuration with all contract addresses resolved
 * from authoritative sources. Caches the result.
 */
export async function getChainConfig(
  chainId: number,
  rpcUrlOverride?: string,
): Promise<ChainConfig> {
  const cached = resolvedCache.get(chainId);
  if (cached) return cached;

  const meta = CHAIN_METADATA[chainId];
  if (!meta) {
    throw new Error(
      `Unsupported chain: ${chainId}. Supported: ${Object.keys(CHAIN_METADATA).join(", ")}`,
    );
  }

  // Resolve addresses from authoritative sources
  const [allowanceModule, uniswap] = await Promise.all([
    resolveAllowanceModule(chainId),
    resolveUniswapContracts(chainId).catch(() => null),
  ]);

  const config: ChainConfig = {
    ...meta,
    rpcUrl: rpcUrlOverride ?? meta.rpcUrl,
    contracts: {
      usdc: validateAddress(meta.contracts.usdc, "USDC"),
      weth: validateAddress(meta.contracts.weth, "WETH"),
      uniswap: uniswap ?? {
        swapRouter02: "",
        quoterV2: "",
        factory: "",
      },
      allowanceModule,
    },
  };

  resolvedCache.set(chainId, config);
  return config;
}

/**
 * Get chain metadata without resolving dynamic addresses.
 * Useful for display / non-transaction contexts.
 */
export function getChainMetadata(chainId: number) {
  const meta = CHAIN_METADATA[chainId];
  if (!meta) {
    throw new Error(`Unsupported chain: ${chainId}`);
  }
  return meta;
}

/**
 * List all supported chain IDs.
 */
export function supportedChains(): number[] {
  return Object.keys(CHAIN_METADATA).map(Number);
}

/**
 * Clear the resolved config cache (useful for testing).
 */
export function clearChainConfigCache(): void {
  resolvedCache.clear();
}
