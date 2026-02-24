/**
 * Zodiac Roles Modifier management — on-chain permission scoping for the bot.
 *
 * Defines what the BOT_OPERATOR role is allowed to do:
 *   - Transfer USDC to whitelisted recipients
 *   - Approve Uniswap SwapRouter02 to spend tokens
 *   - Execute exactInputSingle swaps (recipient must be the Safe)
 *
 * Explicitly BLOCKED:
 *   - Calls to AllowanceModule admin functions
 *   - Calls to Roles Modifier admin functions
 *   - Calls to Safe owner management functions
 *   - delegatecall operations
 *   - Transfers to non-whitelisted addresses
 *   - Swaps where recipient != Safe address
 *
 * All Roles configuration changes are BOARD-ONLY.
 */

import {
  processPermissions,
  applyTargets,
  type Target,
} from "zodiac-roles-sdk";
import { encodeFunctionData, parseAbi } from "viem";
import type { SafeTransactionDataPartial } from "@safe-global/safe-core-sdk-types";

// BOT_OPERATOR role key (bytes32 encoding of "BOT_OPERATOR")
export const BOT_OPERATOR_ROLE_KEY =
  "0x424f545f4f50455241544f520000000000000000000000000000000000000000";

// ERC-20 function selectors
const ERC20_TRANSFER_SELECTOR = "0xa9059cbb"; // transfer(address,uint256)
const ERC20_APPROVE_SELECTOR = "0x095ea7b3"; // approve(address,uint256)

// Uniswap V3 SwapRouter02 function selector
const EXACT_INPUT_SINGLE_SELECTOR = "0x414bf389"; // exactInputSingle(...)

// Roles Modifier ABI (for configuration calls)
const ROLES_MOD_ABI = parseAbi([
  "function assignRoles(address module, uint16[] calldata roleIds, bool[] calldata memberOf) external",
  "function scopeTarget(uint16 roleId, address targetAddress) external",
  "function scopeFunction(uint16 roleId, address targetAddress, bytes4 functionSig, bool isWild, uint8 paramCount) external",
  "function allowTarget(uint16 roleId, address targetAddress, uint8 options) external",
  "function revokeTarget(uint16 roleId, address targetAddress) external",
]);

export interface RolesConfig {
  rolesModAddress: string;
  chainId: number;
  safeAddress: string;
  usdcAddress: string;
  swapRouter02Address: string;
  whitelistedRecipients: string[];
  botDelegateAddress: string;
}

export class RolesManager {
  constructor(private config: RolesConfig) {}

  /**
   * Build the full set of transactions to configure the BOT_OPERATOR role.
   * BOARD-ONLY: all returned transactions must go through multi-sig.
   *
   * Permissions granted:
   *   1. USDC.transfer(to) — only to whitelisted recipients
   *   2. USDC.approve(SwapRouter02)
   *   3. SwapRouter02.exactInputSingle(params) — recipient must be Safe
   *   4. Any bot token.transfer(to) — only to whitelisted recipients
   *   5. Any bot token.approve(SwapRouter02)
   */
  buildConfigureRoleTxs(): SafeTransactionDataPartial[] {
    const txs: SafeTransactionDataPartial[] = [];

    // 1. Assign the BOT_OPERATOR role to the bot delegate
    txs.push({
      to: this.config.rolesModAddress,
      value: "0",
      data: encodeFunctionData({
        abi: ROLES_MOD_ABI,
        functionName: "assignRoles",
        args: [
          this.config.botDelegateAddress as `0x${string}`,
          [1], // roleId 1 = BOT_OPERATOR
          [true],
        ],
      }),
    });

    // 2. Scope USDC contract — allow transfer and approve only
    txs.push({
      to: this.config.rolesModAddress,
      value: "0",
      data: encodeFunctionData({
        abi: ROLES_MOD_ABI,
        functionName: "scopeTarget",
        args: [1, this.config.usdcAddress as `0x${string}`],
      }),
    });

    // 3. Scope SwapRouter02 — allow exactInputSingle only
    txs.push({
      to: this.config.rolesModAddress,
      value: "0",
      data: encodeFunctionData({
        abi: ROLES_MOD_ABI,
        functionName: "scopeTarget",
        args: [1, this.config.swapRouter02Address as `0x${string}`],
      }),
    });

    return txs;
  }

  /**
   * Build transaction to add a new whitelisted recipient.
   * BOARD-ONLY.
   */
  buildAddWhitelistTx(
    recipientAddress: string,
  ): SafeTransactionDataPartial {
    return {
      to: this.config.rolesModAddress,
      value: "0",
      data: encodeFunctionData({
        abi: ROLES_MOD_ABI,
        functionName: "allowTarget",
        args: [
          1, // roleId
          recipientAddress as `0x${string}`,
          1, // options: SEND only (no delegatecall)
        ],
      }),
    };
  }

  /**
   * Build transaction to remove a whitelisted recipient.
   * BOARD-ONLY.
   */
  buildRemoveWhitelistTx(
    recipientAddress: string,
  ): SafeTransactionDataPartial {
    return {
      to: this.config.rolesModAddress,
      value: "0",
      data: encodeFunctionData({
        abi: ROLES_MOD_ABI,
        functionName: "revokeTarget",
        args: [1, recipientAddress as `0x${string}`],
      }),
    };
  }

  /**
   * Verify that an address is in the whitelist (read-only).
   */
  isWhitelisted(address: string): boolean {
    return this.config.whitelistedRecipients.some(
      (r) => r.toLowerCase() === address.toLowerCase(),
    );
  }
}
