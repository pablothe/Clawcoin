/**
 * Offline signature collection — fallback when Safe Transaction Service is unavailable.
 *
 * Stores proposals as JSON files in .clawcoin/proposals/<safeTxHash>.json.
 * Board members can export, sign externally, and import signatures.
 */

import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type {
  Proposal,
  ProposalConfirmation,
} from "../types/proposals.js";

export class OfflineSigner {
  constructor(private proposalsDir: string) {}

  /**
   * Save a proposal to disk.
   */
  async saveProposal(proposal: Proposal): Promise<string> {
    await this.ensureDir();
    const filePath = this.proposalPath(proposal.id);
    await writeFile(filePath, JSON.stringify(proposal, null, 2), "utf-8");
    return filePath;
  }

  /**
   * Load a proposal from disk.
   */
  async getProposal(safeTxHash: string): Promise<Proposal | null> {
    const filePath = this.proposalPath(safeTxHash);
    if (!existsSync(filePath)) return null;
    const content = await readFile(filePath, "utf-8");
    return JSON.parse(content) as Proposal;
  }

  /**
   * List all proposals on disk.
   */
  async listProposals(): Promise<Proposal[]> {
    await this.ensureDir();
    const files = await readdir(this.proposalsDir);
    const proposals: Proposal[] = [];

    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const content = await readFile(join(this.proposalsDir, file), "utf-8");
      proposals.push(JSON.parse(content) as Proposal);
    }

    return proposals.filter((p) => !p.isExecuted);
  }

  /**
   * Add a signature to an existing proposal.
   */
  async addSignature(
    safeTxHash: string,
    confirmation: ProposalConfirmation,
  ): Promise<Proposal> {
    const proposal = await this.getProposal(safeTxHash);
    if (!proposal) throw new Error(`Proposal ${safeTxHash} not found`);

    // Don't add duplicate signatures
    if (proposal.confirmations.some((c) => c.owner === confirmation.owner)) {
      throw new Error(`${confirmation.owner} already signed this proposal`);
    }

    proposal.confirmations.push(confirmation);
    proposal.isExecutable =
      proposal.confirmations.length >= proposal.confirmationsRequired;

    await this.saveProposal(proposal);
    return proposal;
  }

  /**
   * Export a proposal for external signing.
   * Returns a JSON string that can be shared with board members.
   */
  async exportForSigning(safeTxHash: string): Promise<string> {
    const proposal = await this.getProposal(safeTxHash);
    if (!proposal) throw new Error(`Proposal ${safeTxHash} not found`);

    return JSON.stringify(
      {
        type: "clawcoin_signing_request",
        version: "1.0",
        safeTxHash: proposal.id,
        safeAddress: proposal.safeAddress,
        to: proposal.to,
        value: proposal.value,
        data: proposal.data,
        operation: proposal.operation,
        description: proposal.description,
        confirmationsRequired: proposal.confirmationsRequired,
        existingConfirmations: proposal.confirmations.length,
        instructions:
          "Sign this transaction hash with your Safe owner key and " +
          "return the signature via treasury_approve tool or import file.",
      },
      null,
      2,
    );
  }

  /**
   * Mark a proposal as executed.
   */
  async markExecuted(
    safeTxHash: string,
    executionTxHash: string,
  ): Promise<void> {
    const proposal = await this.getProposal(safeTxHash);
    if (!proposal) return;

    proposal.isExecuted = true;
    proposal.executedAt = new Date().toISOString();
    proposal.executionTransactionHash = executionTxHash;

    await this.saveProposal(proposal);
  }

  private proposalPath(safeTxHash: string): string {
    return join(this.proposalsDir, `${safeTxHash}.json`);
  }

  private async ensureDir(): Promise<void> {
    if (!existsSync(this.proposalsDir)) {
      await mkdir(this.proposalsDir, { recursive: true });
    }
  }
}
