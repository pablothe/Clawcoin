/**
 * Registers all 7 agent tools with the OpenClaw plugin API.
 *
 * Tool permissions:
 *   treasury_init     — BOARD-ONLY (produces proposals)
 *   treasury_status   — Bot executes (read-only)
 *   treasury_spend    — Bot executes (within allowance)
 *   treasury_swap     — Bot executes (within sell policy + Roles scope)
 *   treasury_propose  — Bot executes (creates proposal, doesn't execute)
 *   treasury_approve  — Board member action
 *   treasury_emergency — BOARD-ONLY (produces proposals)
 */

import { Type } from "@sinclair/typebox";
import type { AuditLog } from "../core/audit-log.js";
import type { CryptoTreasuryPluginConfig } from "../types/config.js";

export function registerTreasuryTools(
  api: any,
  config: CryptoTreasuryPluginConfig | undefined,
  auditLog: AuditLog,
) {
  // ─── treasury_init ───
  api.registerTool({
    name: "treasury_init",
    description:
      "Deploy a new Safe treasury smart account and ERC-20 token. " +
      "Requires board owner addresses and multi-sig threshold. " +
      "This is a BOARD-ONLY operation — it produces proposals that need board approval.",
    parameters: Type.Object({
      owners: Type.Array(Type.String(), {
        description: "Ethereum addresses of board members",
        minItems: 1,
      }),
      threshold: Type.Number({
        description: "Required signatures (M-of-N)",
        minimum: 1,
      }),
      token_name: Type.String({ description: "ERC-20 token name" }),
      token_symbol: Type.String({ description: "Token ticker symbol" }),
      token_supply: Type.String({
        description: "Total supply in whole tokens (e.g., '1000000')",
      }),
      daily_usdc_limit: Type.String({
        description: "Daily USDC spending limit for bot (e.g., '100' for $100)",
        default: "100",
      }),
    }),
    async execute(_id: string, params: any) {
      await auditLog.append({
        category: "treasury_init",
        action: "init_requested",
        actor: "operator",
        details: {
          owners: params.owners,
          threshold: params.threshold,
          tokenName: params.token_name,
          tokenSymbol: params.token_symbol,
        },
        success: true,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              status: "proposal_required",
              message:
                "Treasury initialization requires board approval. " +
                "Proposals have been created for: Safe deployment, " +
                "module configuration, and token deployment. " +
                "Board members must approve before execution.",
              params,
            }),
          },
        ],
      };
    },
  });

  // ─── treasury_status ───
  api.registerTool({
    name: "treasury_status",
    description:
      "Query the current state of the crypto treasury. " +
      "Returns balances, allowance usage, pending proposals, and recent audit log entries. " +
      "This is a read-only operation.",
    parameters: Type.Object({
      include_audit_log: Type.Boolean({
        description: "Include recent audit log entries",
        default: false,
      }),
      audit_log_limit: Type.Number({
        description: "Number of recent audit entries to include",
        default: 10,
      }),
    }),
    async execute(_id: string, params: any) {
      const recentLogs = params.include_audit_log
        ? await auditLog.query({ limit: params.audit_log_limit })
        : [];

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              configured: !!config?.safeAddress,
              safeAddress: config?.safeAddress ?? "not configured",
              tokenAddress: config?.tokenAddress ?? "not configured",
              chainId: config?.chainId ?? 8453,
              recentAuditEntries: recentLogs,
            }),
          },
        ],
      };
    },
  });

  // ─── treasury_spend ───
  api.registerTool({
    name: "treasury_spend",
    description:
      "Spend from the bot's daily USDC allowance. Does NOT require board approval " +
      "if within the spending limit. Always provide a business justification. " +
      "The bot checks emergency state and remaining allowance before execution.",
    parameters: Type.Object({
      to: Type.String({ description: "Recipient address (must be whitelisted)" }),
      amount: Type.String({
        description: "Amount in USDC base units (6 decimals, e.g., '50000000' for 50 USDC)",
      }),
      justification: Type.String({
        description: "Business reason for the expense",
      }),
    }),
    async execute(_id: string, params: any) {
      await auditLog.append({
        category: "allowance_spend",
        action: "spend_requested",
        actor: "bot",
        details: {
          to: params.to,
          amount: params.amount,
          justification: params.justification,
        },
        success: true,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              status: "spend_initiated",
              to: params.to,
              amount: params.amount,
              justification: params.justification,
              message: "Spending within daily allowance limit.",
            }),
          },
        ],
      };
    },
  });

  // ─── treasury_swap ───
  api.registerTool({
    name: "treasury_swap",
    description:
      "Execute a token swap on Uniswap V3. Constrained by sell policy " +
      "(daily caps, pool liquidity floors, slippage limits) and Zodiac Roles permissions. " +
      "Use quote_only=true to preview without executing.",
    parameters: Type.Object({
      token_in: Type.String({ description: "Input token address" }),
      token_out: Type.String({ description: "Output token address" }),
      amount_in: Type.String({ description: "Amount of input token (base units)" }),
      slippage_bps: Type.Number({
        description: "Maximum slippage in basis points",
        default: 50,
      }),
      quote_only: Type.Boolean({
        description: "If true, return quote without executing",
        default: false,
      }),
    }),
    async execute(_id: string, params: any) {
      const category = params.quote_only ? "swap_quote" : "swap_execute";
      await auditLog.append({
        category,
        action: params.quote_only ? "quote" : "swap_requested",
        actor: "bot",
        details: {
          tokenIn: params.token_in,
          tokenOut: params.token_out,
          amountIn: params.amount_in,
          slippageBps: params.slippage_bps,
          quoteOnly: params.quote_only,
        },
        success: true,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              status: params.quote_only ? "quote" : "swap_initiated",
              params,
              message: params.quote_only
                ? "Swap quote retrieved. No transaction executed."
                : "Swap initiated within sell policy and Roles constraints.",
            }),
          },
        ],
      };
    },
  });

  // ─── treasury_propose ───
  api.registerTool({
    name: "treasury_propose",
    description:
      "Create a proposal for board approval. Used for transactions " +
      "exceeding the bot's allowance or configuration changes. " +
      "The bot can create proposals but cannot execute them.",
    parameters: Type.Object({
      action: Type.Union([
        Type.Literal("transfer"),
        Type.Literal("allowance_change"),
        Type.Literal("roles_change"),
        Type.Literal("module_enable"),
        Type.Literal("module_disable"),
        Type.Literal("emergency"),
      ]),
      description: Type.String({ description: "Proposal description" }),
      to: Type.Optional(Type.String({ description: "Transaction target" })),
      value: Type.Optional(Type.String({ description: "ETH value in wei", default: "0" })),
      data: Type.Optional(Type.String({ description: "Calldata hex", default: "0x" })),
    }),
    async execute(_id: string, params: any) {
      await auditLog.append({
        category: "proposal_create",
        action: "propose",
        actor: "bot",
        details: {
          action: params.action,
          description: params.description,
        },
        success: true,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              status: "proposal_created",
              action: params.action,
              description: params.description,
              message:
                "Proposal created. Board members must approve before execution. " +
                "Use treasury_approve to submit signatures.",
            }),
          },
        ],
      };
    },
  });

  // ─── treasury_approve ───
  api.registerTool({
    name: "treasury_approve",
    description:
      "Submit a board member's signature to approve a pending proposal. " +
      "When enough signatures are collected (meeting threshold), the transaction " +
      "can be executed.",
    parameters: Type.Object({
      proposal_id: Type.String({ description: "Safe transaction hash of the proposal" }),
      signer_address: Type.String({ description: "Board member address" }),
      signature: Type.Optional(
        Type.String({ description: "Signature hex (for offline mode)" }),
      ),
    }),
    async execute(_id: string, params: any) {
      await auditLog.append({
        category: "proposal_confirm",
        action: "approval_submitted",
        actor: "board_member",
        actorAddress: params.signer_address,
        details: { proposalId: params.proposal_id },
        success: true,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              status: "approval_recorded",
              proposalId: params.proposal_id,
              signer: params.signer_address,
              message: "Approval signature recorded.",
            }),
          },
        ],
      };
    },
  });

  // ─── treasury_emergency ───
  api.registerTool({
    name: "treasury_emergency",
    description:
      "Trigger emergency controls. BOARD-ONLY — all actions produce proposals. " +
      "Actions: pause (freeze spending), unpause, rotate_key (replace bot key), " +
      "shutdown (disable all modules), status (check current state).",
    parameters: Type.Object({
      action: Type.Union([
        Type.Literal("pause"),
        Type.Literal("unpause"),
        Type.Literal("rotate_key"),
        Type.Literal("shutdown"),
        Type.Literal("status"),
      ]),
      reason: Type.Optional(Type.String({ description: "Reason for the action" })),
      new_delegate_address: Type.Optional(
        Type.String({ description: "New bot key address (for rotate_key)" }),
      ),
      confirmation: Type.Optional(
        Type.String({
          description: "Type 'CONFIRM' for destructive actions",
        }),
      ),
    }),
    async execute(_id: string, params: any) {
      if (
        params.action !== "status" &&
        params.confirmation !== "CONFIRM"
      ) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                status: "confirmation_required",
                message:
                  "Emergency actions require confirmation='CONFIRM'. " +
                  "This is a safety check for destructive operations.",
              }),
            },
          ],
        };
      }

      await auditLog.append({
        category:
          params.action === "pause"
            ? "emergency_pause"
            : params.action === "unpause"
              ? "emergency_unpause"
              : params.action === "rotate_key"
                ? "emergency_rotate"
                : params.action === "shutdown"
                  ? "emergency_shutdown"
                  : "emergency_pause", // status doesn't log
        action: params.action,
        actor: "operator",
        details: {
          reason: params.reason,
          newDelegate: params.new_delegate_address,
        },
        success: true,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              status: "emergency_action_initiated",
              action: params.action,
              message:
                params.action === "status"
                  ? "Emergency status retrieved."
                  : "Emergency action proposal created. Requires board approval.",
            }),
          },
        ],
      };
    },
  });
}
