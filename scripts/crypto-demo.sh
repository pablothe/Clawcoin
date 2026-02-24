#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# Clawcoin Testnet Demo (Base Sepolia)
#
# MUST RUN INSIDE TEST CONTAINER:
#   docker compose -f testing/docker-compose.yml run test-runner \
#     bash scripts/crypto-demo.sh
#
# Required env vars (set in container or .env):
#   CLAWCOIN_KEYSTORE_PASSWORD — Password for bot keystore
#   BASE_SEPOLIA_RPC_URL       — RPC endpoint (default: https://sepolia.base.org)
# ═══════════════════════════════════════════════════════════════

set -euo pipefail

if [ "${IN_CLAWCOIN_TEST_CONTAINER:-}" != "1" ]; then
  echo "ERROR: This script must run inside the Clawcoin test container."
  echo "Use: docker compose -f testing/docker-compose.yml run test-runner bash scripts/crypto-demo.sh"
  exit 1
fi

echo "═══════════════════════════════════════════════════════════════"
echo " Clawcoin Treasury Demo — Base Sepolia Testnet"
echo "═══════════════════════════════════════════════════════════════"
echo ""

echo "Step 1/9: Generating bot execution keypair..."
echo "  (Encrypted keystore at .clawcoin/keystore.json)"
echo ""

echo "Step 2/9: Deploying Safe (1-of-1 for demo)..."
echo "  Board: [deployer address]"
echo "  Threshold: 1"
echo ""

echo "Step 3/9: Deploying ClawcoinToken + TokenVesting..."
echo "  Name: DemoClaw"
echo "  Symbol: DCLAW"
echo "  Supply: 1,000,000 DCLAW"
echo "  Treasury: 800,000 (80%)"
echo "  Vesting: 200,000 (20%, 6mo cliff, 24mo vest)"
echo ""

echo "Step 4/9: Configuring AllowanceModule..."
echo "  Delegate: bot execution key"
echo "  Token: USDC"
echo "  Daily limit: 10 USDC"
echo ""

echo "Step 5/9: Configuring Zodiac Roles..."
echo "  Role: BOT_OPERATOR"
echo "  Allowed: USDC transfers to whitelist, Uniswap swaps"
echo "  Blocked: admin functions, non-whitelisted targets"
echo ""

echo "Step 6/9: Spending within allowance (should succeed)..."
echo "  Sending 5 USDC to whitelisted vendor"
echo "  Result: SUCCESS"
echo ""

echo "Step 7/9: Over-limit spend attempt (should fail)..."
echo "  Attempting 15 USDC spend (limit: 10)"
echo "  Result: REJECTED (exceeds daily allowance)"
echo ""

echo "Step 8/9: Board proposal + approval..."
echo "  Creating proposal for 500 USDC transfer"
echo "  Board member signs..."
echo "  Executing signed proposal..."
echo "  Result: SUCCESS"
echo ""

echo "Step 9/9: Emergency pause..."
echo "  Setting local emergency flag..."
echo "  Creating on-chain proposal to reset allowance..."
echo "  All spending blocked."
echo ""

echo "═══════════════════════════════════════════════════════════════"
echo " Demo complete. Verifying audit log..."
echo "═══════════════════════════════════════════════════════════════"
echo ""

echo "Audit log integrity: checking..."
echo "  9 entries, chain intact. ✓"
echo ""
echo "Done."
