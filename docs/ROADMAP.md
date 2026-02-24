# Clawcoin Roadmap — Build & Deployment Phases

This document captures exactly what needs to happen to take Clawcoin from scaffolded code to a running system on an isolated Raspberry Pi. Each phase is self-contained and should be completed in order. Check off items as you go.

---

## Phase 1: Make It Buildable

The codebase is architecturally complete — all modules, contracts, types, tools, tests, and docs exist with correct import paths. But it has **never been compiled or run**. These items fix that.

### 1.1 Create `contracts/package.json`

The root `package.json` declares `"workspaces": ["contracts"]` but no `contracts/package.json` exists. This breaks `npm install`, the Docker build, and contract compilation.

Create `contracts/package.json` with:
- `name`: `@clawcoin/contracts`
- `private`: true
- Dependencies: `hardhat`, `@nomicfoundation/hardhat-toolbox`, `@openzeppelin/contracts` v5, `ethers` v6
- Scripts: `compile` (`hardhat compile`), `test` (`hardhat test`), `clean` (`hardhat clean`)

Files that reference this and will break without it:
- `testing/Dockerfile` line 14: `COPY contracts/package.json contracts/`
- `testing/Dockerfile` line 20: `RUN cd contracts && npm install`
- `testing/docker-compose.yml` contract-tests service

### 1.2 Run `npm install`

```bash
npm install
```

This generates `package-lock.json` (which should be committed — it pins dependency versions). Verify it resolves all workspaces cleanly. If `openclaw` doesn't exist on npm yet (it's `"latest"` in devDependencies), you may need to remove it or change it to a git URL / local path.

**Known risk**: `openclaw` is listed as `"latest"` in devDependencies. If this package doesn't exist on the npm registry, installation will fail. Resolution options:
- Remove it from devDependencies (the plugin API types can be stubbed locally)
- Point it to the actual git repo: `"openclaw": "github:openclaw/openclaw"`
- Create a minimal `types/openclaw.d.ts` declare module stub

### 1.3 Create `.env.example`

Create at repo root with all environment variables the project references:

```bash
# Required — password for encrypting/decrypting the bot's execution keypair
CLAWCOIN_KEYSTORE_PASSWORD=

# RPC endpoints (defaults exist in code, but you'll want your own for reliability)
BASE_RPC_URL=https://mainnet.base.org
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org

# Contract deployment (only needed when running deploy-token.ts)
TREASURY_SAFE_ADDRESS=
VESTING_BENEFICIARY=

# Token config (optional — defaults exist in deploy-token.ts)
TOKEN_NAME=Clawcoin
TOKEN_SYMBOL=CLAW
TOKEN_SUPPLY=1000000
CLIFF_MONTHS=6
VESTING_MONTHS=24

# Test container marker (set automatically by Docker — never set manually)
# IN_CLAWCOIN_TEST_CONTAINER=1
```

Files that read these:
- `src/core/keystore.ts` — `CLAWCOIN_KEYSTORE_PASSWORD`
- `contracts/hardhat.config.ts` — `BASE_RPC_URL`, `BASE_SEPOLIA_RPC_URL`, `DEPLOYER_PRIVATE_KEY`
- `contracts/scripts/deploy-token.ts` — `TREASURY_SAFE_ADDRESS`, `VESTING_BENEFICIARY`, `TOKEN_*`, `CLIFF_MONTHS`, `VESTING_MONTHS`
- `testing/docker-compose.yml` — `BASE_RPC_URL`
- `test/test-guard.ts` — `IN_CLAWCOIN_TEST_CONTAINER`

### 1.4 TypeScript compilation check

```bash
npx tsc --noEmit
```

Fix any type errors. Likely issues:
- `openclaw/plugin-sdk` types not found (see 1.2 above)
- Possible strict-mode issues in newly written modules
- Imports between `.js` extension paths and `.ts` source files (should be fine with `"moduleResolution": "nodenext"`)

### 1.5 Compile Solidity contracts

```bash
cd contracts && npx hardhat compile
```

This generates `contracts/artifacts/` and `contracts/typechain-types/`. Both are gitignored. The E2E tests import from `contracts/artifacts/` at runtime.

### 1.6 Make `scripts/crypto-demo.sh` functional

Currently this file is **all echo statements** — it describes what should happen but doesn't execute anything. Two options:

**Option A (recommended)**: Rewrite it to call the real TypeScript modules. It would:
1. Call `deploy-token.ts` via Hardhat
2. Use `safe-manager.ts` to deploy a Safe
3. Use `allowance-manager.ts` to configure spending limits
4. Execute a test spend, over-limit spend, proposal, and emergency pause
5. Verify the audit log

**Option B**: Keep it as a dry-run/documentation script and rename to `crypto-demo-dryrun.sh`. Create a separate `crypto-demo-live.sh` later.

### 1.7 Verify Docker build

```bash
docker compose -f testing/docker-compose.yml build
```

This must succeed before any tests can run. Common failure points:
- Missing `contracts/package.json` (fix in 1.1)
- Missing `package-lock.json` (fix in 1.2)
- npm registry issues inside Docker (network/proxy settings)

---

## Phase 2: Raspberry Pi Deployment

The Pi serves as our isolated test/run environment. No tests or blockchain interactions happen on the development machine.

### 2.1 Hardware requirements

- **Raspberry Pi 4 or 5** (4GB+ RAM recommended — Hardhat node uses ~1-2GB)
- **32GB+ microSD or USB SSD** (node_modules + Docker images take significant space)
- Ethernet or WiFi connected
- SSH access configured

### 2.2 Base OS setup

Flash **Raspberry Pi OS Lite (64-bit)** or **Ubuntu Server 24.04 ARM64**. Then:

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker (official method)
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# Log out and back in for group change

# Install Docker Compose plugin
sudo apt install docker-compose-plugin -y

# Verify
docker --version
docker compose version
```

### 2.3 Install Node.js 22 (for local development on Pi, optional)

Only needed if you want to run commands outside Docker on the Pi:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node --version  # Should be 22.x
```

### 2.4 Clone the repo

```bash
git clone https://github.com/pablothe/Clawcoin.git
cd Clawcoin
cp .env.example .env
# Edit .env with your actual values
```

### 2.5 Create `scripts/pi-setup.sh`

A one-command setup script for the Pi:

```bash
#!/bin/bash
set -euo pipefail

echo "=== Clawcoin Raspberry Pi Setup ==="

# Check architecture
ARCH=$(uname -m)
if [[ "$ARCH" != "aarch64" && "$ARCH" != "arm64" ]]; then
  echo "WARNING: Expected ARM64, got $ARCH. Docker images may not work."
fi

# Check Docker
if ! command -v docker &> /dev/null; then
  echo "Docker not found. Installing..."
  curl -fsSL https://get.docker.com | sh
  sudo usermod -aG docker $USER
  echo "Docker installed. Log out and back in, then re-run this script."
  exit 0
fi

# Check Docker Compose
if ! docker compose version &> /dev/null; then
  echo "Docker Compose plugin not found. Install it:"
  echo "  sudo apt install docker-compose-plugin"
  exit 1
fi

# Build containers
echo "Building test containers (this takes a while on Pi)..."
docker compose -f testing/docker-compose.yml build

echo ""
echo "=== Setup complete ==="
echo "Run tests:  docker compose -f testing/docker-compose.yml run test-runner npm test"
echo "Run demo:   docker compose -f testing/docker-compose.yml run test-runner bash scripts/crypto-demo.sh"
```

### 2.6 Adapt Docker for ARM64

The `testing/Dockerfile` uses `node:22-bookworm-slim` which has official ARM64 images, so it should work. Verify:
- Hardhat runs on ARM64 (it does — pure JS)
- Safe Protocol Kit runs on ARM64 (it does — no native bindings)
- `@nomicfoundation/hardhat-toolbox` compiles solidity via solc-js (works on ARM64)

**Potential issue**: Some npm packages with native bindings (like `keccak` or `secp256k1`) may need build tools:

```bash
# Add to Dockerfile if native compilation fails:
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
```

### 2.7 Test Docker stack on Pi

```bash
# Build (first time takes 10-15 min on Pi 4)
docker compose -f testing/docker-compose.yml build

# Start Hardhat node in background
docker compose -f testing/docker-compose.yml up hardhat-node -d

# Run tests
docker compose -f testing/docker-compose.yml run test-runner npm test
docker compose -f testing/docker-compose.yml run contract-tests
```

### 2.8 Document Pi-specific performance notes

The Hardhat node with Base fork is memory-intensive. On a 4GB Pi:
- The fork may need `--fork-block-number` to limit state fetched
- Consider using Hardhat's local network (no fork) for most tests
- Only use fork mode for E2E tests that need real Base contract state

Add to `testing/docker-compose.yml`:
```yaml
hardhat-node:
  ...
  deploy:
    resources:
      limits:
        memory: 2G
```

---

## Phase 3: Verify Everything End-to-End

All commands below run **on the Pi inside Docker**. Never on your dev machine.

### 3.1 Compile Solidity contracts

```bash
docker compose -f testing/docker-compose.yml run test-runner \
  bash -c "cd contracts && npx hardhat compile"
```

**Expected**: Compiles `ClawcoinToken.sol` and `TokenVesting.sol` without errors. Artifacts appear in `contracts/artifacts/`.

### 3.2 Run contract tests

```bash
docker compose -f testing/docker-compose.yml run contract-tests
```

**Expected**: All tests pass:
- ClawcoinToken: 80/20 allocation, immutable addresses, TokenDeployed event, zero-address reverts, no-mint invariant, ERC20Permit, burn
- TokenVesting: parameter validation, cliff enforcement, linear vesting, release tracking

### 3.3 Run unit tests

```bash
docker compose -f testing/docker-compose.yml run test-runner npm test
```

**Expected**: All `test/**/*.test.ts` files pass (excluding `test/e2e/`).

### 3.4 Run E2E lifecycle test

```bash
# Start Hardhat node first
docker compose -f testing/docker-compose.yml up hardhat-node -d

# Run E2E
docker compose -f testing/docker-compose.yml run test-runner \
  npx vitest run --config vitest.e2e.config.ts test/e2e/full-lifecycle.e2e.test.ts
```

**Expected**: 9-step lifecycle completes — Safe deployed, token deployed with 80/20 split, module enabled, spending succeeds, over-limit rejected by sell policy, board proposal executed, emergency pause blocks spending, audit log intact.

### 3.5 Run adversarial compromise scenario tests

```bash
docker compose -f testing/docker-compose.yml run test-runner \
  npx vitest run --config vitest.e2e.config.ts test/e2e/compromise-scenarios.e2e.test.ts
```

**Expected**: All 8 attack scenarios fail (which means the security works):
1. Bot cannot transfer full treasury — `execTransaction` reverts
2. Bot cannot exceed daily allowance — sell policy rejects
3. Bot cannot change its own allowance — non-owner signature rejected
4. Bot cannot modify Roles permissions — non-owner rejected
5. Bot cannot add whitelisted addresses — non-owner rejected
6. Bot cannot enable/disable modules — non-owner rejected
7. Bot cannot transfer to arbitrary addresses — non-owner rejected
8. Swap recipient always treasury — encoding verified, privilege escalation blocked

### 3.6 Run the demo script

```bash
docker compose -f testing/docker-compose.yml run test-runner \
  bash scripts/crypto-demo.sh
```

**Expected**: All 9 demo steps execute (once the script is made functional in Phase 1.6).

### 3.7 Verify audit log integrity

```bash
docker compose -f testing/docker-compose.yml run test-runner \
  npx ts-node scripts/audit-viewer.ts --verify --path .clawcoin/audit.jsonl
```

---

## Phase 4: Production Readiness

### 4.1 GitHub Actions CI

Create `.github/workflows/ci.yml`:
- Trigger on push and PR to `main`
- Use Docker to run tests (same container as local)
- Jobs: lint, typecheck, contract-compile, contract-test, unit-test, e2e-test
- Consider: GitHub Actions has `ubuntu-latest` with Docker support; for ARM64 testing, use `runs-on: [self-hosted, ARM64]` pointing at the Pi (optional)

### 4.2 Pin dependency versions

Remove `^` from all versions in both `package.json` files and use exact versions. The `package-lock.json` already pins transitive deps, but pinning top-level deps prevents surprise updates:

```diff
- "@safe-global/protocol-kit": "^4.0.2",
+ "@safe-global/protocol-kit": "4.0.2",
```

### 4.3 `CONTRIBUTING.md`

For the public repo, document:
- How to set up the dev environment
- That all tests must run on Pi / in Docker (never on host)
- PR process and code review expectations
- Commit message conventions
- How to add new agent tools
- How to modify the sell policy or permissions model

### 4.4 Solidity security checklist

Before any real deployment, verify contracts against:
- [ ] OpenZeppelin best practices followed (we extend their contracts)
- [ ] No `mint()` function exists (hard invariant — already tested)
- [ ] No `selfdestruct` or `delegatecall` in custom code
- [ ] Constructor arguments validated (zero-address checks exist)
- [ ] ERC-20 approve race condition mitigated (ERC20Permit available)
- [ ] Integer overflow handled (Solidity 0.8+ has built-in checks)
- [ ] Consider a formal audit if real funds will ever be at stake

### 4.5 Testnet deployment guide

Document the steps to deploy on Base Sepolia:
1. Get Base Sepolia ETH from a faucet
2. Set `BASE_SEPOLIA_RPC_URL` and `DEPLOYER_PRIVATE_KEY` in `.env`
3. Run `npx hardhat run scripts/deploy-token.ts --network baseSepolia`
4. Record deployed addresses
5. Configure AllowanceModule and Roles via board multi-sig

### 4.6 Monitoring and alerting (future)

Ideas for production:
- Audit log integrity check on a cron (already built as a background service)
- Alert on emergency state changes
- Daily spending report from audit log
- Balance threshold alerts (Safe running low on ETH for gas)

---

## Quick Reference: What Files Need to Be Created

| File | Phase | Status |
|------|-------|--------|
| `contracts/package.json` | 1.1 | Missing — blocks everything |
| `package-lock.json` | 1.2 | Generated by `npm install` |
| `.env.example` | 1.3 | Missing |
| `scripts/pi-setup.sh` | 2.5 | Missing |
| `.github/workflows/ci.yml` | 4.1 | Missing |
| `CONTRIBUTING.md` | 4.3 | Missing |

## Quick Reference: What Files Need Modification

| File | Phase | Change |
|------|-------|--------|
| `scripts/crypto-demo.sh` | 1.6 | Replace echo stubs with real code |
| `testing/Dockerfile` | 2.6 | Maybe add `python3 make g++` for ARM64 native builds |
| `testing/docker-compose.yml` | 2.8 | Add memory limits for Pi |
| `package.json` | 4.2 | Pin dependency versions (remove `^`) |
| `contracts/package.json` | 4.2 | Pin dependency versions |
