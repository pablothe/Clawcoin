/**
 * Deploy ClawcoinToken + TokenVesting to a target network.
 *
 * Required env vars:
 *   TREASURY_SAFE_ADDRESS  — Safe smart account to receive 80% of supply
 *   VESTING_BENEFICIARY    — Address that can claim vested tokens
 *
 * Optional env vars:
 *   TOKEN_NAME     — Default: "Clawcoin"
 *   TOKEN_SYMBOL   — Default: "CLAW"
 *   TOKEN_SUPPLY   — Default: "1000000" (whole tokens)
 *   CLIFF_MONTHS   — Default: 6
 *   VESTING_MONTHS — Default: 24
 */

import { ethers } from "hardhat";

async function main() {
  const treasuryAddress = process.env.TREASURY_SAFE_ADDRESS;
  if (!treasuryAddress) throw new Error("TREASURY_SAFE_ADDRESS required");

  const vestingBeneficiary = process.env.VESTING_BENEFICIARY;
  if (!vestingBeneficiary) throw new Error("VESTING_BENEFICIARY required");

  const name = process.env.TOKEN_NAME || "Clawcoin";
  const symbol = process.env.TOKEN_SYMBOL || "CLAW";
  const supply = ethers.parseEther(process.env.TOKEN_SUPPLY || "1000000");
  const cliffMonths = Number(process.env.CLIFF_MONTHS || "6");
  const vestingMonths = Number(process.env.VESTING_MONTHS || "24");

  const now = Math.floor(Date.now() / 1000);
  const cliffSeconds = cliffMonths * 30 * 24 * 60 * 60;
  const vestingSeconds = vestingMonths * 30 * 24 * 60 * 60;

  console.log("Deploying TokenVesting...");
  const Vesting = await ethers.getContractFactory("TokenVesting");
  const vesting = await Vesting.deploy(
    vestingBeneficiary,
    now,
    cliffSeconds,
    vestingSeconds,
  );
  await vesting.waitForDeployment();
  const vestingAddress = await vesting.getAddress();
  console.log(`  TokenVesting deployed at: ${vestingAddress}`);

  console.log("Deploying ClawcoinToken...");
  const Token = await ethers.getContractFactory("ClawcoinToken");
  const token = await Token.deploy(
    name,
    symbol,
    supply,
    treasuryAddress,
    vestingAddress,
  );
  await token.waitForDeployment();
  const tokenAddress = await token.getAddress();
  console.log(`  ClawcoinToken deployed at: ${tokenAddress}`);

  // Output structured deployment info
  const deployment = {
    event: "deployment_complete",
    token: {
      address: tokenAddress,
      name,
      symbol,
      totalSupply: supply.toString(),
    },
    vesting: {
      address: vestingAddress,
      beneficiary: vestingBeneficiary,
      cliffMonths,
      vestingMonths,
    },
    treasury: treasuryAddress,
    network: (await ethers.provider.getNetwork()).name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    timestamp: new Date().toISOString(),
  };

  console.log("\n" + JSON.stringify(deployment, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
