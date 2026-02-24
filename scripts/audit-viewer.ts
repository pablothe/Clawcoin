#!/usr/bin/env node

/**
 * Audit log viewer — renders summaries of .clawcoin/audit.jsonl.
 *
 * Usage:
 *   npx tsx scripts/audit-viewer.ts [options]
 *
 * Options:
 *   --path <path>       Path to audit log (default: .clawcoin/audit.jsonl)
 *   --limit <n>         Show last N entries (default: 20)
 *   --category <cat>    Filter by category
 *   --verify            Verify hash chain integrity
 *   --json              Output as JSON instead of table
 */

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";

interface AuditEntry {
  id: string;
  timestamp: string;
  sequence: number;
  previousHash: string;
  category: string;
  action: string;
  actor: string;
  actorAddress?: string;
  details: Record<string, unknown>;
  transactionHash?: string;
  chainId?: number;
  success: boolean;
  error?: string;
  hash: string;
}

async function main() {
  const args = process.argv.slice(2);
  const logPath = getArg(args, "--path") ?? ".clawcoin/audit.jsonl";
  const limit = Number(getArg(args, "--limit") ?? "20");
  const category = getArg(args, "--category");
  const verify = args.includes("--verify");
  const json = args.includes("--json");

  if (!existsSync(logPath)) {
    console.log(`No audit log found at ${logPath}`);
    process.exit(0);
  }

  const content = await readFile(logPath, "utf-8");
  const lines = content.trim().split("\n").filter(Boolean);
  let entries: AuditEntry[] = lines.map((l) => JSON.parse(l));

  if (verify) {
    console.log("\n=== Audit Log Integrity Check ===\n");
    let expectedPrev = "GENESIS";
    let errors = 0;

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];

      if (entry.previousHash !== expectedPrev) {
        console.log(`  ERROR line ${i + 1}: previousHash mismatch (chain broken)`);
        errors++;
      }

      const { hash, ...rest } = entry;
      const computed = createHash("sha256").update(JSON.stringify(rest)).digest("hex");
      if (computed !== hash) {
        console.log(`  ERROR line ${i + 1}: hash mismatch (entry tampered)`);
        errors++;
      }

      expectedPrev = hash;
    }

    if (errors === 0) {
      console.log(`  OK: ${entries.length} entries, chain intact.`);
    } else {
      console.log(`\n  FAILED: ${errors} integrity violations found!`);
    }
    console.log();
  }

  // Filter
  if (category) {
    entries = entries.filter((e) => e.category === category);
  }

  // Limit (most recent first)
  entries = entries.slice(-limit).reverse();

  if (json) {
    console.log(JSON.stringify(entries, null, 2));
    return;
  }

  // Table output
  console.log("\n=== Clawcoin Audit Log ===\n");
  console.log(
    padRight("Seq", 6) +
      padRight("Timestamp", 26) +
      padRight("Category", 22) +
      padRight("Action", 24) +
      padRight("Actor", 16) +
      padRight("OK", 4) +
      "Details",
  );
  console.log("-".repeat(120));

  for (const e of entries) {
    const details = Object.entries(e.details)
      .slice(0, 3)
      .map(([k, v]) => `${k}=${String(v).slice(0, 20)}`)
      .join(", ");

    console.log(
      padRight(String(e.sequence), 6) +
        padRight(e.timestamp.slice(0, 24), 26) +
        padRight(e.category, 22) +
        padRight(e.action, 24) +
        padRight(e.actor, 16) +
        padRight(e.success ? "Y" : "N", 4) +
        details,
    );
  }

  console.log(`\nShowing ${entries.length} of ${lines.length} total entries.\n`);
}

function padRight(str: string, len: number): string {
  return str.padEnd(len);
}

function getArg(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

main().catch(console.error);
