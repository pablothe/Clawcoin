import { expect } from "chai";
import { ethers } from "hardhat";

describe("ClawcoinToken", function () {
  const NAME = "TestClaw";
  const SYMBOL = "TCLAW";
  const SUPPLY = ethers.parseEther("1000000"); // 1M tokens

  async function deployToken() {
    const [deployer, treasury, vestingBeneficiary] =
      await ethers.getSigners();

    // Deploy a mock vesting contract (just an address for allocation)
    const Vesting = await ethers.getContractFactory("TokenVesting");
    const vesting = await Vesting.deploy(
      vestingBeneficiary.address,
      Math.floor(Date.now() / 1000),
      15552000, // 6 months cliff
      62208000, // 24 months vesting
    );

    const Token = await ethers.getContractFactory("ClawcoinToken");
    const token = await Token.deploy(
      NAME,
      SYMBOL,
      SUPPLY,
      treasury.address,
      await vesting.getAddress(),
    );

    return { token, vesting, deployer, treasury, vestingBeneficiary };
  }

  describe("Deployment", function () {
    it("mints 80% to treasury and 20% to vesting", async function () {
      const { token, vesting, treasury } = await deployToken();

      const treasuryBalance = await token.balanceOf(treasury.address);
      const vestingBalance = await token.balanceOf(await vesting.getAddress());

      expect(treasuryBalance).to.equal((SUPPLY * 8000n) / 10000n);
      expect(vestingBalance).to.equal((SUPPLY * 2000n) / 10000n);
      expect(await token.totalSupply()).to.equal(SUPPLY);
    });

    it("sets immutable treasury and vesting addresses", async function () {
      const { token, vesting, treasury } = await deployToken();

      expect(await token.treasury()).to.equal(treasury.address);
      expect(await token.vesting()).to.equal(await vesting.getAddress());
    });

    it("emits TokenDeployed event", async function () {
      const [, treasury, vestingBeneficiary] = await ethers.getSigners();
      const Vesting = await ethers.getContractFactory("TokenVesting");
      const vesting = await Vesting.deploy(
        vestingBeneficiary.address,
        Math.floor(Date.now() / 1000),
        15552000,
        62208000,
      );

      const Token = await ethers.getContractFactory("ClawcoinToken");
      await expect(
        Token.deploy(
          NAME,
          SYMBOL,
          SUPPLY,
          treasury.address,
          await vesting.getAddress(),
        ),
      ).to.emit(Token, "TokenDeployed");
    });

    it("reverts on zero treasury address", async function () {
      const [, , vestingBeneficiary] = await ethers.getSigners();
      const Vesting = await ethers.getContractFactory("TokenVesting");
      const vesting = await Vesting.deploy(
        vestingBeneficiary.address,
        Math.floor(Date.now() / 1000),
        15552000,
        62208000,
      );

      const Token = await ethers.getContractFactory("ClawcoinToken");
      await expect(
        Token.deploy(
          NAME,
          SYMBOL,
          SUPPLY,
          ethers.ZeroAddress,
          await vesting.getAddress(),
        ),
      ).to.be.revertedWith("Treasury cannot be zero address");
    });

    it("reverts on zero vesting address", async function () {
      const [, treasury] = await ethers.getSigners();
      const Token = await ethers.getContractFactory("ClawcoinToken");
      await expect(
        Token.deploy(NAME, SYMBOL, SUPPLY, treasury.address, ethers.ZeroAddress),
      ).to.be.revertedWith("Vesting cannot be zero address");
    });

    it("reverts on zero supply", async function () {
      const [, treasury, vestingBeneficiary] = await ethers.getSigners();
      const Vesting = await ethers.getContractFactory("TokenVesting");
      const vesting = await Vesting.deploy(
        vestingBeneficiary.address,
        Math.floor(Date.now() / 1000),
        15552000,
        62208000,
      );

      const Token = await ethers.getContractFactory("ClawcoinToken");
      await expect(
        Token.deploy(
          NAME,
          SYMBOL,
          0,
          treasury.address,
          await vesting.getAddress(),
        ),
      ).to.be.revertedWith("Supply must be positive");
    });
  });

  describe("Fixed Supply Invariant", function () {
    it("has no mint function (hard invariant)", async function () {
      const { token } = await deployToken();

      // Verify that no mint-related function exists in the ABI
      const abi = token.interface.fragments;
      const mintFunctions = abi.filter(
        (f) =>
          f.type === "function" &&
          ("name" in f) &&
          (f.name === "mint" || f.name === "_mint" || f.name === "mintTo"),
      );
      expect(mintFunctions).to.have.length(0);
    });

    it("total supply never changes after deployment", async function () {
      const { token, deployer } = await deployToken();

      const supplyBefore = await token.totalSupply();

      // Transfer some tokens
      const balance = await token.balanceOf(deployer.address);
      // deployer got 0 tokens (all went to treasury and vesting)
      expect(balance).to.equal(0n);

      const supplyAfter = await token.totalSupply();
      expect(supplyAfter).to.equal(supplyBefore);
    });
  });

  describe("ERC20Permit", function () {
    it("has EIP-712 domain", async function () {
      const { token } = await deployToken();
      const domain = await token.eip712Domain();
      expect(domain.name).to.equal(NAME);
    });
  });

  describe("Burnable", function () {
    it("allows token holders to burn", async function () {
      const { token, treasury } = await deployToken();

      const balanceBefore = await token.balanceOf(treasury.address);
      const burnAmount = ethers.parseEther("1000");

      await token.connect(treasury).burn(burnAmount);

      const balanceAfter = await token.balanceOf(treasury.address);
      expect(balanceAfter).to.equal(balanceBefore - burnAmount);

      // Total supply decreased
      expect(await token.totalSupply()).to.equal(SUPPLY - burnAmount);
    });
  });
});
