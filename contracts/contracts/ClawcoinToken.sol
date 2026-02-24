// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";

/**
 * @title ClawcoinToken
 * @notice Fixed-supply ERC-20 token for a bot micro-business treasury.
 *
 * INVARIANT: No mint function exists. Total supply is immutable after deployment.
 * This is a hard safety constraint — the token supply can never increase.
 *
 * At deployment:
 *   - 80% of supply minted to the Safe treasury
 *   - 20% of supply minted to a TokenVesting contract (operator allocation, time-locked)
 *
 * Includes ERC20Permit for gasless approvals (EIP-2612) and ERC20Burnable
 * so tokens can be permanently removed from circulation.
 */
contract ClawcoinToken is ERC20, ERC20Permit, ERC20Burnable {
    /// @notice The treasury Safe address that received 80% of supply
    address public immutable treasury;

    /// @notice The vesting contract that received 20% of supply
    address public immutable vesting;

    /// @notice Treasury allocation in basis points (80%)
    uint16 public constant TREASURY_BPS = 8000;

    /// @notice Emitted once at deployment with all parameters
    event TokenDeployed(
        string name,
        string symbol,
        uint256 totalSupply,
        address indexed treasury,
        uint256 treasuryAllocation,
        address indexed vesting,
        uint256 vestingAllocation,
        address indexed deployer
    );

    /**
     * @param _name       Token name (e.g., "ClawBot Alpha Token")
     * @param _symbol     Token ticker (e.g., "CLAW")
     * @param _supply     Total fixed supply in wei (18 decimals)
     * @param _treasury   Safe smart account address (receives 80%)
     * @param _vesting    TokenVesting contract address (receives 20%)
     */
    constructor(
        string memory _name,
        string memory _symbol,
        uint256 _supply,
        address _treasury,
        address _vesting
    ) ERC20(_name, _symbol) ERC20Permit(_name) {
        require(_treasury != address(0), "Treasury cannot be zero address");
        require(_vesting != address(0), "Vesting cannot be zero address");
        require(_supply > 0, "Supply must be positive");

        treasury = _treasury;
        vesting = _vesting;

        uint256 treasuryAmount = (_supply * TREASURY_BPS) / 10000;
        uint256 vestingAmount = _supply - treasuryAmount;

        _mint(_treasury, treasuryAmount);
        _mint(_vesting, vestingAmount);

        emit TokenDeployed(
            _name,
            _symbol,
            _supply,
            _treasury,
            treasuryAmount,
            _vesting,
            vestingAmount,
            msg.sender
        );
    }

    // NOTE: There is intentionally NO mint() function.
    // The total supply is fixed forever at deployment.
}
