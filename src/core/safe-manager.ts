/**
 * Safe Smart Account management — deployment, module enablement, state queries.
 *
 * All state-changing operations produce proposals for board multi-sig.
 * The bot never executes state changes directly — it can only propose.
 */

import Safe, {
  type PredictedSafeProps,
  type SafeAccountConfig,
} from "@safe-global/protocol-kit";
import SafeApiKit from "@safe-global/api-kit";
import type { SafeTransactionDataPartial } from "@safe-global/safe-core-sdk-types";
import type { TreasuryState } from "../types/treasury.js";
import type { AuditLog } from "./audit-log.js";

export interface SafeManagerConfig {
  owners: string[];
  threshold: number;
  chainId: number;
  rpcUrl: string;
  signerPrivateKey: string;
}

export class SafeManager {
  private protocolKit: InstanceType<typeof Safe> | null = null;
  private apiKit: SafeApiKit | null = null;
  private config: SafeManagerConfig;
  private auditLog: AuditLog;

  constructor(config: SafeManagerConfig, auditLog: AuditLog) {
    this.config = config;
    this.auditLog = auditLog;
  }

  /**
   * Deploy a new Safe smart account with configured owners and threshold.
   */
  async deploySafe(): Promise<string> {
    const safeAccountConfig: SafeAccountConfig = {
      owners: this.config.owners,
      threshold: this.config.threshold,
    };

    const predictedSafe: PredictedSafeProps = { safeAccountConfig };

    this.protocolKit = await Safe.init({
      provider: this.config.rpcUrl,
      signer: this.config.signerPrivateKey,
      predictedSafe,
    });

    const safeAddress = await this.protocolKit.getAddress();

    // Create and execute deployment transaction
    const deployTx = await this.protocolKit.createSafeDeploymentTransaction();
    const signer = await this.protocolKit.getSafeProvider().getExternalSigner();

    if (!signer) throw new Error("No external signer available");

    const txHash = await signer.sendTransaction({
      to: deployTx.to as `0x${string}`,
      value: BigInt(deployTx.value),
      data: deployTx.data as `0x${string}`,
    });

    // Reconnect to deployed Safe
    this.protocolKit = await this.protocolKit.connect({ safeAddress });

    const isDeployed = await this.protocolKit.isSafeDeployed();
    if (!isDeployed) throw new Error("Safe deployment verification failed");

    await this.auditLog.append({
      category: "treasury_init",
      action: "deploy_safe",
      actor: "operator",
      details: {
        safeAddress,
        owners: this.config.owners,
        threshold: this.config.threshold,
        chainId: this.config.chainId,
      },
      transactionHash: typeof txHash === "string" ? txHash : undefined,
      chainId: this.config.chainId,
      success: true,
    });

    return safeAddress;
  }

  /**
   * Connect to an existing deployed Safe.
   */
  async connectToSafe(safeAddress: string): Promise<void> {
    this.protocolKit = await Safe.init({
      provider: this.config.rpcUrl,
      signer: this.config.signerPrivateKey,
      safeAddress,
    });

    const isDeployed = await this.protocolKit.isSafeDeployed();
    if (!isDeployed) {
      throw new Error(`Safe at ${safeAddress} is not deployed`);
    }
  }

  /**
   * Create a transaction to enable a module on the Safe.
   * This is a BOARD-ONLY operation — returns the transaction data
   * for proposal to the board, not for direct execution by the bot.
   */
  async createEnableModuleTx(
    moduleAddress: string,
  ): Promise<SafeTransactionDataPartial> {
    this.ensureInitialized();
    const tx = await this.protocolKit!.createEnableModuleTx(moduleAddress);
    return tx.data;
  }

  /**
   * Create a transaction to disable a module on the Safe.
   * BOARD-ONLY operation.
   */
  async createDisableModuleTx(
    moduleAddress: string,
  ): Promise<SafeTransactionDataPartial> {
    this.ensureInitialized();
    const tx = await this.protocolKit!.createDisableModuleTx(moduleAddress);
    return tx.data;
  }

  /**
   * Query the current state of the Safe.
   */
  async getState(): Promise<TreasuryState> {
    this.ensureInitialized();

    const safeAddress = await this.protocolKit!.getAddress();

    return {
      safeAddress,
      isDeployed: await this.protocolKit!.isSafeDeployed(),
      owners: await this.protocolKit!.getOwners(),
      threshold: await this.protocolKit!.getThreshold(),
      modules: await this.protocolKit!.getModules(),
      nonce: await this.protocolKit!.getNonce(),
      balances: [], // populated separately via RPC
    };
  }

  /**
   * Build a generic Safe transaction (for batching via MultiSend).
   */
  async createTransaction(
    transactions: SafeTransactionDataPartial[],
  ) {
    this.ensureInitialized();
    return this.protocolKit!.createTransaction({ transactions });
  }

  /**
   * Sign a Safe transaction with the bot's key.
   */
  async signTransaction(safeTransaction: any) {
    this.ensureInitialized();
    return this.protocolKit!.signTransaction(safeTransaction);
  }

  /**
   * Get the transaction hash for a Safe transaction.
   */
  async getTransactionHash(safeTransaction: any): Promise<string> {
    this.ensureInitialized();
    return this.protocolKit!.getTransactionHash(safeTransaction);
  }

  /**
   * Execute a fully-signed Safe transaction on-chain.
   */
  async executeTransaction(safeTransaction: any) {
    this.ensureInitialized();
    return this.protocolKit!.executeTransaction(safeTransaction);
  }

  /**
   * Get the Safe address.
   */
  async getAddress(): Promise<string> {
    this.ensureInitialized();
    return this.protocolKit!.getAddress();
  }

  /**
   * Get the API Kit for off-chain operations.
   */
  getApiKit(): SafeApiKit {
    if (!this.apiKit) {
      this.apiKit = new SafeApiKit({
        chainId: BigInt(this.config.chainId),
      });
    }
    return this.apiKit;
  }

  /**
   * Check if the Safe Transaction Service is available for this chain.
   */
  async isTransactionServiceAvailable(): Promise<boolean> {
    try {
      const apiKit = this.getApiKit();
      // Attempt a lightweight call
      await apiKit.getServiceInfo();
      return true;
    } catch {
      return false;
    }
  }

  private ensureInitialized(): asserts this is { protocolKit: NonNullable<typeof this.protocolKit> } {
    if (!this.protocolKit) {
      throw new Error(
        "SafeManager not initialized. Call deploySafe() or connectToSafe() first.",
      );
    }
  }
}
