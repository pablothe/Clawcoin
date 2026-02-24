/**
 * Append-only audit log with SHA-256 hash chain for tamper detection.
 *
 * Every crypto action emits a structured JSON line to .clawcoin/audit.jsonl.
 * Each entry's `previousHash` points to the hash of the prior entry, forming
 * a chain that makes insertions/deletions/modifications detectable.
 *
 * The `verify()` method walks the entire chain and checks all hashes.
 */

import { createHash, randomUUID } from "node:crypto";
import { appendFile, readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import type { AuditEntry, AuditCategory } from "../types/audit.js";

export class AuditLog {
  private sequence = 0;
  private lastHash = "GENESIS";
  private initialized = false;

  constructor(private logPath: string) {}

  /**
   * Initialize: read existing log to restore sequence counter and lastHash.
   * Must be called before append().
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    const dir = dirname(this.logPath);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true, mode: 0o700 });
    }

    if (!existsSync(this.logPath)) {
      this.initialized = true;
      return;
    }

    const content = await readFile(this.logPath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);

    if (lines.length > 0) {
      const lastEntry: AuditEntry = JSON.parse(lines[lines.length - 1]);
      this.sequence = lastEntry.sequence;
      this.lastHash = lastEntry.hash;
    }

    this.initialized = true;
  }

  /**
   * Append a new audit entry. Returns the entry with computed hash.
   */
  async append(
    entry: Omit<
      AuditEntry,
      "id" | "timestamp" | "sequence" | "previousHash" | "hash"
    >,
  ): Promise<AuditEntry> {
    if (!this.initialized) await this.init();

    this.sequence += 1;

    const fullEntry: Omit<AuditEntry, "hash"> = {
      ...entry,
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      sequence: this.sequence,
      previousHash: this.lastHash,
    };

    // Compute SHA-256 hash of the entry (excluding the hash field itself)
    const hash = createHash("sha256")
      .update(JSON.stringify(fullEntry))
      .digest("hex");

    const finalEntry: AuditEntry = { ...fullEntry, hash };

    await appendFile(
      this.logPath,
      JSON.stringify(finalEntry) + "\n",
      "utf-8",
    );

    this.lastHash = hash;
    return finalEntry;
  }

  /**
   * Verify integrity of the entire audit log chain.
   * Returns valid=true if all hashes are consistent, otherwise lists errors.
   */
  async verify(): Promise<{
    valid: boolean;
    entries: number;
    errors: string[];
  }> {
    if (!existsSync(this.logPath)) {
      return { valid: true, entries: 0, errors: [] };
    }

    const content = await readFile(this.logPath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    const errors: string[] = [];

    let expectedPreviousHash = "GENESIS";

    for (let i = 0; i < lines.length; i++) {
      let entry: AuditEntry;
      try {
        entry = JSON.parse(lines[i]);
      } catch {
        errors.push(`Line ${i + 1}: invalid JSON`);
        continue;
      }

      // Check sequence continuity
      if (entry.sequence !== i + 1) {
        errors.push(
          `Line ${i + 1}: expected sequence ${i + 1}, got ${entry.sequence}`,
        );
      }

      // Check previous hash chain
      if (entry.previousHash !== expectedPreviousHash) {
        errors.push(
          `Line ${i + 1}: previousHash mismatch — chain broken`,
        );
      }

      // Verify self-hash
      const { hash, ...rest } = entry;
      const computedHash = createHash("sha256")
        .update(JSON.stringify(rest))
        .digest("hex");

      if (computedHash !== hash) {
        errors.push(`Line ${i + 1}: hash mismatch — entry tampered`);
      }

      expectedPreviousHash = hash;
    }

    return {
      valid: errors.length === 0,
      entries: lines.length,
      errors,
    };
  }

  /**
   * Query recent entries with optional filtering.
   */
  async query(params: {
    limit?: number;
    category?: AuditCategory;
    since?: string;
    actor?: AuditEntry["actor"];
  }): Promise<AuditEntry[]> {
    if (!existsSync(this.logPath)) return [];

    const content = await readFile(this.logPath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);

    let entries: AuditEntry[] = lines.map((l) => JSON.parse(l));

    if (params.category) {
      entries = entries.filter((e) => e.category === params.category);
    }
    if (params.since) {
      entries = entries.filter((e) => e.timestamp >= params.since!);
    }
    if (params.actor) {
      entries = entries.filter((e) => e.actor === params.actor);
    }

    // Most recent first
    entries.reverse();

    if (params.limit) {
      entries = entries.slice(0, params.limit);
    }

    return entries;
  }

  /**
   * Get the total number of entries without loading them all.
   */
  async count(): Promise<number> {
    if (!existsSync(this.logPath)) return 0;
    const content = await readFile(this.logPath, "utf-8");
    return content.trim().split("\n").filter(Boolean).length;
  }
}
