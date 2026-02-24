# Clawcoin

Crypto treasury agent that launches ERC-20 tokens, manages Safe smart account
treasuries, and operates token-funded micro-businesses on Base L2.

**Built on [OpenClaw](https://github.com/openclaw/openclaw)** — installed as a
dependency, not forked. All code in this repo is Clawcoin-specific.

## Architecture

```
Clawcoin (this repo)              OpenClaw (npm dependency)
┌──────────────────────┐          ┌─────────────────────┐
│ src/core/             │          │ Gateway              │
│   safe-manager        │◄─plugin──│ Agent Runtime        │
│   allowance-manager   │  API     │ Plugin SDK           │
│   roles-manager       │          │ Messaging Connectors │
│   dex-manager         │          └─────────────────────┘
│   board-manager       │
│   emergency           │          On-Chain (Base L2)
│   keystore            │          ┌─────────────────────┐
│   audit-log           │          │ Safe Smart Account   │
│   sell-policy         │──txs────►│ AllowanceModule      │
│                       │          │ Zodiac Roles         │
│ contracts/            │          │ ClawcoinToken (ERC20)│
│   ClawcoinToken.sol   │          │ Uniswap V3          │
│   TokenVesting.sol    │          └─────────────────────┘
└──────────────────────┘
```

## Key Safety Invariants

1. **Fixed token supply** — no mint function, supply set at deployment
2. **Bot cannot change its own limits** — all policy changes require board M-of-N
3. **Spending is capped** — daily USDC allowance enforced on-chain via Safe AllowanceModule
4. **Operator tokens time-locked** — 6-month cliff, 24-month linear vest
5. **All testing in VM/container** — tests refuse to run on host machine

## Project Structure

```
src/
├── core/               # Business logic
│   ├── safe-manager.ts        # Safe deployment + management
│   ├── allowance-manager.ts   # Spending limits (AllowanceModule)
│   ├── roles-manager.ts       # Permission scoping (Zodiac Roles)
│   ├── dex-manager.ts         # Uniswap V3 swaps
│   ├── sell-policy.ts         # Deterministic sell caps
│   ├── board-manager.ts       # Multi-sig proposals
│   ├── offline-signer.ts      # Fallback signing (no tx service)
│   ├── keystore.ts            # Encrypted key management
│   ├── audit-log.ts           # Append-only hash-chain log
│   ├── emergency.ts           # Pause / rotate / shutdown
│   └── chain-config.ts        # Per-chain contract addresses
├── tools/              # OpenClaw agent tools (7 tools)
├── services/           # Background services
├── commands/           # CLI / chat commands
├── types/              # TypeScript type definitions
└── utils/              # Helpers

contracts/              # Solidity (Hardhat)
├── ClawcoinToken.sol          # Fixed-supply ERC-20
└── TokenVesting.sol           # Operator allocation time-lock

skills/skill-crypto-treasury/  # OpenClaw skill definition
testing/                       # Docker test environment
docs/                          # Full documentation
```

## Getting Started

See [docs/CRYPTO_TREASURY.md](docs/CRYPTO_TREASURY.md) for full setup instructions.

## Testing

**All tests run in a container — never on your local machine.**

```bash
# Build and run all tests
docker compose -f testing/docker-compose.yml up --build

# Run specific test suites
docker compose -f testing/docker-compose.yml run test-runner npm test
docker compose -f testing/docker-compose.yml run contract-tests
```

## License

MIT
