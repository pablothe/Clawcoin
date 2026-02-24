/**
 * A proposal for board approval — represents a Safe transaction
 * that needs M-of-N signatures before execution.
 */
export interface Proposal {
  /** Safe transaction hash — unique identifier */
  id: string;
  /** What kind of action this proposal represents */
  action: ProposalAction;
  /** Human-readable description of what this does */
  description: string;
  /** When the proposal was created */
  createdAt: string;
  /** Who created the proposal (address) */
  createdBy: string;
  /** Safe address this proposal targets */
  safeAddress: string;
  /** Transaction destination */
  to: string;
  /** ETH value in wei */
  value: string;
  /** Encoded calldata */
  data: string;
  /** Operation type (0 = CALL, 1 = DELEGATECALL) */
  operation: 0 | 1;
  /** Signatures collected so far */
  confirmations: ProposalConfirmation[];
  /** Number of signatures needed */
  confirmationsRequired: number;
  /** Whether the transaction has been executed on-chain */
  isExecuted: boolean;
  /** Whether enough signatures have been collected */
  isExecutable: boolean;
  /** On-chain execution timestamp (if executed) */
  executedAt?: string;
  /** On-chain transaction hash (if executed) */
  executionTransactionHash?: string;
}

export type ProposalAction =
  | "transfer"
  | "allowance_change"
  | "roles_change"
  | "module_enable"
  | "module_disable"
  | "key_rotation"
  | "emergency";

export interface ProposalConfirmation {
  owner: string;
  signature: string;
  submittedAt: string;
}

/**
 * Offline proposal stored as a JSON file when Safe Transaction Service is unavailable.
 */
export interface OfflineProposal extends Proposal {
  /** Path to the proposal JSON file */
  filePath: string;
  /** Whether this was created in offline mode */
  offlineMode: true;
}
