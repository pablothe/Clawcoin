/**
 * Board approval flow — multi-sig proposal management.
 *
 * Two execution paths:
 *   Path A: Safe Transaction Service (default) — nice UX, off-chain signatures
 *   Path B: Offline signature collection — no service dependency
 *
 * Selection logic: try Path A first; fall back to Path B if service unavailable.
 */

import SafeApiKit from "@safe-global/api-kit";
import type {
  Proposal,
  ProposalAction,
  ProposalConfirmation,
} from "../types/proposals.js";
import type { SafeManager } from "./safe-manager.js";
import type { AuditLog } from "./audit-log.js";
import { OfflineSigner } from "./offline-signer.js";

export class BoardManager {
  private apiKit: SafeApiKit;
  private offlineSigner: OfflineSigner;
  private useOffline = false;

  constructor(
    private chainId: number,
    private safeManager: SafeManager,
    private auditLog: AuditLog,
    proposalsDir: string = ".clawcoin/proposals",
  ) {
    this.apiKit = new SafeApiKit({
      chainId: BigInt(chainId),
    });
    this.offlineSigner = new OfflineSigner(proposalsDir);
  }

  /**
   * Create a new proposal for board approval.
   * Tries Path A (Transaction Service) first, falls back to Path B (offline).
   */
  async createProposal(params: {
    safeAddress: string;
    to: string;
    value: string;
    data: string;
    action: ProposalAction;
    description: string;
    senderAddress: string;
  }): Promise<Proposal> {
    // Create and sign the Safe transaction
    const safeTransaction = await this.safeManager.createTransaction([
      {
        to: params.to,
        value: params.value,
        data: params.data,
      },
    ]);

    const signedTx =
      await this.safeManager.signTransaction(safeTransaction);
    const safeTxHash =
      await this.safeManager.getTransactionHash(signedTx);

    const proposal: Proposal = {
      id: safeTxHash,
      action: params.action,
      description: params.description,
      createdAt: new Date().toISOString(),
      createdBy: params.senderAddress,
      safeAddress: params.safeAddress,
      to: params.to,
      value: params.value,
      data: params.data,
      operation: 0,
      confirmations: [
        {
          owner: params.senderAddress,
          signature: signedTx.encodedSignatures(),
          submittedAt: new Date().toISOString(),
        },
      ],
      confirmationsRequired: (await this.safeManager.getState()).threshold,
      isExecuted: false,
      isExecutable: false,
    };

    // Try Path A: Transaction Service
    if (!this.useOffline) {
      try {
        await this.apiKit.proposeTransaction({
          safeAddress: params.safeAddress,
          safeTransactionData: signedTx.data,
          safeTxHash,
          senderAddress: params.senderAddress,
          senderSignature: signedTx.encodedSignatures(),
        });

        await this.auditLog.append({
          category: "proposal_create",
          action: "create_proposal_online",
          actor: "bot",
          actorAddress: params.senderAddress,
          details: {
            safeTxHash,
            action: params.action,
            description: params.description,
            to: params.to,
            value: params.value,
          },
          chainId: this.chainId,
          success: true,
        });

        return proposal;
      } catch (error) {
        // Transaction Service unavailable — fall back to offline
        this.useOffline = true;
      }
    }

    // Path B: Offline
    await this.offlineSigner.saveProposal(proposal);

    await this.auditLog.append({
      category: "proposal_create",
      action: "create_proposal_offline",
      actor: "bot",
      actorAddress: params.senderAddress,
      details: {
        safeTxHash,
        action: params.action,
        description: params.description,
        to: params.to,
        value: params.value,
        offlineMode: true,
      },
      chainId: this.chainId,
      success: true,
    });

    return proposal;
  }

  /**
   * List pending proposals.
   */
  async listPendingProposals(
    safeAddress: string,
  ): Promise<Proposal[]> {
    if (!this.useOffline) {
      try {
        const response =
          await this.apiKit.getPendingTransactions(safeAddress);

        return response.results.map(
          (tx) => ({
            id: tx.safeTxHash,
            action: "transfer" as ProposalAction,
            description: "",
            createdAt: tx.submissionDate,
            createdBy: tx.proposer || "",
            safeAddress,
            to: tx.to,
            value: tx.value,
            data: tx.data || "0x",
            operation: (tx.operation as 0 | 1) || 0,
            confirmations: (tx.confirmations || []).map(
              (c: any): ProposalConfirmation => ({
                owner: c.owner,
                signature: c.signature,
                submittedAt: c.submissionDate,
              }),
            ),
            confirmationsRequired: tx.confirmationsRequired || 0,
            isExecuted: tx.isExecuted,
            isExecutable:
              (tx.confirmations?.length || 0) >=
              (tx.confirmationsRequired || 0),
          }),
        );
      } catch {
        this.useOffline = true;
      }
    }

    // Offline mode
    return this.offlineSigner.listProposals();
  }

  /**
   * Add a board member's signature to a pending proposal.
   */
  async confirmProposal(
    safeTxHash: string,
    signerAddress: string,
    signature?: string,
  ): Promise<void> {
    if (!this.useOffline && !signature) {
      try {
        const sig = await this.safeManager.signTransaction(
          await this.apiKit.getTransaction(safeTxHash),
        );
        await this.apiKit.confirmTransaction(safeTxHash, sig.encodedSignatures());

        await this.auditLog.append({
          category: "proposal_confirm",
          action: "confirm_online",
          actor: "board_member",
          actorAddress: signerAddress,
          details: { safeTxHash },
          chainId: this.chainId,
          success: true,
        });
        return;
      } catch {
        this.useOffline = true;
      }
    }

    // Offline: import signature
    if (signature) {
      await this.offlineSigner.addSignature(safeTxHash, {
        owner: signerAddress,
        signature,
        submittedAt: new Date().toISOString(),
      });
    }

    await this.auditLog.append({
      category: "proposal_confirm",
      action: "confirm_offline",
      actor: "board_member",
      actorAddress: signerAddress,
      details: { safeTxHash, offlineMode: true },
      chainId: this.chainId,
      success: true,
    });
  }

  /**
   * Execute a fully-confirmed proposal on-chain.
   */
  async executeProposal(safeTxHash: string): Promise<string> {
    let tx: any;

    if (!this.useOffline) {
      try {
        tx = await this.apiKit.getTransaction(safeTxHash);
      } catch {
        this.useOffline = true;
      }
    }

    if (this.useOffline) {
      const proposal = await this.offlineSigner.getProposal(safeTxHash);
      if (!proposal) throw new Error(`Proposal ${safeTxHash} not found`);
      tx = proposal;
    }

    // Reconstruct and execute
    const safeTransaction = await this.safeManager.createTransaction([
      {
        to: tx.to,
        value: tx.value,
        data: tx.data || "0x",
      },
    ]);

    // Add all signatures
    const confirmations = tx.confirmations || [];
    for (const c of confirmations) {
      safeTransaction.addSignature({
        signer: c.owner,
        data: c.signature,
        isContractSignature: false,
      } as any);
    }

    const result = await this.safeManager.executeTransaction(safeTransaction);
    const txHash = result.hash;

    await this.auditLog.append({
      category: "proposal_execute",
      action: "execute_proposal",
      actor: "system",
      details: { safeTxHash, executionTxHash: txHash },
      transactionHash: txHash,
      chainId: this.chainId,
      success: true,
    });

    return txHash;
  }
}
