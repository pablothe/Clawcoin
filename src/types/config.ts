/**
 * Plugin configuration stored in openclaw.json under the crypto-treasury plugin.
 */
export interface CryptoTreasuryPluginConfig {
  chainId: number;
  rpcUrl: string;
  safeAddress?: string;
  tokenAddress?: string;
  keystorePath: string;
  auditLogPath: string;
  whitelistedRecipients: string[];
}

/**
 * Full treasury state combining on-chain and local config.
 */
export interface TreasuryFullConfig {
  // Identity
  botName: string;
  chainId: number;

  // Safe
  safeAddress: string;
  owners: string[];
  threshold: number;

  // Modules
  allowanceModuleAddress: string;
  rolesModifierAddress: string;

  // Token
  tokenAddress: string;
  tokenName: string;
  tokenSymbol: string;
  tokenTotalSupply: string;

  // Vesting
  vestingAddress: string;
  vestingCliffMonths: number;
  vestingDurationMonths: number;

  // Bot delegate
  botDelegateAddress: string;

  // Allowance
  allowanceToken: string; // USDC address
  allowanceAmount: string; // Period limit in base units
  allowanceResetMinutes: number;

  // Sell policy
  sellPolicy: SellPolicyConfig;

  // Paths
  keystorePath: string;
  auditLogPath: string;

  // Emergency
  emergencyState: "normal" | "paused" | "shutdown";
}

/**
 * Sell policy — all values denominated in USDC (on-chain measurable).
 */
export interface SellPolicyConfig {
  maxSellPerDayUsdc: string;       // e.g., "500000000" (500 USDC, 6 decimals)
  maxSellPerTxUsdc: string;        // e.g., "100000000" (100 USDC)
  minPoolLiquidityUsdc: string;    // e.g., "10000000000" (10,000 USDC reserves)
  maxSlippageBps: number;          // e.g., 100 (1%)
  cooldownMinutes: number;         // e.g., 60
  maxDailyTxCount: number;         // e.g., 5
}
