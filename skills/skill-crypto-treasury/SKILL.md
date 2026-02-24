---
name: skill-crypto-treasury
description: Manage a Safe-based crypto treasury for a token-funded bot micro-business. Deploy tokens, manage spending limits, execute swaps, propose board transactions, and monitor audit logs.
version: 0.1.0
metadata: {"openclaw":{"requires":{"env":["CLAWCOIN_KEYSTORE_PASSWORD"],"bins":["node"]},"primaryEnv":"CLAWCOIN_KEYSTORE_PASSWORD"}}
---

# Crypto Treasury Management

You have access to a crypto treasury subsystem that enables this bot to operate
a token-funded micro-business on Base (Ethereum L2).

## Architecture

The treasury uses a **Safe Smart Account** (multi-sig wallet) controlled by a
board of human owners. The bot has a **delegate key** with strictly limited
permissions:

- **Safe Smart Account**: Multi-signature wallet requiring M-of-N board
  approvals for large transactions and all policy changes.
- **AllowanceModule**: Gives the bot a daily spending limit in USDC. The bot
  can spend within this limit without board approval.
- **Zodiac Roles Modifier**: Scopes the bot's on-chain actions to specific
  contracts, functions, and parameters. Prevents unauthorized interactions.
- **TokenVesting**: Holds the operator's token allocation with a cliff and
  linear vesting schedule. Prevents immediate dumps.

## What You CAN Do (Bot-Executable)

- Spend USDC within your daily allowance (`treasury_spend`)
- Execute DEX swaps within sell policy and Roles scope (`treasury_swap`)
- Query balances, allowance, and status (`treasury_status`)
- Create proposals for board approval (`treasury_propose`)

## What You CANNOT Do (Board-Only)

You CANNOT change your own spending limits, permissions, or module
configuration. You can only PROPOSE changes for board approval:

- Change allowance amounts
- Modify Roles permissions or address whitelists
- Enable or disable Safe modules
- Rotate the bot execution key
- Trigger emergency pause or shutdown
- Deploy new contracts

## Available Tools

### Read-Only
- `treasury_status` — Query treasury state, balances, allowance, pending
  proposals, and audit log entries.

### Bot-Executable (within limits)
- `treasury_spend` — Spend from daily USDC allowance. Always provide a
  business justification. Checks emergency state and remaining allowance first.
- `treasury_swap` — Execute a Uniswap V3 token swap. Constrained by sell
  policy (daily caps, pool liquidity floors, slippage limits). Use
  `quote_only=true` to preview.

### Creates Proposals (needs board to execute)
- `treasury_init` — Set up Safe, token, modules. Produces proposals.
- `treasury_propose` — Create any board proposal (large transfers, config
  changes, module updates).
- `treasury_approve` — Submit a board member's approval signature.
- `treasury_emergency` — Emergency controls (pause, rotate, shutdown).

## Safety Rules

1. **ALWAYS** check emergency state before any spending action. If paused or
   shutdown, refuse all spending and inform the user.
2. **ALWAYS** check remaining allowance before `treasury_spend`. If amount
   exceeds remaining, use `treasury_propose` instead.
3. **ALWAYS** check sell policy before `treasury_swap`. Call with
   `quote_only=true` first to verify. If policy says no, inform the user.
4. **NEVER** reveal private keys, keystore passwords, or raw signatures.
5. **NEVER** attempt to call functions that modify your own permissions.
6. **ALWAYS** provide a business justification for every spend.
7. **ALWAYS** confirm with the user before executing any on-chain transaction.
8. If Safe Transaction Service is unavailable, inform the user that offline
   signing mode is active and provide instructions for board members.

## Common Workflows

### Paying an Operating Expense
1. Check status: `treasury_status`
2. If amount <= remaining allowance: `treasury_spend` with justification
3. If amount > remaining allowance: `treasury_propose` with action='transfer'
4. Log outcome

### Selling Tokens for Operating Funds
1. Get quote: `treasury_swap` with `quote_only=true`
2. Verify: sell policy allows it (daily cap, liquidity, slippage)
3. Confirm with user
4. Execute: `treasury_swap` with `quote_only=false`

### Emergency Situation
1. Inform the user immediately
2. Use `treasury_emergency` with action='pause' and reason
3. This sets a local flag AND creates a board proposal
4. Spending is blocked immediately (local flag)
5. Board must approve the on-chain allowance reset
