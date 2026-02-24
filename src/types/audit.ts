/**
 * Audit log entry for the append-only JSONL log with hash chain.
 */
export interface AuditEntry {
  /** UUID v4 */
  id: string;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Monotonic sequence number */
  sequence: number;
  /** SHA-256 hash of previous entry ("GENESIS" for first) */
  previousHash: string;
  /** Action category */
  category: AuditCategory;
  /** Specific action name */
  action: string;
  /** Who initiated the action */
  actor: "bot" | "board_member" | "operator" | "system";
  /** Ethereum address of the actor (if applicable) */
  actorAddress?: string;
  /** Action-specific details (no secrets) */
  details: Record<string, unknown>;
  /** On-chain transaction hash (if applicable) */
  transactionHash?: string;
  /** Chain ID where the transaction occurred */
  chainId?: number;
  /** Whether the action succeeded */
  success: boolean;
  /** Error message if action failed */
  error?: string;
  /** SHA-256 hash of this entry (computed over all fields except this one) */
  hash: string;
}

export type AuditCategory =
  | "treasury_init"
  | "token_deploy"
  | "vesting_deploy"
  | "module_enable"
  | "allowance_set"
  | "allowance_spend"
  | "allowance_reset"
  | "roles_configure"
  | "swap_quote"
  | "swap_execute"
  | "proposal_create"
  | "proposal_confirm"
  | "proposal_execute"
  | "emergency_pause"
  | "emergency_unpause"
  | "emergency_rotate"
  | "emergency_shutdown"
  | "key_generate"
  | "key_decrypt"
  | "config_change";
