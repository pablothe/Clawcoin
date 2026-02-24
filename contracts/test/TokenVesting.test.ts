import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("TokenVesting", function () {
  const SIX_MONTHS = 15552000; // 180 days in seconds
  const TWENTY_FOUR_MONTHS = 62208000; // 720 days in seconds
  const TOKEN_AMOUNT = ethers.parseEther("200000"); // 200K tokens (20% of 1M)

  async function deployVestingWithToken() {
    const [deployer, beneficiary, treasury] = await ethers.getSigners();
    const startTime = await time.latest();

    // Deploy vesting contract
    const Vesting = await ethers.getContractFactory("TokenVesting");
    const vesting = await Vesting.deploy(
      beneficiary.address,
      startTime,
      SIX_MONTHS,
      TWENTY_FOUR_MONTHS,
    );
    const vestingAddress = await vesting.getAddress();

    // Deploy token with vesting as allocation target
    const Token = await ethers.getContractFactory("ClawcoinToken");
    const token = await Token.deploy(
      "TestClaw",
      "TCLAW",
      ethers.parseEther("1000000"),
      treasury.address,
      vestingAddress,
    );

    return { vesting, token, deployer, beneficiary, treasury, startTime };
  }

  describe("Deployment", function () {
    it("sets correct parameters", async function () {
      const { vesting, beneficiary, startTime } =
        await deployVestingWithToken();

      expect(await vesting.beneficiary()).to.equal(beneficiary.address);
      expect(await vesting.startTimestamp()).to.equal(startTime);
      expect(await vesting.cliffDuration()).to.equal(SIX_MONTHS);
      expect(await vesting.vestingDuration()).to.equal(TWENTY_FOUR_MONTHS);
    });

    it("reverts on zero beneficiary", async function () {
      const Vesting = await ethers.getContractFactory("TokenVesting");
      await expect(
        Vesting.deploy(ethers.ZeroAddress, 1000, SIX_MONTHS, TWENTY_FOUR_MONTHS),
      ).to.be.revertedWith("Beneficiary cannot be zero address");
    });

    it("reverts if cliff exceeds vesting duration", async function () {
      const [, beneficiary] = await ethers.getSigners();
      const Vesting = await ethers.getContractFactory("TokenVesting");
      await expect(
        Vesting.deploy(
          beneficiary.address,
          1000,
          TWENTY_FOUR_MONTHS + 1,
          TWENTY_FOUR_MONTHS,
        ),
      ).to.be.revertedWith("Cliff exceeds vesting duration");
    });
  });

  describe("Cliff Enforcement", function () {
    it("returns 0 vested before cliff", async function () {
      const { vesting, token } = await deployVestingWithToken();

      // Move forward 5 months (before 6-month cliff)
      await time.increase(SIX_MONTHS - 100);

      const vested = await vesting.vestedAmount(
        await token.getAddress(),
        await time.latest(),
      );
      expect(vested).to.equal(0n);
    });

    it("reverts release before cliff", async function () {
      const { vesting, token } = await deployVestingWithToken();

      await time.increase(SIX_MONTHS - 100);

      await expect(
        vesting.release(await token.getAddress()),
      ).to.be.revertedWith("No tokens to release");
    });
  });

  describe("Linear Vesting", function () {
    it("vests proportionally after cliff", async function () {
      const { vesting, token, startTime } = await deployVestingWithToken();

      // Move to exactly halfway (12 months)
      await time.increaseTo(startTime + TWENTY_FOUR_MONTHS / 2);

      const vested = await vesting.vestedAmount(
        await token.getAddress(),
        await time.latest(),
      );

      // At 12 months, approximately 50% should be vested
      // (linear from start, not from cliff)
      const expectedApprox = TOKEN_AMOUNT / 2n;
      const tolerance = ethers.parseEther("100"); // small tolerance for timing

      expect(vested).to.be.closeTo(expectedApprox, tolerance);
    });

    it("vests 100% after full duration", async function () {
      const { vesting, token, startTime } = await deployVestingWithToken();

      await time.increaseTo(startTime + TWENTY_FOUR_MONTHS + 1);

      const vested = await vesting.vestedAmount(
        await token.getAddress(),
        await time.latest(),
      );
      expect(vested).to.equal(TOKEN_AMOUNT);
    });
  });

  describe("Release", function () {
    it("allows beneficiary to release vested tokens", async function () {
      const { vesting, token, beneficiary, startTime } =
        await deployVestingWithToken();

      // Move past cliff
      await time.increaseTo(startTime + SIX_MONTHS + 1);

      const tokenAddress = await token.getAddress();
      const releasable = await vesting.releasableAmount(tokenAddress);
      expect(releasable).to.be.gt(0n);

      // Release
      await vesting.release(tokenAddress);

      // Beneficiary received tokens
      const beneficiaryBalance = await token.balanceOf(beneficiary.address);
      expect(beneficiaryBalance).to.be.gt(0n);
    });

    it("tracks released amounts correctly", async function () {
      const { vesting, token, startTime } = await deployVestingWithToken();
      const tokenAddress = await token.getAddress();

      // First release at 12 months
      await time.increaseTo(startTime + TWENTY_FOUR_MONTHS / 2);
      await vesting.release(tokenAddress);
      const firstRelease = await vesting.released(tokenAddress);

      // Second release at 24 months
      await time.increaseTo(startTime + TWENTY_FOUR_MONTHS + 1);
      await vesting.release(tokenAddress);
      const totalReleased = await vesting.released(tokenAddress);

      expect(totalReleased).to.be.gt(firstRelease);
      expect(totalReleased).to.equal(TOKEN_AMOUNT);
    });

    it("emits TokensReleased event", async function () {
      const { vesting, token, startTime } = await deployVestingWithToken();
      const tokenAddress = await token.getAddress();

      await time.increaseTo(startTime + TWENTY_FOUR_MONTHS + 1);

      await expect(vesting.release(tokenAddress))
        .to.emit(vesting, "TokensReleased")
        .withArgs(tokenAddress, TOKEN_AMOUNT);
    });
  });
});
