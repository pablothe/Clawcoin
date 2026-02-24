/**
 * AllowanceModule management — spending limits for the bot delegate.
 *
 * The bot CAN:
 *   - Spend within its existing allowance (executeAllowanceTransfer)
 *   - Query its remaining allowance (getTokenAllowance)
 *
 * The bot CANNOT (board-only):
 *   - Add/remove delegates (addDelegate, removeDelegate)
 *   - Set/change allowance amounts (setAllowance)
 *   - Reset spent counters (resetAllowance)
 *   - Delete allowances (deleteAllowance)
 */

import { encodeFunctionData, parseAbi, type PublicClient } from "viem";
import type { SafeTransactionDataPartial } from "@safe-global/safe-core-sdk-types";
import type { AllowanceState } from "../types/treasury.js";

const ALLOWANCE_MODULE_ABI = parseAbi([
  "function addDelegate(address delegate) external",
  "function removeDelegate(address delegate, bool removeAllowances) external",
  "function setAllowance(address delegate, address token, uint96 allowanceAmount, uint16 resetTimeMin, uint32 resetBaseMin) external",
  "function executeAllowanceTransfer(address safe, address token, address payable to, uint96 amount, address paymentToken, uint96 payment, address delegate, bytes signature) external",
  "function getTokenAllowance(address safe, address delegate, address token) external view returns (uint256[5])",
  "function resetAllowance(address delegate, address token) external",
  "function deleteAllowance(address delegate, address token) external",
  "function getDelegates(address safe, uint48 start, uint8 pageSize) external view returns (address[], uint48)",
]);

export interface AllowanceConfig {
  delegateAddress: string;
  token: string;
  amount: bigint;
  resetTimeMinutes: number;
}

export class AllowanceManager {
  constructor(private moduleAddress: string) {}

  // ─── BOARD-ONLY OPERATIONS (return tx data for proposals) ───

  /**
   * Build transaction to add the bot as a delegate.
   * BOARD-ONLY: must be executed via Safe multi-sig.
   */
  buildAddDelegateTx(delegate: string): SafeTransactionDataPartial {
    return {
      to: this.moduleAddress,
      value: "0",
      data: encodeFunctionData({
        abi: ALLOWANCE_MODULE_ABI,
        functionName: "addDelegate",
        args: [delegate as `0x${string}`],
      }),
    };
  }

  /**
   * Build transaction to set spending allowance for a delegate.
   * BOARD-ONLY: must be executed via Safe multi-sig.
   */
  buildSetAllowanceTx(config: AllowanceConfig): SafeTransactionDataPartial {
    return {
      to: this.moduleAddress,
      value: "0",
      data: encodeFunctionData({
        abi: ALLOWANCE_MODULE_ABI,
        functionName: "setAllowance",
        args: [
          config.delegateAddress as `0x${string}`,
          config.token as `0x${string}`,
          config.amount,
          config.resetTimeMinutes,
          0, // resetBaseMin: 0 = reset from now
        ],
      }),
    };
  }

  /**
   * Build transaction to reset the spent counter for a delegate.
   * BOARD-ONLY: must be executed via Safe multi-sig.
   */
  buildResetAllowanceTx(
    delegate: string,
    token: string,
  ): SafeTransactionDataPartial {
    return {
      to: this.moduleAddress,
      value: "0",
      data: encodeFunctionData({
        abi: ALLOWANCE_MODULE_ABI,
        functionName: "resetAllowance",
        args: [delegate as `0x${string}`, token as `0x${string}`],
      }),
    };
  }

  /**
   * Build transaction to delete an allowance entirely.
   * BOARD-ONLY: must be executed via Safe multi-sig.
   */
  buildDeleteAllowanceTx(
    delegate: string,
    token: string,
  ): SafeTransactionDataPartial {
    return {
      to: this.moduleAddress,
      value: "0",
      data: encodeFunctionData({
        abi: ALLOWANCE_MODULE_ABI,
        functionName: "deleteAllowance",
        args: [delegate as `0x${string}`, token as `0x${string}`],
      }),
    };
  }

  /**
   * Build transaction to remove a delegate.
   * BOARD-ONLY: must be executed via Safe multi-sig.
   */
  buildRemoveDelegateTx(
    delegate: string,
    removeAllowances: boolean = true,
  ): SafeTransactionDataPartial {
    return {
      to: this.moduleAddress,
      value: "0",
      data: encodeFunctionData({
        abi: ALLOWANCE_MODULE_ABI,
        functionName: "removeDelegate",
        args: [delegate as `0x${string}`, removeAllowances],
      }),
    };
  }

  // ─── BOT-EXECUTABLE OPERATIONS ───

  /**
   * Build transaction for the bot to spend within its allowance.
   * This does NOT require board approval — the delegate can execute directly.
   */
  buildSpendTx(params: {
    safeAddress: string;
    token: string;
    to: string;
    amount: bigint;
    delegateAddress: string;
    signature: string;
  }): SafeTransactionDataPartial {
    return {
      to: this.moduleAddress,
      value: "0",
      data: encodeFunctionData({
        abi: ALLOWANCE_MODULE_ABI,
        functionName: "executeAllowanceTransfer",
        args: [
          params.safeAddress as `0x${string}`,
          params.token as `0x${string}`,
          params.to as `0x${string}`,
          params.amount,
          "0x0000000000000000000000000000000000000000" as `0x${string}`, // no gas payment token
          0n, // no gas payment
          params.delegateAddress as `0x${string}`,
          params.signature as `0x${string}`,
        ],
      }),
    };
  }

  // ─── READ-ONLY QUERIES ───

  /**
   * Query current allowance state for a delegate/token pair.
   */
  async getAllowanceState(
    safeAddress: string,
    delegate: string,
    token: string,
    publicClient: PublicClient,
  ): Promise<AllowanceState> {
    const result = await publicClient.readContract({
      address: this.moduleAddress as `0x${string}`,
      abi: ALLOWANCE_MODULE_ABI,
      functionName: "getTokenAllowance",
      args: [
        safeAddress as `0x${string}`,
        delegate as `0x${string}`,
        token as `0x${string}`,
      ],
    });

    const values = result as unknown as bigint[];
    return {
      amount: values[0],
      spent: values[1],
      resetTimeMin: Number(values[2]),
      lastResetMin: Number(values[3]),
      nonce: Number(values[4]),
    };
  }

  /**
   * Get the remaining spendable amount for a delegate/token pair.
   */
  async getRemainingAllowance(
    safeAddress: string,
    delegate: string,
    token: string,
    publicClient: PublicClient,
  ): Promise<bigint> {
    const state = await this.getAllowanceState(
      safeAddress,
      delegate,
      token,
      publicClient,
    );
    return state.amount - state.spent;
  }
}
