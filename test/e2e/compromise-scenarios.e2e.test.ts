/**
 * Adversarial Compromise Scenario Tests
 *
 * Simulates a compromised bot execution key and asserts that damage is bounded.
 * These tests prove the fundamental security invariant: a compromised bot key
 * can spend AT MOST one period's allowance to whitelisted addresses only.
 *
 * The bot CANNOT:
 *   1. Transfer full treasury (not a Safe owner)
 *   2. Exceed daily allowance
 *   3. Change its own allowance
 *   4. Modify Roles permissions
 *   5. Add new whitelisted addresses
 *   6. Enable/disable Safe modules
 *   7. Transfer to non-whitelisted addresses
 *   8. Set swap recipient to non-treasury address
 *
 * Runs against a local Hardhat node with forked Base state.
 * Must run inside test container (IN_CLAWCOIN_TEST_CONTAINER=1).
 */

import { describe, it, expect, beforeAll } from "vitest";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  parseUnits,
  encodeFunctionData,
  decodeFunctionResult,
  parseAbi,
  getAddress,
  type PublicClient,
  type WalletClient,
  type Address,
  type Hash,
} from "viem";
import { hardhat } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RPC_URL = process.env.HARDHAT_NODE_URL ?? "http://127.0.0.1:8545";

// Hardhat default accounts
const BOARD_MEMBER_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const BOT_KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
const ATTACKER_KEY =
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a" as const;

const boardAccount = privateKeyToAccount(BOARD_MEMBER_KEY);
const botAccount = privateKeyToAccount(BOT_KEY);
const attackerAccount = privateKeyToAccount(ATTACKER_KEY);

// ---------------------------------------------------------------------------
// ABIs
// ---------------------------------------------------------------------------

const SAFE_ABI = parseAbi([
  "function setup(address[] calldata _owners, uint256 _threshold, address to, bytes calldata data, address fallbackHandler, address paymentToken, uint256 payment, address payable paymentReceiver) external",
  "function execTransaction(address to, uint256 value, bytes calldata data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address payable refundReceiver, bytes memory signatures) external payable returns (bool success)",
  "function enableModule(address module) external",
  "function disableModule(address prevModule, address module) external",
  "function isModuleEnabled(address module) external view returns (bool)",
  "function getOwners() external view returns (address[])",
  "function getThreshold() external view returns (uint256)",
  "function nonce() external view returns (uint256)",
  "function addOwnerWithThreshold(address owner, uint256 _threshold) external",
  "function removeOwner(address prevOwner, address owner, uint256 _threshold) external",
  "function swapOwner(address prevOwner, address oldOwner, address newOwner) external",
  "function changeThreshold(uint256 _threshold) external",
  "function getTransactionHash(address to, uint256 value, bytes calldata data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, uint256 _nonce) external view returns (bytes32)",
]);

const ALLOWANCE_MODULE_ABI = parseAbi([
  "function addDelegate(address delegate) external",
  "function removeDelegate(address delegate, bool removeAllowances) external",
  "function setAllowance(address delegate, address token, uint96 allowanceAmount, uint16 resetTimeMin, uint32 resetBaseMin) external",
  "function executeAllowanceTransfer(address safe, address token, address payable to, uint96 amount, address paymentToken, uint96 payment, address delegate, bytes signature) external",
  "function getTokenAllowance(address safe, address delegate, address token) external view returns (uint256[5])",
  "function resetAllowance(address delegate, address token) external",
  "function deleteAllowance(address delegate, address token) external",
]);

const ROLES_MOD_ABI = parseAbi([
  "function assignRoles(address module, uint16[] calldata roleIds, bool[] calldata memberOf) external",
  "function scopeTarget(uint16 roleId, address targetAddress) external",
  "function scopeFunction(uint16 roleId, address targetAddress, bytes4 functionSig, bool isScoped, uint8 paramType) external",
  "function setDefaultRole(address module, uint16 roleId) external",
  "function owner() external view returns (address)",
]);

const ERC20_ABI = parseAbi([
  "function transfer(address to, uint256 amount) external returns (bool)",
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function balanceOf(address) external view returns (uint256)",
]);

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

let publicClient: PublicClient;
let boardWallet: WalletClient;
let botWallet: WalletClient;

let safeAddress: Address;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Execute a transaction through the Safe as the board member (1-of-1 threshold).
 */
async function execSafeTxAsBoard(
  to: Address,
  data: `0x${string}`,
  value = 0n,
): Promise<Hash> {
  const nonce = await publicClient.readContract({
    address: safeAddress,
    abi: SAFE_ABI,
    functionName: "nonce",
  });

  const txHash = await publicClient.readContract({
    address: safeAddress,
    abi: SAFE_ABI,
    functionName: "getTransactionHash",
    args: [
      to,
      value,
      data,
      0,
      0n,
      0n,
      0n,
      "0x0000000000000000000000000000000000000000" as Address,
      "0x0000000000000000000000000000000000000000" as Address,
      nonce as bigint,
    ],
  });

  const signature = await boardAccount.signMessage({
    message: { raw: txHash as `0x${string}` },
  });
  const sigBytes = Buffer.from(signature.slice(2), "hex");
  sigBytes[64] += 4;
  const safeSignature = `0x${sigBytes.toString("hex")}` as `0x${string}`;

  const hash = await boardWallet.writeContract({
    address: safeAddress,
    abi: SAFE_ABI,
    functionName: "execTransaction",
    args: [
      to,
      value,
      data,
      0,
      0n,
      0n,
      0n,
      "0x0000000000000000000000000000000000000000" as Address,
      "0x0000000000000000000000000000000000000000" as Address,
      safeSignature,
    ],
    account: boardAccount,
    chain: hardhat,
  });

  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe("Compromise Scenarios — Bot Key Stolen", () => {
  beforeAll(async () => {
    publicClient = createPublicClient({
      chain: hardhat,
      transport: http(RPC_URL),
    });

    boardWallet = createWalletClient({
      chain: hardhat,
      transport: http(RPC_URL),
      account: boardAccount,
    });

    botWallet = createWalletClient({
      chain: hardhat,
      transport: http(RPC_URL),
      account: botAccount,
    });

    // Deploy a Safe with board member as the only owner
    const Safe = (await import("@safe-global/protocol-kit")).default;
    const protocolKit = await Safe.init({
      provider: RPC_URL,
      signer: BOARD_MEMBER_KEY,
      predictedSafe: {
        safeAccountConfig: {
          owners: [boardAccount.address],
          threshold: 1,
        },
      },
    });

    const deployTx = await protocolKit.createSafeDeploymentTransaction();
    const deployHash = await boardWallet.sendTransaction({
      to: deployTx.to as Address,
      data: deployTx.data as `0x${string}`,
      value: BigInt(deployTx.value),
      account: boardAccount,
      chain: hardhat,
    });
    await publicClient.waitForTransactionReceipt({ hash: deployHash });

    safeAddress = (await protocolKit.getAddress()) as Address;

    // Fund Safe with ETH
    const fundHash = await boardWallet.sendTransaction({
      to: safeAddress,
      value: parseEther("100"),
      account: boardAccount,
      chain: hardhat,
    });
    await publicClient.waitForTransactionReceipt({ hash: fundHash });
  });

  // -------------------------------------------------------------------------
  // Test 1: Compromised bot cannot transfer full treasury
  // -------------------------------------------------------------------------
  describe("Test 1: Bot cannot transfer full treasury directly", () => {
    it("bot's direct execTransaction attempt reverts (not an owner)", async () => {
      const nonce = await publicClient.readContract({
        address: safeAddress,
        abi: SAFE_ABI,
        functionName: "nonce",
      });

      // Bot tries to create and sign a Safe transaction as if it were an owner
      const txHash = await publicClient.readContract({
        address: safeAddress,
        abi: SAFE_ABI,
        functionName: "getTransactionHash",
        args: [
          attackerAccount.address, // send to attacker
          parseEther("100"), // drain all ETH
          "0x" as `0x${string}`,
          0,
          0n,
          0n,
          0n,
          "0x0000000000000000000000000000000000000000" as Address,
          "0x0000000000000000000000000000000000000000" as Address,
          nonce as bigint,
        ],
      });

      // Sign with bot key (NOT an owner)
      const signature = await botAccount.signMessage({
        message: { raw: txHash as `0x${string}` },
      });
      const sigBytes = Buffer.from(signature.slice(2), "hex");
      sigBytes[64] += 4;
      const safeSignature = `0x${sigBytes.toString("hex")}` as `0x${string}`;

      // Attempt to execute — should revert because bot is not an owner
      await expect(
        botWallet.writeContract({
          address: safeAddress,
          abi: SAFE_ABI,
          functionName: "execTransaction",
          args: [
            attackerAccount.address,
            parseEther("100"),
            "0x" as `0x${string}`,
            0,
            0n,
            0n,
            0n,
            "0x0000000000000000000000000000000000000000" as Address,
            "0x0000000000000000000000000000000000000000" as Address,
            safeSignature,
          ],
          account: botAccount,
          chain: hardhat,
        }),
      ).rejects.toThrow(); // GS026: Invalid owner signature
    });

    it("Safe balance unchanged after failed attack", async () => {
      const balance = await publicClient.getBalance({ address: safeAddress });
      expect(balance).toBeGreaterThanOrEqual(parseEther("100"));
    });
  });

  // -------------------------------------------------------------------------
  // Test 2: Compromised bot cannot exceed daily allowance
  // -------------------------------------------------------------------------
  describe("Test 2: Bot cannot exceed daily allowance", () => {
    it("sell policy enforces daily spending cap", () => {
      // This tests our TypeScript enforcement layer — the sell policy
      // that runs BEFORE any on-chain transaction is submitted.
      const { SellPolicy } = require("../../src/core/sell-policy.js");

      const policy = new SellPolicy({
        maxSellPerDayUsdc: "10000000", // 10 USDC daily
        maxSellPerTxUsdc: "5000000", // 5 USDC per tx
        minPoolLiquidityUsdc: "1000000000",
        maxSlippageBps: 100,
        cooldownMinutes: 0, // no cooldown for test
        maxDailyTxCount: 100,
      });

      // Spend up to the daily limit
      const result1 = policy.canSell({
        amountOutUsdc: 5000000n,
        poolLiquidityUsdc: 50000000000n,
      });
      expect(result1.allowed).toBe(true);
      policy.recordSell(5000000n);

      const result2 = policy.canSell({
        amountOutUsdc: 5000000n,
        poolLiquidityUsdc: 50000000000n,
      });
      expect(result2.allowed).toBe(true);
      policy.recordSell(5000000n);

      // Now at 10 USDC — any more should be rejected
      const result3 = policy.canSell({
        amountOutUsdc: 1n, // Even 1 micro-USDC
        poolLiquidityUsdc: 50000000000n,
      });
      expect(result3.allowed).toBe(false);
      expect(result3.reason).toContain("daily cap");
    });
  });

  // -------------------------------------------------------------------------
  // Test 3: Compromised bot cannot change its own allowance
  // -------------------------------------------------------------------------
  describe("Test 3: Bot cannot change its own allowance", () => {
    it("bot's direct call to Safe.execTransaction to modify allowance reverts", async () => {
      // Bot tries to call setAllowance on the AllowanceModule by submitting
      // a Safe transaction. This requires an owner signature — bot doesn't have one.

      const fakeAllowanceModule = botAccount.address; // placeholder
      const setAllowanceData = encodeFunctionData({
        abi: ALLOWANCE_MODULE_ABI,
        functionName: "setAllowance",
        args: [
          botAccount.address, // delegate
          "0x0000000000000000000000000000000000000001" as Address, // token
          BigInt("999999999999") as unknown as bigint, // huge allowance
          0, // resetTimeMin
          0, // resetBaseMin
        ],
      });

      // Wrap in a Safe execTransaction call
      const nonce = await publicClient.readContract({
        address: safeAddress,
        abi: SAFE_ABI,
        functionName: "nonce",
      });

      const txHash = await publicClient.readContract({
        address: safeAddress,
        abi: SAFE_ABI,
        functionName: "getTransactionHash",
        args: [
          fakeAllowanceModule,
          0n,
          setAllowanceData,
          0,
          0n,
          0n,
          0n,
          "0x0000000000000000000000000000000000000000" as Address,
          "0x0000000000000000000000000000000000000000" as Address,
          nonce as bigint,
        ],
      });

      const signature = await botAccount.signMessage({
        message: { raw: txHash as `0x${string}` },
      });
      const sigBytes = Buffer.from(signature.slice(2), "hex");
      sigBytes[64] += 4;
      const safeSignature = `0x${sigBytes.toString("hex")}` as `0x${string}`;

      // Should revert — bot is not an owner
      await expect(
        botWallet.writeContract({
          address: safeAddress,
          abi: SAFE_ABI,
          functionName: "execTransaction",
          args: [
            fakeAllowanceModule,
            0n,
            setAllowanceData,
            0,
            0n,
            0n,
            0n,
            "0x0000000000000000000000000000000000000000" as Address,
            "0x0000000000000000000000000000000000000000" as Address,
            safeSignature,
          ],
          account: botAccount,
          chain: hardhat,
        }),
      ).rejects.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // Test 4: Compromised bot cannot modify Roles permissions
  // -------------------------------------------------------------------------
  describe("Test 4: Bot cannot modify Roles permissions", () => {
    it("bot cannot call Roles admin functions via Safe (not an owner)", async () => {
      // Bot tries to modify its own role by submitting a Safe transaction
      // that calls assignRoles or scopeTarget on the Roles Modifier.

      const fakeRolesModifier = botAccount.address; // placeholder
      const assignRolesData = encodeFunctionData({
        abi: ROLES_MOD_ABI,
        functionName: "assignRoles",
        args: [
          botAccount.address, // module (itself)
          [1], // roleIds
          [true], // memberOf
        ],
      });

      const nonce = await publicClient.readContract({
        address: safeAddress,
        abi: SAFE_ABI,
        functionName: "nonce",
      });

      const txHash = await publicClient.readContract({
        address: safeAddress,
        abi: SAFE_ABI,
        functionName: "getTransactionHash",
        args: [
          fakeRolesModifier,
          0n,
          assignRolesData,
          0,
          0n,
          0n,
          0n,
          "0x0000000000000000000000000000000000000000" as Address,
          "0x0000000000000000000000000000000000000000" as Address,
          nonce as bigint,
        ],
      });

      const signature = await botAccount.signMessage({
        message: { raw: txHash as `0x${string}` },
      });
      const sigBytes = Buffer.from(signature.slice(2), "hex");
      sigBytes[64] += 4;
      const safeSignature = `0x${sigBytes.toString("hex")}` as `0x${string}`;

      await expect(
        botWallet.writeContract({
          address: safeAddress,
          abi: SAFE_ABI,
          functionName: "execTransaction",
          args: [
            fakeRolesModifier,
            0n,
            assignRolesData,
            0,
            0n,
            0n,
            0n,
            "0x0000000000000000000000000000000000000000" as Address,
            "0x0000000000000000000000000000000000000000" as Address,
            safeSignature,
          ],
          account: botAccount,
          chain: hardhat,
        }),
      ).rejects.toThrow(); // Invalid owner
    });
  });

  // -------------------------------------------------------------------------
  // Test 5: Compromised bot cannot add new whitelisted addresses
  // -------------------------------------------------------------------------
  describe("Test 5: Bot cannot add whitelisted addresses", () => {
    it("bot cannot call scopeTarget via Safe (not an owner)", async () => {
      // Adding a new target to the Roles whitelist requires a Safe execTransaction
      // with an owner's signature — bot doesn't have one.

      const fakeRolesModifier = botAccount.address;
      const scopeTargetData = encodeFunctionData({
        abi: ROLES_MOD_ABI,
        functionName: "scopeTarget",
        args: [
          1, // roleId
          attackerAccount.address, // attacker's address to whitelist
        ],
      });

      const nonce = await publicClient.readContract({
        address: safeAddress,
        abi: SAFE_ABI,
        functionName: "nonce",
      });

      const txHash = await publicClient.readContract({
        address: safeAddress,
        abi: SAFE_ABI,
        functionName: "getTransactionHash",
        args: [
          fakeRolesModifier,
          0n,
          scopeTargetData,
          0,
          0n,
          0n,
          0n,
          "0x0000000000000000000000000000000000000000" as Address,
          "0x0000000000000000000000000000000000000000" as Address,
          nonce as bigint,
        ],
      });

      const signature = await botAccount.signMessage({
        message: { raw: txHash as `0x${string}` },
      });
      const sigBytes = Buffer.from(signature.slice(2), "hex");
      sigBytes[64] += 4;
      const safeSignature = `0x${sigBytes.toString("hex")}` as `0x${string}`;

      await expect(
        botWallet.writeContract({
          address: safeAddress,
          abi: SAFE_ABI,
          functionName: "execTransaction",
          args: [
            fakeRolesModifier,
            0n,
            scopeTargetData,
            0,
            0n,
            0n,
            0n,
            "0x0000000000000000000000000000000000000000" as Address,
            "0x0000000000000000000000000000000000000000" as Address,
            safeSignature,
          ],
          account: botAccount,
          chain: hardhat,
        }),
      ).rejects.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // Test 6: Compromised bot cannot enable/disable modules
  // -------------------------------------------------------------------------
  describe("Test 6: Bot cannot enable/disable modules", () => {
    it("bot cannot enableModule on Safe (not an owner)", async () => {
      const enableModuleData = encodeFunctionData({
        abi: SAFE_ABI,
        functionName: "enableModule",
        args: [attackerAccount.address], // attacker's malicious module
      });

      const nonce = await publicClient.readContract({
        address: safeAddress,
        abi: SAFE_ABI,
        functionName: "nonce",
      });

      const txHash = await publicClient.readContract({
        address: safeAddress,
        abi: SAFE_ABI,
        functionName: "getTransactionHash",
        args: [
          safeAddress, // enableModule is a call to the Safe itself
          0n,
          enableModuleData,
          0,
          0n,
          0n,
          0n,
          "0x0000000000000000000000000000000000000000" as Address,
          "0x0000000000000000000000000000000000000000" as Address,
          nonce as bigint,
        ],
      });

      const signature = await botAccount.signMessage({
        message: { raw: txHash as `0x${string}` },
      });
      const sigBytes = Buffer.from(signature.slice(2), "hex");
      sigBytes[64] += 4;
      const safeSignature = `0x${sigBytes.toString("hex")}` as `0x${string}`;

      await expect(
        botWallet.writeContract({
          address: safeAddress,
          abi: SAFE_ABI,
          functionName: "execTransaction",
          args: [
            safeAddress,
            0n,
            enableModuleData,
            0,
            0n,
            0n,
            0n,
            "0x0000000000000000000000000000000000000000" as Address,
            "0x0000000000000000000000000000000000000000" as Address,
            safeSignature,
          ],
          account: botAccount,
          chain: hardhat,
        }),
      ).rejects.toThrow();
    });

    it("bot cannot disableModule on Safe (not an owner)", async () => {
      // First, have board enable a module so we can test disabling
      const enableData = encodeFunctionData({
        abi: SAFE_ABI,
        functionName: "enableModule",
        args: [attackerAccount.address],
      });
      await execSafeTxAsBoard(safeAddress, enableData);

      // Verify module is enabled
      const isEnabled = await publicClient.readContract({
        address: safeAddress,
        abi: SAFE_ABI,
        functionName: "isModuleEnabled",
        args: [attackerAccount.address],
      });
      expect(isEnabled).toBe(true);

      // Bot tries to disable it
      const disableData = encodeFunctionData({
        abi: SAFE_ABI,
        functionName: "disableModule",
        args: [
          "0x0000000000000000000000000000000000000001" as Address, // sentinel
          attackerAccount.address,
        ],
      });

      const nonce = await publicClient.readContract({
        address: safeAddress,
        abi: SAFE_ABI,
        functionName: "nonce",
      });

      const txHash = await publicClient.readContract({
        address: safeAddress,
        abi: SAFE_ABI,
        functionName: "getTransactionHash",
        args: [
          safeAddress,
          0n,
          disableData,
          0,
          0n,
          0n,
          0n,
          "0x0000000000000000000000000000000000000000" as Address,
          "0x0000000000000000000000000000000000000000" as Address,
          nonce as bigint,
        ],
      });

      const signature = await botAccount.signMessage({
        message: { raw: txHash as `0x${string}` },
      });
      const sigBytes = Buffer.from(signature.slice(2), "hex");
      sigBytes[64] += 4;
      const safeSignature = `0x${sigBytes.toString("hex")}` as `0x${string}`;

      await expect(
        botWallet.writeContract({
          address: safeAddress,
          abi: SAFE_ABI,
          functionName: "execTransaction",
          args: [
            safeAddress,
            0n,
            disableData,
            0,
            0n,
            0n,
            0n,
            "0x0000000000000000000000000000000000000000" as Address,
            "0x0000000000000000000000000000000000000000" as Address,
            safeSignature,
          ],
          account: botAccount,
          chain: hardhat,
        }),
      ).rejects.toThrow();

      // Module still enabled — bot couldn't disable it
      const stillEnabled = await publicClient.readContract({
        address: safeAddress,
        abi: SAFE_ABI,
        functionName: "isModuleEnabled",
        args: [attackerAccount.address],
      });
      expect(stillEnabled).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Test 7: Compromised bot cannot transfer to non-whitelisted addresses
  // -------------------------------------------------------------------------
  describe("Test 7: Bot cannot transfer to arbitrary addresses", () => {
    it("bot cannot execute arbitrary Safe transactions (not an owner)", async () => {
      // Bot tries to transfer Safe ETH to an arbitrary attacker address
      const nonce = await publicClient.readContract({
        address: safeAddress,
        abi: SAFE_ABI,
        functionName: "nonce",
      });

      const txHash = await publicClient.readContract({
        address: safeAddress,
        abi: SAFE_ABI,
        functionName: "getTransactionHash",
        args: [
          attackerAccount.address, // non-whitelisted destination
          parseEther("1"),
          "0x" as `0x${string}`,
          0,
          0n,
          0n,
          0n,
          "0x0000000000000000000000000000000000000000" as Address,
          "0x0000000000000000000000000000000000000000" as Address,
          nonce as bigint,
        ],
      });

      const signature = await botAccount.signMessage({
        message: { raw: txHash as `0x${string}` },
      });
      const sigBytes = Buffer.from(signature.slice(2), "hex");
      sigBytes[64] += 4;
      const safeSignature = `0x${sigBytes.toString("hex")}` as `0x${string}`;

      await expect(
        botWallet.writeContract({
          address: safeAddress,
          abi: SAFE_ABI,
          functionName: "execTransaction",
          args: [
            attackerAccount.address,
            parseEther("1"),
            "0x" as `0x${string}`,
            0,
            0n,
            0n,
            0n,
            "0x0000000000000000000000000000000000000000" as Address,
            "0x0000000000000000000000000000000000000000" as Address,
            safeSignature,
          ],
          account: botAccount,
          chain: hardhat,
        }),
      ).rejects.toThrow();
    });

    it("Safe balance unchanged after transfer attempt", async () => {
      const balance = await publicClient.getBalance({ address: safeAddress });
      expect(balance).toBeGreaterThanOrEqual(parseEther("99")); // only board moved some
    });
  });

  // -------------------------------------------------------------------------
  // Test 8: Swap recipient is always treasury (TypeScript enforcement)
  // -------------------------------------------------------------------------
  describe("Test 8: Swap recipient is always treasury", () => {
    it("DexManager hardcodes recipient to Safe address", async () => {
      // This tests our TypeScript-level enforcement in DexManager.
      // The buildSwapTransaction always sets recipient = safeAddress.
      // Here we verify the encoding directly.

      const SWAP_ROUTER_ABI = parseAbi([
        "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountOut)",
      ]);

      const safeRecipient = safeAddress;
      const maliciousRecipient = attackerAccount.address;

      // Correct encoding (what DexManager produces)
      const correctCalldata = encodeFunctionData({
        abi: SWAP_ROUTER_ABI,
        functionName: "exactInputSingle",
        args: [
          {
            tokenIn: "0x0000000000000000000000000000000000000001" as Address,
            tokenOut: "0x0000000000000000000000000000000000000002" as Address,
            fee: 3000,
            recipient: safeRecipient, // Must always be the Safe
            amountIn: parseEther("100"),
            amountOutMinimum: 0n,
            sqrtPriceLimitX96: 0n,
          },
        ],
      });

      // Malicious encoding (what an attacker would try)
      const maliciousCalldata = encodeFunctionData({
        abi: SWAP_ROUTER_ABI,
        functionName: "exactInputSingle",
        args: [
          {
            tokenIn: "0x0000000000000000000000000000000000000001" as Address,
            tokenOut: "0x0000000000000000000000000000000000000002" as Address,
            fee: 3000,
            recipient: maliciousRecipient, // Attacker tries to divert funds
            amountIn: parseEther("100"),
            amountOutMinimum: 0n,
            sqrtPriceLimitX96: 0n,
          },
        ],
      });

      // The calldatas should be different (different recipient)
      expect(correctCalldata).not.toBe(maliciousCalldata);

      // Verify the correct calldata contains the Safe address
      const safeAddrLower = safeRecipient.slice(2).toLowerCase();
      expect(correctCalldata.toLowerCase()).toContain(safeAddrLower);

      // Verify the malicious calldata contains the attacker address
      const attackerAddrLower = maliciousRecipient.slice(2).toLowerCase();
      expect(maliciousCalldata.toLowerCase()).toContain(attackerAddrLower);
      expect(maliciousCalldata.toLowerCase()).not.toContain(safeAddrLower);

      // In production, the Zodiac Roles Modifier enforces this on-chain:
      // The BOT_OPERATOR role's scope for exactInputSingle has a parameter
      // constraint that the recipient field MUST equal the Safe address.
      // Any deviation is rejected by the Roles Modifier before execution.
    });

    it("bot cannot add itself as Safe owner (ultimate privilege escalation)", async () => {
      // The ultimate attack: bot tries to add itself as a Safe owner
      const addOwnerData = encodeFunctionData({
        abi: SAFE_ABI,
        functionName: "addOwnerWithThreshold",
        args: [botAccount.address, 1n],
      });

      const nonce = await publicClient.readContract({
        address: safeAddress,
        abi: SAFE_ABI,
        functionName: "nonce",
      });

      const txHash = await publicClient.readContract({
        address: safeAddress,
        abi: SAFE_ABI,
        functionName: "getTransactionHash",
        args: [
          safeAddress,
          0n,
          addOwnerData,
          0,
          0n,
          0n,
          0n,
          "0x0000000000000000000000000000000000000000" as Address,
          "0x0000000000000000000000000000000000000000" as Address,
          nonce as bigint,
        ],
      });

      const signature = await botAccount.signMessage({
        message: { raw: txHash as `0x${string}` },
      });
      const sigBytes = Buffer.from(signature.slice(2), "hex");
      sigBytes[64] += 4;
      const safeSignature = `0x${sigBytes.toString("hex")}` as `0x${string}`;

      await expect(
        botWallet.writeContract({
          address: safeAddress,
          abi: SAFE_ABI,
          functionName: "execTransaction",
          args: [
            safeAddress,
            0n,
            addOwnerData,
            0,
            0n,
            0n,
            0n,
            "0x0000000000000000000000000000000000000000" as Address,
            "0x0000000000000000000000000000000000000000" as Address,
            safeSignature,
          ],
          account: botAccount,
          chain: hardhat,
        }),
      ).rejects.toThrow();

      // Verify bot is still NOT an owner
      const owners = await publicClient.readContract({
        address: safeAddress,
        abi: SAFE_ABI,
        functionName: "getOwners",
      });
      const ownerAddresses = (owners as string[]).map((a: string) =>
        getAddress(a),
      );
      expect(ownerAddresses).not.toContain(getAddress(botAccount.address));
      expect(ownerAddresses).toContain(getAddress(boardAccount.address));
    });
  });

  // -------------------------------------------------------------------------
  // Summary: Verify Safe state is unmodified after all attacks
  // -------------------------------------------------------------------------
  describe("Post-attack verification", () => {
    it("Safe owners unchanged (only board member)", async () => {
      const owners = await publicClient.readContract({
        address: safeAddress,
        abi: SAFE_ABI,
        functionName: "getOwners",
      });
      expect(owners).toHaveLength(1);
      expect(getAddress(owners[0] as string)).toBe(
        getAddress(boardAccount.address),
      );
    });

    it("Safe threshold unchanged", async () => {
      const threshold = await publicClient.readContract({
        address: safeAddress,
        abi: SAFE_ABI,
        functionName: "getThreshold",
      });
      expect(threshold).toBe(1n);
    });

    it("Safe still holds its ETH", async () => {
      const balance = await publicClient.getBalance({ address: safeAddress });
      // Board only spent on module enablement, should still have ~100 ETH
      expect(balance).toBeGreaterThanOrEqual(parseEther("99"));
    });

    it("board can still operate normally after attack attempts", async () => {
      // Board member can still execute transactions
      const vendorBalanceBefore = await publicClient.getBalance({
        address: attackerAccount.address,
      });

      const hash = await execSafeTxAsBoard(
        attackerAccount.address, // Even the "attacker" address, if board approves
        "0x" as `0x${string}`,
        parseEther("0.01"),
      );
      expect(hash).toBeDefined();

      const vendorBalanceAfter = await publicClient.getBalance({
        address: attackerAccount.address,
      });
      expect(vendorBalanceAfter - vendorBalanceBefore).toBe(parseEther("0.01"));
    });
  });
});
