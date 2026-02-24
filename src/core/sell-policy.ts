/**
 * Deterministic sell policy — controls when and how much the bot can sell.
 *
 * All values denominated in USDC (on-chain measurable, 6 decimals).
 * The bot checks canSell() before every swap. Policy changes are BOARD-ONLY.
 *
 * Rules:
 *   1. maxSellPerDayUsdc: daily cap on USDC equivalent of sales
 *   2. maxSellPerTxUsdc: per-transaction cap
 *   3. minPoolLiquidityUsdc: minimum USDC reserves in pool (on-chain query)
 *   4. maxSlippageBps: maximum allowed slippage
 *   5. cooldownMinutes: minimum time between sells
 *   6. maxDailyTxCount: maximum number of sell transactions per day
 *   7. If no pool exists: bot cannot sell
 *   8. If liquidity < minimum: bot cannot sell
 */

import type { SellPolicyConfig } from "../types/config.js";

export interface SellState {
  /** USDC amount sold today (6 decimals) */
  soldTodayUsdc: bigint;
  /** Number of sell transactions today */
  txCountToday: number;
  /** Timestamp of last sell */
  lastSellTimestamp: number;
  /** Date string for the current tracking day (YYYY-MM-DD) */
  trackingDay: string;
}

export class SellPolicy {
  private state: SellState;
  private config: SellPolicyConfig;

  constructor(config: SellPolicyConfig) {
    this.config = config;
    this.state = {
      soldTodayUsdc: 0n,
      txCountToday: 0,
      lastSellTimestamp: 0,
      trackingDay: this.today(),
    };
  }

  /**
   * Check if a sell is allowed given the current state and pool conditions.
   * Returns { allowed: true } or { allowed: false, reason: string }.
   */
  canSell(params: {
    amountOutUsdc: bigint;
    poolLiquidityUsdc: bigint | null; // null = no pool
  }): { allowed: boolean; reason?: string } {
    // Reset daily counters if it's a new day
    this.maybeResetDaily();

    // Rule 7: No pool exists
    if (params.poolLiquidityUsdc === null) {
      return {
        allowed: false,
        reason: "No liquidity pool exists. Pool creation is a board-only action.",
      };
    }

    // Rule 8: Pool liquidity below minimum
    const minLiquidity = BigInt(this.config.minPoolLiquidityUsdc);
    if (params.poolLiquidityUsdc < minLiquidity) {
      return {
        allowed: false,
        reason: `Pool USDC reserves (${params.poolLiquidityUsdc}) below minimum (${minLiquidity})`,
      };
    }

    // Rule 2: Per-transaction cap
    const maxPerTx = BigInt(this.config.maxSellPerTxUsdc);
    if (params.amountOutUsdc > maxPerTx) {
      return {
        allowed: false,
        reason: `Amount (${params.amountOutUsdc}) exceeds per-tx cap (${maxPerTx})`,
      };
    }

    // Rule 1: Daily cap
    const maxPerDay = BigInt(this.config.maxSellPerDayUsdc);
    if (this.state.soldTodayUsdc + params.amountOutUsdc > maxPerDay) {
      return {
        allowed: false,
        reason: `Would exceed daily cap. Sold today: ${this.state.soldTodayUsdc}, ` +
          `requested: ${params.amountOutUsdc}, cap: ${maxPerDay}`,
      };
    }

    // Rule 6: Daily transaction count
    if (this.state.txCountToday >= this.config.maxDailyTxCount) {
      return {
        allowed: false,
        reason: `Daily transaction count (${this.state.txCountToday}) at limit (${this.config.maxDailyTxCount})`,
      };
    }

    // Rule 5: Cooldown
    const now = Math.floor(Date.now() / 1000);
    const cooldownSeconds = this.config.cooldownMinutes * 60;
    if (now - this.state.lastSellTimestamp < cooldownSeconds) {
      const remaining = cooldownSeconds - (now - this.state.lastSellTimestamp);
      return {
        allowed: false,
        reason: `Cooldown active. ${remaining} seconds remaining.`,
      };
    }

    return { allowed: true };
  }

  /**
   * Record a completed sell. Call after successful swap execution.
   */
  recordSell(amountOutUsdc: bigint): void {
    this.maybeResetDaily();
    this.state.soldTodayUsdc += amountOutUsdc;
    this.state.txCountToday += 1;
    this.state.lastSellTimestamp = Math.floor(Date.now() / 1000);
  }

  /**
   * Get current sell state for display.
   */
  getState(): SellState & { config: SellPolicyConfig } {
    this.maybeResetDaily();
    return { ...this.state, config: this.config };
  }

  /**
   * Get the maximum slippage in basis points.
   */
  getMaxSlippageBps(): number {
    return this.config.maxSlippageBps;
  }

  private maybeResetDaily(): void {
    const today = this.today();
    if (this.state.trackingDay !== today) {
      this.state = {
        soldTodayUsdc: 0n,
        txCountToday: 0,
        lastSellTimestamp: this.state.lastSellTimestamp,
        trackingDay: today,
      };
    }
  }

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }
}
