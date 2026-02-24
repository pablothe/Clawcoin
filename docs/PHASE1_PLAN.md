# Phase 1: Make Clawcoin Buildable

## Context

The codebase is architecturally complete — all 11 core modules, 7 tools, 2 Solidity contracts, and full test suites exist with real implementations. But **nothing has ever compiled or run**. This plan unblocks compilation, npm install, and Docker builds. It also adds an execution isolation warning to CLAUDE.md — the bot must only run on isolated hardware (Raspberry Pi or VM).

---

## Steps

### 1. Create `contracts/package.json` (NEW FILE)

Blocks npm workspaces, Docker build, and contract compilation.

```json
{
  "name": "@clawcoin/contracts",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "compile": "hardhat compile",
    "test": "hardhat test",
    "clean": "hardhat clean"
  },
  "devDependencies": {
    "hardhat": "^2.22.0",
    "@nomicfoundation/hardhat-toolbox": "^5.0.0",
    "@openzeppelin/contracts": "^5.0.0",
    "ethers": "^6.13.0"
  }
}
```

### 2. Create `src/types/openclaw-plugin-sdk.d.ts` (NEW FILE)

The `openclaw` package doesn't exist on npm. Only one type is used: `OpenClawPluginApi` in [index.ts](index.ts). Create a local type declaration module with the minimal API surface used by the plugin (pluginConfig, logger, registerTool, registerCommand, registerCli, registerService).

### 3. Fix `package.json` dependencies

- **Remove** `"openclaw": "latest"` from devDependencies (replaced by the local type stub)
- **Add** `"oxlint": "^0.16.0"` to devDependencies (the `lint` script calls `oxlint` but it's not listed)

### 4. Remove dead imports in `src/core/roles-manager.ts`

Lines 20-24 import `processPermissions`, `applyTargets`, and `type Target` from `zodiac-roles-sdk` — none are used in the file body. Remove the entire import block to prevent potential compile errors if those exports don't exist.

### 5. Run `npm install`

Generates `node_modules/` and `package-lock.json`. Known risks:
- `zodiac-roles-sdk` at `^2.0.0` may not exist — might be `@gnosis-guild/zodiac-roles-sdk` or similar. If so, update the package name.
- `@safe-global/safe-modules-deployments` at `^2.0.0` may not resolve — check and fix version.
- Peer dependency conflicts between Safe SDK, viem, and ethers — use `--legacy-peer-deps` if needed.

### 6. Clean up `.gitignore`

Remove the comment block at lines 58-59 that says `package-lock.json` isn't committed yet. It's currently commented out (not actually ignored), but the comment is misleading now that we're committing it.

### 7. TypeScript compilation (`tsc --noEmit`)

Fix any type errors iteratively. `skipLibCheck: true` in tsconfig avoids third-party type issues.

### 8. Compile Solidity contracts (`cd contracts && npx hardhat compile`)

Generates `contracts/artifacts/` and `contracts/typechain-types/` (both gitignored).

### 9. Docker build verification (`docker compose -f testing/docker-compose.yml build`)

Validates the full containerized build works end-to-end.

### 10. Update `CLAUDE.md`

**A. Add isolation safety warning** (new section after "Commands"):

```markdown
## CRITICAL: Execution Isolation

**ALL testing and running of the Clawcoin bot MUST happen on an isolated Raspberry Pi or VM. NEVER run the bot on a development machine.**

The bot takes autonomous control of a computer — executing blockchain transactions, managing cryptographic keys, and interacting with financial systems. Running without isolation risks unintended transactions, key exposure, and real blockchain interactions outside the container guard.

**Safe execution environments:**
- Docker container (tests): `docker compose -f testing/docker-compose.yml run test-runner npm test`
- Raspberry Pi (deployment): See `docs/ROADMAP.md` Phase 2
- VM with network isolation (alternative to Pi)
```

**B. Fix stale "Current Status" section** — update to reflect the project is now buildable and remove the outdated blockers list.

---

## Files Modified/Created

| File | Action |
|------|--------|
| `contracts/package.json` | Create |
| `src/types/openclaw-plugin-sdk.d.ts` | Create |
| `package.json` | Edit (remove openclaw, add oxlint) |
| `src/core/roles-manager.ts` | Edit (remove dead imports) |
| `.gitignore` | Edit (remove stale comment) |
| `CLAUDE.md` | Edit (add isolation warning, fix status) |

---

## Verification

1. `npm install` exits cleanly
2. `npx tsc --noEmit` — zero errors
3. `cd contracts && npx hardhat compile` — compiles both contracts
4. `docker compose -f testing/docker-compose.yml build` — builds successfully
5. `npm run lint` — oxlint runs without "command not found"
