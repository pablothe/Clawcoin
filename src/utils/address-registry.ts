/**
 * Authoritative address resolution for on-chain contracts.
 *
 * Sources addresses from official deployment packages rather than hardcoding:
 * - Safe modules: @safe-global/safe-modules-deployments
 * - Uniswap V3: official deployment addresses
 * - Zodiac Roles: deployed per-Safe (no static address)
 *
 * All resolved addresses are checksum-validated before use.
 */

import { getAddress, isAddress } from "viem";

export interface UniswapAddresses {
  swapRouter02: string;
  quoterV2: string;
  factory: string;
}

/**
 * Resolve the AllowanceModule address for a given chain.
 * Uses @safe-global/safe-modules-deployments as the source of truth.
 */
export async function resolveAllowanceModule(
  chainId: number,
): Promise<string> {
  try {
    // Dynamic import to handle cases where the package isn't installed yet
    const deployments = await import("@safe-global/safe-modules-deployments");
    const deployment = deployments.getAllowanceModuleDeployment?.({
      network: String(chainId),
    });
    if (deployment?.networkAddresses?.[String(chainId)]) {
      const addr = deployment.networkAddresses[String(chainId)];
      const resolved = typeof addr === "string" ? addr : addr[0];
      return validateAddress(resolved, "AllowanceModule");
    }
  } catch {
    // Package not available — fall back to known addresses
  }

  // Fallback: known AllowanceModule deployments
  const knownAddresses: Record<number, string> = {
    // Base mainnet
    8453: "0xCFbFaC74C26F8647cBDb8c5caf80BB5b32E43134",
    // Base Sepolia
    84532: "0xCFbFaC74C26F8647cBDb8c5caf80BB5b32E43134",
    // Ethereum mainnet
    1: "0xCFbFaC74C26F8647cBDb8c5caf80BB5b32E43134",
  };

  const addr = knownAddresses[chainId];
  if (!addr) {
    throw new Error(
      `AllowanceModule address not found for chain ${chainId}. ` +
        `Ensure @safe-global/safe-modules-deployments supports this chain.`,
    );
  }
  return validateAddress(addr, "AllowanceModule");
}

/**
 * Resolve Uniswap V3 contract addresses for a given chain.
 * Sources from official Uniswap deployment tables.
 */
export async function resolveUniswapContracts(
  chainId: number,
): Promise<UniswapAddresses> {
  // Official Uniswap V3 deployment addresses per chain
  // Source: https://docs.uniswap.org/contracts/v3/reference/deployments
  const deployments: Record<number, UniswapAddresses> = {
    // Base mainnet
    8453: {
      swapRouter02: "0x2626664c2603336E57B271c5C0b26F421741e481",
      quoterV2: "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a",
      factory: "0x33128a8fC17869897dcE68Ed026d694621f6FDfD",
    },
    // Ethereum mainnet
    1: {
      swapRouter02: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45",
      quoterV2: "0x61fFE014bA17989E743c5F6cB21bF9697530B21e",
      factory: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
    },
    // Arbitrum One
    42161: {
      swapRouter02: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45",
      quoterV2: "0x61fFE014bA17989E743c5F6cB21bF9697530B21e",
      factory: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
    },
    // Optimism
    10: {
      swapRouter02: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45",
      quoterV2: "0x61fFE014bA17989E743c5F6cB21bF9697530B21e",
      factory: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
    },
  };

  const addresses = deployments[chainId];
  if (!addresses) {
    throw new Error(
      `Uniswap V3 addresses not found for chain ${chainId}. ` +
        `Supported chains: ${Object.keys(deployments).join(", ")}`,
    );
  }

  return {
    swapRouter02: validateAddress(addresses.swapRouter02, "SwapRouter02"),
    quoterV2: validateAddress(addresses.quoterV2, "QuoterV2"),
    factory: validateAddress(addresses.factory, "UniswapV3Factory"),
  };
}

/**
 * Validate and checksum an Ethereum address. Throws on invalid address.
 */
export function validateAddress(address: string, label: string): string {
  if (!isAddress(address)) {
    throw new Error(`Invalid ${label} address: ${address}`);
  }
  return getAddress(address); // Returns checksummed version
}
