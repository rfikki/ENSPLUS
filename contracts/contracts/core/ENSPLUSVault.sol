// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IVotes} from "@openzeppelin/contracts/governance/utils/IVotes.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Checkpoints} from "@openzeppelin/contracts/utils/structs/Checkpoints.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

/// @title  ENSPLUSVault — the wrapped ENS token ("ENS+")
/// @notice 1:1 wrapper over the ENS governance token. Holders wrap to join the
///         ENSPLUS internal governance; the vault's aggregated underlying voting
///         power is delegated to the (governance-ratified) external delegate.
///
/// @dev    COVENANTS (threat model V1/V2; invariants I1–I4) — enforced by
///         construction, verified by the invariant test suite:
///         C1. UNDERLYING OUTFLOW: the ONLY code path that moves underlying ENS
///             out of this contract is unwrap(), and it pays msg.sender exactly
///             the amount burned. No sweep, no rescue, no admin transfer,
///             no approvals are ever granted on the underlying. (I1, I2)
///         C2. CONSERVATION: totalSupply() == underlying.balanceOf(this) at all
///             times. Wrap mints what it pulls; unwrap burns what it pays. (I3)
///         C3. NO PRIVILEGED MUTATION: no owner, no pause, no upgrade path.
///             The single governed surface is setDelegatee(), gated by the
///             immutable governor address (genesis wiring: InternalGovernor).
///             Fee amount and splitter are immutable. (I4)
///         C4. EXIT SOVEREIGNTY: unwrap() has no fee, no queue, no pause, and
///             no external dependency beyond the underlying token itself.
///
///         DESIGN NOTES
///         * Underlying is assumed to be the canonical ENS ERC20Votes token
///           (exact transfer amounts, no fee-on-transfer, no hooks).
///         * Balance checkpoints (ERC-6372 clock = timestamp) give the
///           InternalGovernor snapshot balances via balanceOfAt(); weight math
///           (sqrt/caps/vesting/dormancy) lives in LibWeight at governor level.
///         * vestingStart per account feeds LibWeight.vestingWad (flash-wrap
///           defense G3). Any balance increase — wrap OR transfer-in — folds
///           into an amount-weighted average start, so freshly acquired ENS+
///           always carries fresh vesting regardless of acquisition path.
///         * wrapFee (ETH, may be zero) forwards to the immutable RevenueSplitter
///           inside wrap(); the vault never holds ETH between transactions.
contract ENSPLUSVault is ERC20, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using Checkpoints for Checkpoints.Trace208;

    // ---------------------------------------------------------------- config
    IERC20 public immutable underlying;
    address public immutable governor;      // genesis: InternalGovernor
    address public immutable feeSplitter;   // RevenueSplitter
    uint256 public immutable wrapFeeWei;    // may be 0

    address public delegatee;               // external delegate of underlying votes

    // ------------------------------------------------------------ vote state
    mapping(address account => Checkpoints.Trace208) private _balanceCkpts;
    Checkpoints.Trace208 private _totalSupplyCkpts;

    /// @notice Amount-weighted-average vesting start per account (LibWeight G3).
    mapping(address account => uint64) public vestingStart;

    /// @notice Number of accounts with nonzero ENS+ balance (turnout denominator
    ///         for the InternalGovernor's epoch accounting).
    uint256 public holderCount;

    // ---------------------------------------------------------------- events
    event Wrapped(address indexed account, uint256 amount, uint256 feePaid);
    event Unwrapped(address indexed account, uint256 amount);
    event DelegateeChanged(address indexed previousDelegatee, address indexed newDelegatee);

    // ---------------------------------------------------------------- errors
    error ZeroAmount();
    error WrongFee(uint256 sent, uint256 required);
    error NotGovernor(address caller);
    error ZeroAddress();
    error FeeForwardFailed();
    error FutureLookup(uint48 timepoint, uint48 clockNow);

    constructor(
        IERC20 underlying_,
        address governor_,
        address feeSplitter_,
        uint256 wrapFeeWei_,
        address initialDelegatee_
    ) ERC20("ENSPLUS", "ENS+") {
        if (
            address(underlying_) == address(0) || governor_ == address(0)
                || feeSplitter_ == address(0) || initialDelegatee_ == address(0)
        ) revert ZeroAddress();
        underlying = underlying_;
        governor = governor_;
        feeSplitter = feeSplitter_;
        wrapFeeWei = wrapFeeWei_;
        delegatee = initialDelegatee_;
        IVotes(address(underlying_)).delegate(initialDelegatee_);
    }

    // ------------------------------------------------------------ wrap flows
    /// @notice Wrap `amount` underlying ENS into ENS+ 1:1. Requires exact wrapFee.
    function wrap(uint256 amount) external payable nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (msg.value != wrapFeeWei) revert WrongFee(msg.value, wrapFeeWei);

        underlying.safeTransferFrom(msg.sender, address(this), amount);
        _mint(msg.sender, amount);

        if (msg.value > 0) {
            (bool ok,) = feeSplitter.call{value: msg.value}("");
            if (!ok) revert FeeForwardFailed();
        }
        emit Wrapped(msg.sender, amount, msg.value);
    }

    /// @notice Unwrap `amount` ENS+ back to underlying ENS 1:1. Never fees,
    ///         never queues, never pauses. (C4 / Article IX)
    function unwrap(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        _burn(msg.sender, amount);
        underlying.safeTransfer(msg.sender, amount);
        emit Unwrapped(msg.sender, amount);
    }

    // ------------------------------------------------------------ delegation
    /// @notice Re-point the vault's aggregated external voting power. Governance
    ///         only (genesis: InternalGovernor executing a ratified decision).
    function setDelegatee(address newDelegatee) external {
        if (msg.sender != governor) revert NotGovernor(msg.sender);
        if (newDelegatee == address(0)) revert ZeroAddress();
        emit DelegateeChanged(delegatee, newDelegatee);
        delegatee = newDelegatee;
        IVotes(address(underlying)).delegate(newDelegatee);
    }

    // ---------------------------------------------------- ERC-6372 + lookups
    function clock() public view returns (uint48) {
        return SafeCast.toUint48(block.timestamp);
    }

    // solhint-disable-next-line func-name-mixedcase
    function CLOCK_MODE() external pure returns (string memory) {
        return "mode=timestamp";
    }

    /// @notice Balance of `account` at a past timepoint (strictly before now).
    function balanceOfAt(address account, uint48 timepoint) external view returns (uint256) {
        if (timepoint >= clock()) revert FutureLookup(timepoint, clock());
        return _balanceCkpts[account].upperLookupRecent(timepoint);
    }

    /// @notice Total supply at a past timepoint (strictly before now).
    function totalSupplyAt(uint48 timepoint) external view returns (uint256) {
        if (timepoint >= clock()) revert FutureLookup(timepoint, clock());
        return _totalSupplyCkpts.upperLookupRecent(timepoint);
    }

    /// @notice Seconds of vesting elapsed for `account` (LibWeight.vestingWad input).
    function vestingElapsed(address account) external view returns (uint256) {
        uint64 start = vestingStart[account];
        if (start == 0 || balanceOf(account) == 0) return 0;
        return block.timestamp - start;
    }

    // ----------------------------------------------------------------- hooks
    /// @dev Checkpoints + vesting bookkeeping on every balance change.
    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);

        // holder count (self-transfers are net-neutral by construction)
        if (value > 0 && from != to) {
            if (to != address(0) && balanceOf(to) == value) holderCount++;      // 0 -> nonzero
            if (from != address(0) && balanceOf(from) == 0) holderCount--;      // nonzero -> 0
        }

        if (from != address(0)) {
            _balanceCkpts[from].push(clock(), SafeCast.toUint208(balanceOf(from)));
        }
        if (to != address(0)) {
            uint256 newBal = balanceOf(to);
            _balanceCkpts[to].push(clock(), SafeCast.toUint208(newBal));
            // amount-weighted vesting start: prior balance keeps its start,
            // incoming `value` starts now.
            uint256 priorBal = newBal - value;
            if (priorBal == 0) {
                vestingStart[to] = uint64(block.timestamp);
            } else {
                uint256 blended = (uint256(vestingStart[to]) * priorBal + block.timestamp * value)
                    / newBal;
                vestingStart[to] = uint64(blended);
            }
        }
        if (from == address(0) || to == address(0)) {
            _totalSupplyCkpts.push(clock(), SafeCast.toUint208(totalSupply()));
        }
    }
}
