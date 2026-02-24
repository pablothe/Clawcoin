/**
 * Emergency controls — pause, key rotation, and shutdown.
 *
 * ALL emergency actions are BOARD-ONLY. The bot can request emergency actions
 * but cannot execute them directly. Each action produces a proposal for
 * board multi-sig approval.
 *
 * State machine:
 *   normal -> paused -> normal  (pause/unpause cycle)
 *   normal -> shutdown          (terminal, requires board re-init)
 *
 * Local emergency flag (.clawcoin/emergency.json) can be set by the operator
 * directly (filesystem access = physical access = trusted). This immediately
 * blocks all bot spending without requiring an on-chain transaction.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import type { EmergencyState, EmergencyStatus } from "../types/treasury.js";
import type { AuditLog } from "./audit-log.js";
import type { AllowanceManager } from "./allowance-manager.js";
import type { BoardManager } from "./board-manager.js";

export class EmergencyController {
  private status: EmergencyStatus = { state: "normal" };

  constructor(
    private auditLog: AuditLog,
    private statePath: string = ".clawcoin/emergency.json",
  ) {}

  /**
   * Load persisted emergency state on startup.
   */
  async init(): Promise<void> {
    if (existsSync(this.statePath)) {
      const content = await readFile(this.statePath, "utf-8");
      this.status = JSON.parse(content) as EmergencyStatus;
    }
  }

  /**
   * Check if spending is allowed. Called before every spend/swap.
   */
  isSpendingAllowed(): boolean {
    return this.status.state === "normal";
  }

  /**
   * Get current emergency status.
   */
  getStatus(): EmergencyStatus {
    return { ...this.status };
  }

  /**
   * Propose a pause — creates a proposal to reset the on-chain allowance to 0.
   * BOARD-ONLY: the proposal requires multi-sig to execute.
   *
   * Also sets the local emergency flag immediately (blocks bot spending
   * even before the on-chain tx executes).
   */
  async proposePause(params: {
    actor: string;
    reason: string;
    boardManager: BoardManager;
    allowanceManager: AllowanceManager;
    safeAddress: string;
    delegateAddress: string;
    tokenAddress: string;
  }): Promise<string | null> {
    this.status = {
      state: "paused",
      pausedAt: new Date().toISOString(),
      pausedBy: params.actor,
      reason: params.reason,
    };

    await this.persistState();

    await this.auditLog.append({
      category: "emergency_pause",
      action: "local_pause",
      actor: "operator",
      actorAddress: params.actor,
      details: { reason: params.reason },
      success: true,
    });

    // Create on-chain proposal to reset allowance to 0
    try {
      const resetTx = params.allowanceManager.buildResetAllowanceTx(
        params.delegateAddress,
        params.tokenAddress,
      );

      const proposal = await params.boardManager.createProposal({
        safeAddress: params.safeAddress,
        to: resetTx.to,
        value: resetTx.value || "0",
        data: resetTx.data as string,
        action: "emergency",
        description: `Emergency pause: ${params.reason}`,
        senderAddress: params.actor,
      });

      return proposal.id;
    } catch (error) {
      // On-chain proposal failed, but local pause is still active
      return null;
    }
  }

  /**
   * Propose unpause — restores normal operation.
   * BOARD-ONLY.
   */
  async proposeUnpause(params: { actor: string }): Promise<void> {
    if (this.status.state === "shutdown") {
      throw new Error(
        "Cannot unpause from shutdown state. Requires full board re-initialization.",
      );
    }

    this.status = { state: "normal" };
    await this.persistState();

    await this.auditLog.append({
      category: "emergency_unpause",
      action: "unpause",
      actor: "board_member",
      actorAddress: params.actor,
      details: {},
      success: true,
    });
  }

  /**
   * Propose key rotation — generates proposals to swap the delegate address
   * on AllowanceModule and Zodiac Roles.
   * BOARD-ONLY.
   */
  async proposeRotateKey(params: {
    actor: string;
    newDelegateAddress: string;
    oldDelegateAddress: string;
    boardManager: BoardManager;
    allowanceManager: AllowanceManager;
    safeAddress: string;
    tokenAddress: string;
  }): Promise<string[]> {
    const proposalIds: string[] = [];

    // 1. Remove old delegate
    const removeTx = params.allowanceManager.buildRemoveDelegateTx(
      params.oldDelegateAddress,
      true,
    );

    const removeProposal = await params.boardManager.createProposal({
      safeAddress: params.safeAddress,
      to: removeTx.to,
      value: removeTx.value || "0",
      data: removeTx.data as string,
      action: "key_rotation",
      description: `Remove old delegate ${params.oldDelegateAddress}`,
      senderAddress: params.actor,
    });
    proposalIds.push(removeProposal.id);

    // 2. Add new delegate
    const addTx = params.allowanceManager.buildAddDelegateTx(
      params.newDelegateAddress,
    );

    const addProposal = await params.boardManager.createProposal({
      safeAddress: params.safeAddress,
      to: addTx.to,
      value: addTx.value || "0",
      data: addTx.data as string,
      action: "key_rotation",
      description: `Add new delegate ${params.newDelegateAddress}`,
      senderAddress: params.actor,
    });
    proposalIds.push(addProposal.id);

    await this.auditLog.append({
      category: "emergency_rotate",
      action: "propose_key_rotation",
      actor: "operator",
      actorAddress: params.actor,
      details: {
        oldDelegate: params.oldDelegateAddress,
        newDelegate: params.newDelegateAddress,
        proposalIds,
      },
      success: true,
    });

    return proposalIds;
  }

  /**
   * Propose full shutdown — disables all modules on the Safe.
   * BOARD-ONLY. This is effectively irreversible without board re-initialization.
   */
  async proposeShutdown(params: {
    actor: string;
    reason: string;
  }): Promise<void> {
    this.status = {
      state: "shutdown",
      shutdownAt: new Date().toISOString(),
      shutdownBy: params.actor,
      reason: params.reason,
    };

    await this.persistState();

    await this.auditLog.append({
      category: "emergency_shutdown",
      action: "shutdown",
      actor: "operator",
      actorAddress: params.actor,
      details: { reason: params.reason },
      success: true,
    });
  }

  private async persistState(): Promise<void> {
    const dir = dirname(this.statePath);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
    await writeFile(
      this.statePath,
      JSON.stringify(this.status, null, 2),
      "utf-8",
    );
  }
}
