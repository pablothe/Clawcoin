# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Clawcoin is a crypto treasury agent (OpenClaw plugin) that launches ERC-20 tokens, manages Safe smart account treasuries, and operates token-funded micro-businesses on Base L2. It is a standalone plugin — OpenClaw is installed as an npm dependency, not forked.

## Commands

```bash
npm run build          # TypeScript compilation (tsc)
npm run typecheck      # Type-check without emitting (tsc --noEmit)
npm run lint           # Lint with oxlint
npm run test           # Unit tests (vitest) — CONTAINER ONLY
npm run test:e2e       # E2E tests — CONTAINER ONLY
npm run test:watch     # Watch mode — CONTAINER ONLY
```

**Tests must run in Docker** — a test guard (`test/test-guard.ts`) blocks execution unless `IN_CLAWCOIN_TEST_CONTAINER=1` is set. Use:
```bash
docker compose -f testing/docker-compose.yml up --build              # All tests
docker compose -f testing/docker-compose.yml run test-runner npm test # Unit only
docker compose -f testing/docker-compose.yml run contract-tests      # Solidity only
```

**Solidity contracts** (in `contracts/` workspace) use Hardhat:
```bash
cd contracts && npx hardhat test      # Contract tests
cd contracts && npx hardhat compile   # Compile Solidity
```

## Architecture

The plugin entry point is `index.ts`, which implements `OpenClawPluginApi` — registering tools, commands, and services.

### Core Modules (`src/core/`)

The 11 core modules are the business logic layer:

- **safe-manager** — Safe smart account deployment & querying (owners, threshold, modules, balances)
- **allowance-manager** — AllowanceModule integration for daily USDC spending limits
- **roles-manager** — Zodiac Roles Modifier for permission scoping (restricts bot to specific functions/addresses)
- **dex-manager** — Uniswap V3 quoting and swap execution
- **sell-policy** — Deterministic token selling rules (daily/per-tx caps, liquidity floors, slippage limits, cooldowns)
- **board-manager** — Multi-sig proposal management with two paths: Safe Transaction Service (default) or offline signatures (fallback)
- **offline-signer** — File-based proposal signing at `.clawcoin/proposals/<safeTxHash>.json`
- **keystore** — Encrypted bot key storage (scrypt, file permissions 0o600)
- **audit-log** — Append-only JSONL with SHA-256 hash chain (genesis uses "GENESIS" as previous hash)
- **emergency** — State machine (normal → paused → normal | shutdown), board-only actions, local emergency flag via filesystem
- **chain-config** — Per-chain contract address resolution (Base 8453, Base Sepolia 84532, Ethereum 1)

### Permission Model

Two execution tiers enforced on-chain:

| Action | Bot (daily allowance) | Board (M-of-N) |
|---|:-:|:-:|
| Spend within allowance, swap, query status | Yes | — |
| Change limits, enable/disable modules, emergency | No | Yes |

7 OpenClaw tools are registered in `src/tools/index.ts`: `treasury_init`, `treasury_status`, `treasury_spend`, `treasury_swap`, `treasury_propose`, `treasury_approve`, `treasury_emergency`.

### Smart Contracts (`contracts/contracts/`)

- **ClawcoinToken.sol** — Fixed-supply ERC-20 (ERC20Permit, ERC20Burnable, OpenZeppelin v5). **No mint function** — supply is immutable. Deployment splits 80% to Safe treasury, 20% to TokenVesting.
- **TokenVesting.sol** — Time-locked operator allocation (default: 6-month cliff, 24-month linear vest).

### Hard Safety Invariants

1. Fixed token supply — no mint function exists
2. Bot cannot change its own limits — all policy changes require board M-of-N
3. Spending capped by on-chain AllowanceModule
4. Operator tokens time-locked via TokenVesting contract
5. Tests run in container only (test guard enforces this)

## Tech Stack

- **TypeScript 5.5+ / ES modules** with strict mode — Node.js 22+
- **Solidity 0.8.24** with Hardhat and OpenZeppelin v5
- **Vitest** for unit/E2E testing, **oxlint** for linting
- **viem** + **ethers.js** for Ethereum interaction
- **Safe Protocol Kit** / **Zodiac Roles SDK** / **Uniswap V3 SDK** for on-chain operations
- **TypeBox** for runtime schema validation
- npm workspaces (root + `contracts/`)

## Current Status

The codebase is **architecturally complete** but has **never been compiled or run**. See `docs/ROADMAP.md` for the exact build sequence. Key blockers:
- `contracts/package.json` does not exist yet (breaks workspace + Docker)
- `npm install` has never been run (no `package-lock.json`)
- `.env.example` does not exist
- `scripts/crypto-demo.sh` is echo stubs, not real code
- Target deployment: **Raspberry Pi** (isolated from dev machine)

## Key File Paths

- `.clawcoin/keystore.json` — Encrypted bot keys (never committed)
- `.clawcoin/audit.jsonl` — Append-only audit log (never committed)
- `.clawcoin/proposals/` — Offline proposal files
- `.clawcoin/emergency.json` — Local emergency flag
- `openclaw.plugin.json` — Plugin manifest with config schema
- `docs/CRYPTO_TREASURY.md` — Full technical documentation
- `docs/ROADMAP.md` — Build phases + Raspberry Pi deployment plan
- `skills/skill-crypto-treasury/SKILL.md` — AI agent skill definition
