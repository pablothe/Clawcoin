// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title TokenVesting
 * @notice Holds the operator's token allocation with a cliff + linear vesting schedule.
 *
 * Prevents immediate dumping of the operator allocation. Tokens vest linearly
 * after an initial cliff period. Only the beneficiary can release vested tokens.
 *
 * Default schedule: 6-month cliff, 24-month total vesting.
 */
contract TokenVesting {
    using SafeERC20 for IERC20;

    /// @notice The address that receives vested tokens
    address public immutable beneficiary;

    /// @notice Vesting start timestamp (set at deployment)
    uint256 public immutable startTimestamp;

    /// @notice Cliff duration in seconds (tokens are fully locked until cliff ends)
    uint256 public immutable cliffDuration;

    /// @notice Total vesting duration in seconds (from start, not from cliff)
    uint256 public immutable vestingDuration;

    /// @notice Tracks how much of each token has been released
    mapping(address => uint256) public released;

    event TokensReleased(address indexed token, uint256 amount);

    /**
     * @param _beneficiary     Address that can claim vested tokens
     * @param _startTimestamp   When vesting begins (typically deployment time)
     * @param _cliffDuration    Cliff in seconds (e.g., 15552000 = 6 months)
     * @param _vestingDuration  Total vesting in seconds (e.g., 62208000 = 24 months)
     */
    constructor(
        address _beneficiary,
        uint256 _startTimestamp,
        uint256 _cliffDuration,
        uint256 _vestingDuration
    ) {
        require(_beneficiary != address(0), "Beneficiary cannot be zero address");
        require(_vestingDuration > 0, "Vesting duration must be positive");
        require(_cliffDuration <= _vestingDuration, "Cliff exceeds vesting duration");

        beneficiary = _beneficiary;
        startTimestamp = _startTimestamp;
        cliffDuration = _cliffDuration;
        vestingDuration = _vestingDuration;
    }

    /**
     * @notice Release vested tokens to the beneficiary.
     * @param token The ERC-20 token to release.
     */
    function release(address token) external {
        uint256 releasable = vestedAmount(token, block.timestamp) - released[token];
        require(releasable > 0, "No tokens to release");

        released[token] += releasable;
        IERC20(token).safeTransfer(beneficiary, releasable);

        emit TokensReleased(token, releasable);
    }

    /**
     * @notice Calculate the total vested amount for a token at a given timestamp.
     * @param token     The ERC-20 token address.
     * @param timestamp The timestamp to calculate vesting for.
     * @return The total vested amount (including already released).
     */
    function vestedAmount(address token, uint256 timestamp) public view returns (uint256) {
        uint256 totalAllocation = IERC20(token).balanceOf(address(this)) + released[token];

        if (timestamp < startTimestamp + cliffDuration) {
            // Before cliff: nothing vested
            return 0;
        } else if (timestamp >= startTimestamp + vestingDuration) {
            // After full vesting: everything vested
            return totalAllocation;
        } else {
            // Linear vesting between cliff and end
            return (totalAllocation * (timestamp - startTimestamp)) / vestingDuration;
        }
    }

    /**
     * @notice Check how many tokens are currently releasable.
     * @param token The ERC-20 token address.
     * @return The amount that can be released right now.
     */
    function releasableAmount(address token) external view returns (uint256) {
        return vestedAmount(token, block.timestamp) - released[token];
    }
}
