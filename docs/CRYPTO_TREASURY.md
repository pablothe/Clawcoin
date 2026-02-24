# Clawcoin Crypto Treasury — Technical Documentation

## Overview

Clawcoin extends OpenClaw (an always-on local AI agent platform) with an Ethereum/EVM crypto subsystem. Each bot can launch its own ERC-20 token, hold funds in a Safe smart account treasury, sell tokens for stablecoins on Uniswap V3, and pay its own operating expenses — all with layered safety controls.

**Clawcoin is a standalone project** that uses OpenClaw as a dependency (not a fork). Our code lives in this repository; OpenClaw is installed as an npm package.

---

## Architecture

```
┌────────────────────────────────────────────────────────────────┐
│                    OpenClaw Gateway (local)                     │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────┐│
│  │ Messaging     │  │ Agent        │  │ crypto-treasury       ││
│  │ Connectors    │  │ Runtime      │  │ Plugin (Clawcoin)     ││
│  │ (OpenClaw)    │  │ (OpenClaw)   │  │                       ││
│  └──────────────┘  └──────────────┘  └───────────┬───────────┘│
└──────────────────────────────────────────────────┼────────────┘
                                                   │
                          ┌────────────────────────┼────────────┐
                          │    On-Chain (Base L2)   │            │
                          │                        ▼            │
                          │  ┌─────────────────────────────┐    │
                          │  │     Safe Smart Account       │    │
                          │  │  (owners: board M-of-N)      │    │
                          │  │                              │    │
                          │  │  ├─ AllowanceModule          │    │
                          │  │  │  (bot daily USDC limit)   │    │
                          │  │  │                           │    │
                          │  │  └─ Zodiac Roles Modifier    │    │
                          │  │     (target/fn/param scoping)│    │
                          │  └─────────────────────────────┘    │
                          │                                      │
                          │  ┌─────────────┐  ┌──────────────┐  │
                          │  │ ClawcoinToken│  │ Uniswap V3   │  │
                          │  │ (ERC-20)     │  │ (DEX swaps)  │  │
                          │  └─────────────┘  └──────────────┘  │
                          │                                      │
                          │  ┌──────────────┐                    │
                          │  │ TokenVesting  │                    │
                          │  │ (operator     │                    │
                          │  │  time-lock)   │                    │
                          │  └──────────────┘                    │
                          └──────────────────────────────────────┘
```

---

## Hard Invariants

These are non-negotiable constraints enforced in code and tested:

1. **Fixed supply, no mint**: `ClawcoinToken` has no `mint()` function. Total supply is set at construction and can never increase.
2. **Operator allocation is time-locked**: The 20% deployer allocation is held in a `TokenVesting` contract with a configurable cliff + linear vesting schedule.
3. **Bot cannot change its own bounds**: Allowance amounts, Roles permissions, module enable/disable, allowlist changes, key rotation, and emergency toggles are board-only operations.
4. **All testing in VM/container only**: A test guard refuses execution unless `IN_CLAWCOIN_TEST_CONTAINER=1` is set.
5. **Compromised bot key blast radius is capped**: Proven by 8 adversarial E2E tests.

---

## Permission Boundary

| Action | Bot Can Do Alone? | Requires Board M-of-N? |
|--------|:-:|:-:|
| Spend USDC within daily allowance | Yes | No |
| Execute DEX swap within Roles scope | Yes | No |
| Query balances / status | Yes | No |
| Propose any transaction | Yes | No |
| Change allowance amounts | No | Yes |
| Change Roles permissions / allowlists | No | Yes |
| Enable/disable Safe modules | No | Yes |
| Rotate bot execution key | No | Yes |
| Emergency pause/shutdown | No | Yes |
| Deploy new contracts | No | Yes |

---

## Components

### Smart Contracts

#### ClawcoinToken (`contracts/contracts/ClawcoinToken.sol`)

- ERC-20 with ERC20Permit + ERC20Burnable (OpenZeppelin v5)
- **No `mint()` function** — fixed supply is a hard invariant
- Constructor: `(name, symbol, totalSupply, treasuryAddress, vestingAddress)`
- Mints 80% to treasury Safe, 20% to TokenVesting contract
- Emits `TokenDeployed(address treasury, address vesting, uint256 totalSupply)`

#### TokenVesting (`contracts/contracts/TokenVesting.sol`)

- Holds operator's 20% allocation with cliff + linear vesting
- Default: 6-month cliff, 24-month linear vest
- Only beneficiary can release vested tokens
- `releasableAmount(token)` / `vestedAmount(token)` for status queries
- Prevents immediate dump of operator allocation

### Core Modules

#### Keystore (`src/core/keystore.ts`)

- Generate random keypair via `ethers.Wallet.createRandom()`
- Encrypt with scrypt (N=262144) using password from `CLAWCOIN_KEYSTORE_PASSWORD` env var
- File permissions: 0o600 (keystore), 0o700 (directory)
- Rotation produces proposals for board approval (not direct execution)
- Metadata file (`.meta.json`) stores address + creation time (no secrets)

#### Audit Log (`src/core/audit-log.ts`)

- Append-only JSONL at `.clawcoin/audit.jsonl`
- SHA-256 hash chain: each entry's `previousHash` = hash of prior entry
- Genesis entry uses `"GENESIS"` as previous hash
- `verify()` walks chain and checks all hashes
- `query()` with filtering by category, time range, limit

#### Chain Config (`src/core/chain-config.ts`)

- Sources contract addresses from authoritative packages at startup
- **Safe modules**: `@safe-global/safe-modules-deployments` npm package
- **Uniswap V3**: Official deployment addresses with fallback hardcoded values
- Supports Base (8453), Base Sepolia (84532), Ethereum mainnet (1)
- Caches resolved addresses per chain

#### Address Registry (`src/utils/address-registry.ts`)

- `resolveAllowanceModule(chainId)` — from Safe modules deployments
- `resolveUniswapContracts(chainId)` — SwapRouter02, QuoterV2, Factory
- `validateAddress(address, label)` — checksum validation

### Safe Integration (`src/core/safe-manager.ts`)

- `deploySafe()` — Creates Safe with board owners + threshold via Protocol Kit
- `connectToSafe(address)` — Attach to existing deployed Safe
- `createEnableModuleTx(module)` — Produces proposal (board-only)
- `getState()` — Query owners, threshold, modules, nonce, balances
- All state-changing operations produce proposals; bot never executes directly

### Allowance Manager (`src/core/allowance-manager.ts`)

Bot can execute:
- `buildSpendTx()` — Execute within existing allowance
- `getAllowanceState()` / `getRemainingAllowance()` — Query current state

Board-only:
- `buildAddDelegateTx()` / `buildRemoveDelegateTx()`
- `buildSetAllowanceTx()` / `buildResetAllowanceTx()` / `buildDeleteAllowanceTx()`

### Roles Manager (`src/core/roles-manager.ts`)

Defines BOT_OPERATOR role scope:
- **Allowed**: USDC transfers to whitelisted recipients, Uniswap swaps with recipient = Safe
- **Blocked**: Admin functions on AllowanceModule, Roles Modifier, Safe owner management, delegatecall

All configuration changes are board-only.

### Sell Policy (`src/core/sell-policy.ts`)

Deterministic rules for token selling:

| Rule | Parameter | Example |
|------|-----------|---------|
| Daily cap | `maxSellPerDayUsdc` | 500 USDC |
| Per-tx cap | `maxSellPerTxUsdc` | 100 USDC |
| Pool minimum | `minPoolLiquidityUsdc` | 10,000 USDC reserves |
| Slippage max | `maxSlippageBps` | 100 (1%) |
| Cooldown | `cooldownMinutes` | 60 min |
| Daily tx count | `maxDailyTxCount` | 5 |

All values are USDC-denominated (6 decimals, on-chain measurable). The bot checks `canSell()` before every swap. If no pool exists or liquidity is below minimum, the bot refuses to sell.

**Changing the sell policy is a board-only operation.**

### DEX Manager (`src/core/dex-manager.ts`)

- Uses SwapRouter02 `exactInputSingle` only (narrowest callable surface)
- Swap recipient is always hardcoded to the Safe address
- `getQuote()` — Price + gas estimate via QuoterV2
- `checkPoolLiquidityUsdc()` — Query pool reserves for sell policy
- All addresses sourced from `address-registry.ts`

### Board Manager (`src/core/board-manager.ts`)

Two execution paths:

**Path A — Safe Transaction Service** (default):
- Off-chain signature collection via API Kit
- `createProposal()` → `confirmProposal()` → `executeProposal()`

**Path B — Offline signature collection** (fallback):
- File-based proposals at `.clawcoin/proposals/<safeTxHash>.json`
- `exportForSigning()` — Board members sign offline
- `importSignature()` — Collect signatures from files
- Direct `execTransaction` when threshold met

Auto-selects Path A; falls back to Path B if service unavailable.

### Emergency Controls (`src/core/emergency.ts`)

State machine: `normal` → `paused` → `normal` OR `normal` → `shutdown`

All emergency actions are board-only:
- `proposePause()` — Resets on-chain allowance to 0
- `proposeUnpause()` — Restores allowance
- `proposeRotateKey()` — Swaps delegate addresses
- `proposeShutdown()` — Disables all modules (terminal)

Local emergency flag (`.clawcoin/emergency.json`) can be set by operator directly (filesystem access = physical access = trusted).

---

## Agent Tools

7 tools registered with OpenClaw:

| Tool | Description | Bot Executes? | Board Required? |
|------|-------------|:-:|:-:|
| `treasury_init` | Initialize treasury (deploy contracts, enable modules) | No | Yes |
| `treasury_status` | Query balances, allowances, module state | Yes | No |
| `treasury_spend` | Spend USDC within allowance | Yes | No |
| `treasury_swap` | Sell tokens for USDC on Uniswap V3 | Yes | No |
| `treasury_propose` | Create board proposal | Yes | No |
| `treasury_approve` | Board member signs proposal | N/A | Board member |
| `treasury_emergency` | Propose emergency action | No | Yes |

---

## Threat Model

| Threat | Control | Blast Radius |
|--------|---------|-------------|
| Bot key compromised | AllowanceModule daily limit + Zodiac Roles | Max 1 day's allowance to whitelisted addresses only |
| Bot tries to escalate | Roles exclude admin functions | On-chain revert; no escalation possible |
| Bot dumps operator tokens | TokenVesting cliff + linear vest | Tokens locked; cannot dump |
| Insider board member | M-of-N threshold | Need M compromised keys |
| No DEX liquidity | Sell policy checks USDC reserves | Bot refuses to sell; no loss |
| Transaction Service down | Offline signature fallback | Operations continue |
| Audit log tampered | SHA-256 hash chain | Tampering detected |
| Bot changes own limits | Not a Safe owner; cannot call admin functions | On-chain revert |

### Compromise Scenario Test Results

8 adversarial E2E tests prove bounded blast radius:

1. **Bot cannot transfer full treasury** — `execTransaction` reverts (invalid owner signature)
2. **Bot cannot exceed daily allowance** — Sell policy rejects over-limit transactions
3. **Bot cannot change its own allowance** — Safe rejects non-owner signatures for `setAllowance`
4. **Bot cannot modify Roles permissions** — Safe rejects non-owner signatures for `assignRoles`
5. **Bot cannot add whitelisted addresses** — Safe rejects non-owner signatures for `scopeTarget`
6. **Bot cannot enable/disable modules** — Safe rejects non-owner signatures for `enableModule`/`disableModule`
7. **Bot cannot transfer to arbitrary addresses** — Safe rejects non-owner signatures for ETH transfers
8. **Swap recipient is always treasury** — DexManager hardcodes recipient; Roles Modifier enforces on-chain

---

## Testing

### Test Environment Safety

All tests run inside a Docker container. A guard (`test/test-guard.ts`) checks for `IN_CLAWCOIN_TEST_CONTAINER=1` and exits immediately if missing.

```bash
# Run all tests
docker compose -f testing/docker-compose.yml run test-runner npm test

# Run contract tests only
docker compose -f testing/docker-compose.yml run contract-tests

# Run E2E tests
docker compose -f testing/docker-compose.yml run test-runner npx vitest run --config vitest.e2e.config.ts

# Run specific test
docker compose -f testing/docker-compose.yml run test-runner npx vitest run test/e2e/compromise-scenarios.e2e.test.ts
```

### Test Suites

| Suite | Config | Description |
|-------|--------|-------------|
| Unit tests | `vitest.config.ts` | Core module tests (`test/**/*.test.ts`, excludes e2e) |
| Contract tests | Hardhat | Solidity tests (`contracts/test/*.test.ts`) |
| E2E lifecycle | `vitest.e2e.config.ts` | Full treasury lifecycle on Hardhat node |
| Adversarial | `vitest.e2e.config.ts` | 8 compromise scenario tests |

### Docker Setup

```bash
# Build the test container
docker compose -f testing/docker-compose.yml build

# Start Hardhat node (Base fork)
docker compose -f testing/docker-compose.yml up hardhat-node -d

# Run tests against the node
docker compose -f testing/docker-compose.yml run test-runner npm test
```

---

## Emergency Procedures

### Immediate Pause

If you suspect the bot key is compromised:

1. **Set local emergency flag** (fastest — blocks all spending immediately):
   ```bash
   echo '{"state":"paused","reason":"Suspected key compromise"}' > .clawcoin/emergency.json
   ```

2. **Create on-chain proposal to reset allowance**:
   Use `treasury_emergency` tool with action `pause`, or create proposal manually:
   ```
   Board calls AllowanceModule.setAllowance(delegate, token, 0, 0, 0) via Safe multi-sig
   ```

3. **Rotate the bot key**:
   Board creates proposal to:
   - Remove old delegate from AllowanceModule
   - Add new delegate
   - Update Roles Modifier member assignment

### Recovery from Pause

1. Generate new bot keypair
2. Board approves new delegate via multi-sig
3. Board restores allowance amounts
4. Remove emergency flag: `echo '{"state":"normal"}' > .clawcoin/emergency.json`

### Shutdown (Terminal)

Disables all modules on the Safe. Requires board to re-initialize from scratch:
1. Board creates `proposeShutdown()` proposal
2. M-of-N board members approve
3. All AllowanceModule and Roles Modifier are disabled
4. Bot has zero on-chain capabilities

---

## Offline Signing Guide

When the Safe Transaction Service is unavailable (network issues, new chain without service, etc.):

1. **Bot creates proposal locally**:
   - Transaction data saved to `.clawcoin/proposals/<safeTxHash>.json`

2. **Export for board signing**:
   ```bash
   # Export unsigned transaction
   npx ts-node scripts/audit-viewer.ts --path .clawcoin/proposals/
   ```

3. **Board members sign offline**:
   Each board member signs the `safeTxHash` using their preferred tool:
   - Safe CLI
   - ethers.js script
   - Hardware wallet (via WalletConnect)
   - MetaMask (manual)

4. **Import signatures**:
   ```bash
   # Import each board member's signature file
   # Signatures are appended to the proposal JSON
   ```

5. **Execute when threshold met**:
   - BoardManager calls `execTransaction` directly on the Safe contract
   - No dependency on Transaction Service

---

## Configuration

### Plugin Config (`openclaw.plugin.json`)

```json
{
  "id": "crypto-treasury",
  "configSchema": {
    "properties": {
      "chainId": { "type": "number", "default": 8453 },
      "rpcUrl": { "type": "string" },
      "safeAddress": { "type": "string" },
      "keystorePath": { "type": "string" },
      "auditLogPath": { "type": "string", "default": ".clawcoin/audit.jsonl" }
    }
  }
}
```

### Sell Policy Config

```json
{
  "maxSellPerDayUsdc": "500000000",
  "maxSellPerTxUsdc": "100000000",
  "minPoolLiquidityUsdc": "10000000000",
  "maxSlippageBps": 100,
  "cooldownMinutes": 60,
  "maxDailyTxCount": 5
}
```

All USDC values are in base units (6 decimals). `"500000000"` = 500 USDC.

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `CLAWCOIN_KEYSTORE_PASSWORD` | Yes | Password for bot keystore encryption |
| `BASE_RPC_URL` | No | RPC endpoint (default: `https://mainnet.base.org`) |
| `BASE_SEPOLIA_RPC_URL` | No | Testnet RPC endpoint |
| `IN_CLAWCOIN_TEST_CONTAINER` | Tests only | Must be `1` to run tests |

---

## Audit Log

### Format

Append-only JSONL at `.clawcoin/audit.jsonl`:

```json
{
  "id": "uuid-v4",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "sequence": 1,
  "previousHash": "GENESIS",
  "category": "spending",
  "action": "transfer",
  "actor": "0x...",
  "details": { "to": "0x...", "amount": "5000000", "token": "USDC" },
  "txHash": "0x...",
  "chainId": 8453,
  "success": true,
  "hash": "sha256-of-entry"
}
```

### Verification

```bash
# Verify audit log integrity
docker compose -f testing/docker-compose.yml run test-runner \
  npx ts-node scripts/audit-viewer.ts --verify --path .clawcoin/audit.jsonl
```

### Categories

| Category | Actions |
|----------|---------|
| `treasury` | `safe_deployed`, `safe_funded`, `token_deployed`, `module_enabled` |
| `spending` | `transfer`, `allowance_spend` |
| `swap` | `quote`, `swap_executed` |
| `proposal` | `proposal_created`, `proposal_confirmed`, `proposal_executed` |
| `emergency` | `pause_activated`, `pause_lifted`, `key_rotated`, `shutdown` |
| `system` | `startup`, `integrity_check`, `config_changed` |

---

## Project Structure

```
Clawcoin/
├── src/
│   ├── core/               # Core business logic
│   │   ├── safe-manager.ts
│   │   ├── allowance-manager.ts
│   │   ├── roles-manager.ts
│   │   ├── dex-manager.ts
│   │   ├── sell-policy.ts
│   │   ├── board-manager.ts
│   │   ├── offline-signer.ts
│   │   ├── keystore.ts
│   │   ├── audit-log.ts
│   │   ├── emergency.ts
│   │   └── chain-config.ts
│   ├── tools/              # OpenClaw agent tools
│   ├── commands/           # CLI commands
│   ├── types/              # TypeScript interfaces
│   └── utils/              # Address registry, formatters
├── contracts/              # Solidity contracts + Hardhat
│   ├── contracts/
│   │   ├── ClawcoinToken.sol
│   │   └── TokenVesting.sol
│   ├── test/
│   └── scripts/
├── test/
│   ├── test-guard.ts       # Container enforcement
│   └── e2e/
│       ├── full-lifecycle.e2e.test.ts
│       └── compromise-scenarios.e2e.test.ts
├── skills/
│   └── skill-crypto-treasury/SKILL.md
├── scripts/
│   ├── crypto-demo.sh
│   ├── audit-viewer.ts
│   └── dev-link-plugin.sh
├── testing/
│   ├── Dockerfile
│   ├── docker-compose.yml
│   └── README.md
├── index.ts                # OpenClaw plugin entry
├── openclaw.plugin.json    # Plugin manifest
└── docs/
    └── CRYPTO_TREASURY.md  # This file
```

---

## Relationship to OpenClaw

Clawcoin is **not a fork** of OpenClaw. It is an independent project that:

- Installs OpenClaw as an npm dependency
- Implements the OpenClaw plugin interface (`register(api: OpenClawPluginApi)`)
- Registers tools, commands, and services with OpenClaw's runtime
- Can be symlinked into OpenClaw's extension discovery path via `scripts/dev-link-plugin.sh`

This separation means:
- OpenClaw updates don't create merge conflicts in Clawcoin code
- Clawcoin's crypto-specific code is isolated and auditable
- The plugin can be developed, tested, and deployed independently
