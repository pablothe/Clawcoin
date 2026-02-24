/**
 * Clawcoin — OpenClaw plugin entry point.
 *
 * This file is loaded by OpenClaw's plugin system when the crypto-treasury
 * plugin is enabled. It registers all tools, commands, services, and hooks.
 *
 * To use: install this package and add to openclaw.json plugins config,
 * or symlink into .openclaw/extensions/crypto-treasury/.
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { registerTreasuryTools } from "./src/tools/index.js";
import { registerCryptoCommands } from "./src/commands/crypto-commands.js";
import { AuditLog } from "./src/core/audit-log.js";
import type { CryptoTreasuryPluginConfig } from "./src/types/config.js";

export default function register(api: OpenClawPluginApi) {
  const config = api.pluginConfig as CryptoTreasuryPluginConfig;
  const logger = api.logger;

  logger.info("[clawcoin] Crypto treasury plugin loading...");

  // Initialize audit log
  const auditLog = new AuditLog(config?.auditLogPath ?? ".clawcoin/audit.jsonl");

  // Register all 7 agent tools
  registerTreasuryTools(api, config, auditLog);

  // Register CLI + chat commands
  registerCryptoCommands(api, config);

  // Register background services
  api.registerService({
    id: "clawcoin-audit-integrity",
    start: async () => {
      await auditLog.init();
      logger.info("[clawcoin] Audit log integrity service started");

      // Periodic integrity check every 5 minutes
      const interval = setInterval(async () => {
        try {
          const result = await auditLog.verify();
          if (!result.valid) {
            logger.error(
              "[clawcoin] AUDIT LOG INTEGRITY VIOLATION:",
              result.errors,
            );
          }
        } catch (err) {
          logger.error("[clawcoin] Audit verify error:", err);
        }
      }, 5 * 60 * 1000);

      return () => clearInterval(interval);
    },
    stop: async () => {
      logger.info("[clawcoin] Audit log integrity service stopped");
    },
  });

  logger.info("[clawcoin] Crypto treasury plugin registered successfully");
}
