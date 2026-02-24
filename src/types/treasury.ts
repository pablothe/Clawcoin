/**
 * Treasury on-chain state queried from the Safe and its modules.
 */
export interface TreasuryState {
  safeAddress: string;
  isDeployed: boolean;
  owners: string[];
  threshold: number;
  modules: string[];
  nonce: number;
  balances: TokenBalance[];
}

export interface TokenBalance {
  token: string; // Address (or "0x0" for native ETH)
  symbol: string;
  decimals: number;
  balance: string; // In base units
}

/**
 * Allowance state for a specific delegate/token pair.
 */
export interface AllowanceState {
  /** Maximum spendable amount per period */
  amount: bigint;
  /** Amount already spent in current period */
  spent: bigint;
  /** Reset period in minutes (0 = one-time) */
  resetTimeMin: number;
  /** Last reset timestamp in minutes */
  lastResetMin: number;
  /** Replay protection nonce */
  nonce: number;
}

/**
 * Result of a token swap operation.
 */
export interface SwapQuote {
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOut: string;
  executionPrice: string;
  priceImpact: string;
  route: string;
  fee: number;
  gasEstimate: string;
}

export interface SwapResult {
  transactionHash: string;
  amountIn: string;
  amountOut: string;
  gasUsed: string;
  timestamp: string;
}

/**
 * Emergency system state.
 */
export type EmergencyState = "normal" | "paused" | "shutdown";

export interface EmergencyStatus {
  state: EmergencyState;
  pausedAt?: string;
  pausedBy?: string;
  shutdownAt?: string;
  shutdownBy?: string;
  reason?: string;
}
