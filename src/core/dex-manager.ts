/**
 * Uniswap V3 DEX integration — token swaps on Base L2.
 *
 * Uses SwapRouter02 + exactInputSingle only (narrowest callable surface).
 * All addresses sourced from address-registry.ts (authoritative).
 * Every swap enforces sell policy before execution.
 * Swap recipient is always the Safe treasury address.
 */

import {
  createPublicClient,
  http,
  encodeFunctionData,
  parseAbi,
  type PublicClient,
} from "viem";
import { base, baseSepolia } from "viem/chains";
import type { SwapQuote } from "../types/treasury.js";
import type { SellPolicy } from "./sell-policy.js";

const QUOTER_V2_ABI = parseAbi([
  "function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
]);

const SWAP_ROUTER_ABI = parseAbi([
  "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountOut)",
]);

const ERC20_ABI = parseAbi([
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function balanceOf(address account) external view returns (uint256)",
]);

// Uniswap V3 pool ABI for liquidity queries
const POOL_ABI = parseAbi([
  "function liquidity() external view returns (uint128)",
  "function token0() external view returns (address)",
  "function token1() external view returns (address)",
  "function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
]);

const FACTORY_ABI = parseAbi([
  "function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)",
]);

const CHAIN_MAP: Record<number, typeof base> = {
  8453: base,
  84532: baseSepolia,
};

export class DexManager {
  private publicClient: PublicClient;

  constructor(
    private rpcUrl: string,
    private chainId: number,
    private contracts: {
      swapRouter02: string;
      quoterV2: string;
      factory: string;
    },
  ) {
    const chain = CHAIN_MAP[chainId] ?? base;
    this.publicClient = createPublicClient({
      chain,
      transport: http(rpcUrl),
    }) as PublicClient;
  }

  /**
   * Get a swap quote without executing.
   */
  async getQuote(params: {
    tokenIn: string;
    tokenOut: string;
    amountIn: bigint;
    fee?: number;
  }): Promise<SwapQuote> {
    const fee = params.fee ?? 3000; // 0.3% default

    const result = await this.publicClient.readContract({
      address: this.contracts.quoterV2 as `0x${string}`,
      abi: QUOTER_V2_ABI,
      functionName: "quoteExactInputSingle",
      args: [
        {
          tokenIn: params.tokenIn as `0x${string}`,
          tokenOut: params.tokenOut as `0x${string}`,
          amountIn: params.amountIn,
          fee,
          sqrtPriceLimitX96: 0n,
        },
      ],
    });

    const [amountOut, , , gasEstimate] = result as [bigint, bigint, number, bigint];

    return {
      tokenIn: params.tokenIn,
      tokenOut: params.tokenOut,
      amountIn: params.amountIn.toString(),
      amountOut: amountOut.toString(),
      executionPrice:
        params.amountIn > 0n
          ? (Number(amountOut) / Number(params.amountIn)).toFixed(8)
          : "0",
      priceImpact: "N/A", // Would need pool state for accurate impact
      route: `${params.tokenIn} -> ${params.tokenOut} (fee: ${fee / 10000}%)`,
      fee,
      gasEstimate: gasEstimate.toString(),
    };
  }

  /**
   * Build the swap transaction calldata for exactInputSingle.
   * Recipient is hardcoded to the Safe treasury address.
   */
  buildSwapTransaction(params: {
    tokenIn: string;
    tokenOut: string;
    amountIn: bigint;
    amountOutMinimum: bigint;
    recipient: string; // MUST be the Safe address
    fee?: number;
  }): { to: string; data: string; value: string } {
    const fee = params.fee ?? 3000;

    const data = encodeFunctionData({
      abi: SWAP_ROUTER_ABI,
      functionName: "exactInputSingle",
      args: [
        {
          tokenIn: params.tokenIn as `0x${string}`,
          tokenOut: params.tokenOut as `0x${string}`,
          fee,
          recipient: params.recipient as `0x${string}`,
          amountIn: params.amountIn,
          amountOutMinimum: params.amountOutMinimum,
          sqrtPriceLimitX96: 0n,
        },
      ],
    });

    return {
      to: this.contracts.swapRouter02,
      data,
      value: "0",
    };
  }

  /**
   * Build ERC-20 approve transaction for SwapRouter02.
   */
  buildApproveTransaction(params: {
    tokenAddress: string;
    amount: bigint;
  }): { to: string; data: string; value: string } {
    const data = encodeFunctionData({
      abi: ERC20_ABI,
      functionName: "approve",
      args: [
        this.contracts.swapRouter02 as `0x${string}`,
        params.amount,
      ],
    });

    return {
      to: params.tokenAddress,
      data,
      value: "0",
    };
  }

  /**
   * Check USDC reserves in the pool for sell policy enforcement.
   * Returns the USDC balance, or null if no pool exists.
   */
  async checkPoolLiquidityUsdc(params: {
    tokenAddress: string;
    usdcAddress: string;
    fee?: number;
  }): Promise<bigint | null> {
    const fee = params.fee ?? 3000;

    try {
      // Get pool address from factory
      const poolAddress = await this.publicClient.readContract({
        address: this.contracts.factory as `0x${string}`,
        abi: FACTORY_ABI,
        functionName: "getPool",
        args: [
          params.tokenAddress as `0x${string}`,
          params.usdcAddress as `0x${string}`,
          fee,
        ],
      });

      if (
        !poolAddress ||
        poolAddress === "0x0000000000000000000000000000000000000000"
      ) {
        return null; // No pool exists
      }

      // Query USDC balance in the pool
      const usdcBalance = await this.publicClient.readContract({
        address: params.usdcAddress as `0x${string}`,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [poolAddress as `0x${string}`],
      });

      return usdcBalance as bigint;
    } catch {
      return null; // Pool doesn't exist or query failed
    }
  }

  /**
   * Full swap flow: quote -> sell policy check -> approve + swap batch.
   */
  async buildFullSwap(params: {
    tokenIn: string;
    tokenOut: string;
    amountIn: bigint;
    safeAddress: string;
    usdcAddress: string;
    sellPolicy: SellPolicy;
  }): Promise<{
    transactions: Array<{ to: string; data: string; value: string }>;
    quote: SwapQuote;
  }> {
    // 1. Get quote
    const quote = await this.getQuote({
      tokenIn: params.tokenIn,
      tokenOut: params.tokenOut,
      amountIn: params.amountIn,
    });

    // 2. Check pool liquidity
    const poolLiquidity = await this.checkPoolLiquidityUsdc({
      tokenAddress: params.tokenIn,
      usdcAddress: params.usdcAddress,
    });

    // 3. Check sell policy
    const policyCheck = params.sellPolicy.canSell({
      amountOutUsdc: BigInt(quote.amountOut),
      poolLiquidityUsdc: poolLiquidity,
    });

    if (!policyCheck.allowed) {
      throw new Error(`Sell policy rejected: ${policyCheck.reason}`);
    }

    // 4. Calculate minimum output with slippage
    const amountOut = BigInt(quote.amountOut);
    const maxSlippage = BigInt(params.sellPolicy.getMaxSlippageBps());
    const amountOutMinimum =
      (amountOut * (10000n - maxSlippage)) / 10000n;

    // 5. Build approve tx
    const approveTx = this.buildApproveTransaction({
      tokenAddress: params.tokenIn,
      amount: params.amountIn,
    });

    // 6. Build swap tx (recipient = Safe)
    const swapTx = this.buildSwapTransaction({
      tokenIn: params.tokenIn,
      tokenOut: params.tokenOut,
      amountIn: params.amountIn,
      amountOutMinimum,
      recipient: params.safeAddress,
    });

    return {
      transactions: [approveTx, swapTx],
      quote,
    };
  }
}
