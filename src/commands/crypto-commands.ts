/**
 * CLI and chat commands for Clawcoin treasury management.
 *
 * These register as OpenClaw commands accessible via /crypto:init, etc.
 */

import type { CryptoTreasuryPluginConfig } from "../types/config.js";

export function registerCryptoCommands(
  api: any,
  config: CryptoTreasuryPluginConfig | undefined,
) {
  // /crypto:init — Interactive setup wizard
  api.registerCommand({
    name: "crypto:init",
    description: "Initialize a new Clawcoin crypto treasury",
    requireAuth: true,
    handler: async () => ({
      text:
        "**Clawcoin Treasury Initialization**\n\n" +
        "This will set up:\n" +
        "1. Bot execution keypair (encrypted keystore)\n" +
        "2. Safe smart account with board owners\n" +
        "3. AllowanceModule (daily USDC spending limit)\n" +
        "4. Zodiac Roles Modifier (permission scoping)\n" +
        "5. ClawcoinToken (ERC-20, fixed supply)\n" +
        "6. TokenVesting (operator allocation time-lock)\n\n" +
        "Use the `treasury_init` tool with your board member addresses to begin.\n\n" +
        "**All setup steps produce proposals requiring board approval.**",
    }),
  });

  // /crypto:status — Quick overview
  api.registerCommand({
    name: "crypto:status",
    description: "Quick Clawcoin treasury status",
    handler: async () => {
      if (!config?.safeAddress) {
        return {
          text: "Treasury not configured. Run `/crypto:init` to set up.",
        };
      }
      return {
        text:
          `**Treasury Status**\n` +
          `- Chain: ${config.chainId}\n` +
          `- Safe: \`${config.safeAddress}\`\n` +
          `- Token: \`${config.tokenAddress || "not deployed"}\`\n\n` +
          `Use \`treasury_status\` tool for detailed information.`,
      };
    },
  });

  // /crypto:configure — View/propose config changes
  api.registerCommand({
    name: "crypto:configure",
    description: "View or propose treasury configuration changes",
    requireAuth: true,
    handler: async () => ({
      text:
        "**Treasury Configuration**\n\n" +
        "Configurable settings (all changes are BOARD-ONLY):\n" +
        "- `allowance`: Daily USDC spending limit\n" +
        "- `whitelist`: Allowed recipient addresses\n" +
        "- `sell-policy`: Sell caps, liquidity floors, slippage limits\n" +
        "- `roles`: Zodiac permission scoping\n\n" +
        "Use `treasury_propose` with action='allowance_change' or 'roles_change'.\n" +
        "The bot can propose but only the board can approve changes.",
    }),
  });

  // /crypto:demo — Testnet demo
  api.registerCommand({
    name: "crypto:demo",
    description: "Run a Clawcoin demo on testnet (container only)",
    requireAuth: true,
    handler: async () => ({
      text:
        "**Clawcoin Testnet Demo (Base Sepolia)**\n\n" +
        "This demo runs through the full treasury lifecycle:\n" +
        "1. Deploy Safe (1-of-1 for demo)\n" +
        "2. Deploy ClawcoinToken + TokenVesting\n" +
        "3. Configure AllowanceModule (10 USDC daily)\n" +
        "4. Configure Zodiac Roles\n" +
        "5. Spend within allowance\n" +
        "6. Attempt over-limit spend (should fail)\n" +
        "7. Create + approve board proposal\n" +
        "8. Emergency pause\n" +
        "9. Verify audit log\n\n" +
        "**Must run inside test container!** See `testing/README.md`.",
    }),
  });

  // Register CLI commands
  api.registerCli(({ program }: any) => {
    program
      .command("crypto:init")
      .description("Initialize Clawcoin treasury")
      .option("--chain <chainId>", "Chain ID", "8453")
      .option("--testnet", "Use Base Sepolia testnet")
      .action(async (opts: any) => {
        const chainId = opts.testnet ? 84532 : Number(opts.chain);
        console.log(`Initializing Clawcoin treasury on chain ${chainId}...`);
        console.log("Use the treasury_init agent tool for full setup.");
      });

    program
      .command("crypto:status")
      .description("Show treasury status")
      .action(async () => {
        if (!config?.safeAddress) {
          console.log("Treasury not configured. Run crypto:init first.");
          return;
        }
        console.log(`Safe: ${config.safeAddress}`);
        console.log(`Token: ${config.tokenAddress || "not deployed"}`);
        console.log(`Chain: ${config.chainId}`);
      });
  });
}
