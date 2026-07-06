// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title  RevenueSplitter — constitutionally hard-routed revenue slices
/// @notice Receives protocol ETH revenue (wrap fees, module fees) and splits it
///         to a fixed payee set at fixed basis points. Payees and slices are
///         set once in the constructor and can NEVER change — per Article VIII,
///         redirecting the funding slices requires a constitutional amendment,
///         which in practice means deploying a successor splitter and ratifying
///         the modules that point at it (append-only history, no mutation).
///
/// @dev    COVENANT PROPERTIES (I4-adjacent; threat model "splitter %" rows):
///         * No owner, no setters, no upgrade path. Immutable payees + bps.
///         * flush() is permissionless (keeper job class): distributes the
///           entire current balance pro-rata; the LAST payee receives the
///           division remainder so no dust accumulates.
///         * Push-based distribution: genesis payees are protocol contracts
///           (Renewal Pool, tithe escrow, ops budget) designed to accept ETH.
///           A reverting payee reverts the whole flush — deliberate: a broken
///           protocol payee is a stop-the-line event, not something to route
///           around silently.
///         * Accepts ETH from anyone (donations simply join the next flush).
contract RevenueSplitter {
    uint256 public constant TOTAL_BPS = 10_000;

    address[] private _payees;
    uint16[] private _bps;

    event Received(address indexed from, uint256 amount);
    event Flushed(uint256 total);
    event Paid(address indexed payee, uint256 amount);

    error LengthMismatch();
    error NoPayees();
    error ZeroPayee();
    error ZeroBps();
    error BpsSumInvalid(uint256 sum);
    error NothingToFlush();
    error PayFailed(address payee);

    constructor(address[] memory payees_, uint16[] memory bps_) {
        if (payees_.length != bps_.length) revert LengthMismatch();
        if (payees_.length == 0) revert NoPayees();
        uint256 sum;
        for (uint256 i = 0; i < payees_.length; ++i) {
            if (payees_[i] == address(0)) revert ZeroPayee();
            if (bps_[i] == 0) revert ZeroBps();
            sum += bps_[i];
        }
        if (sum != TOTAL_BPS) revert BpsSumInvalid(sum);
        _payees = payees_;
        _bps = bps_;
    }

    receive() external payable {
        emit Received(msg.sender, msg.value);
    }

    /// @notice Distribute the entire current balance. Permissionless.
    function flush() external {
        uint256 total = address(this).balance;
        if (total == 0) revert NothingToFlush();

        uint256 paidOut;
        uint256 n = _payees.length;
        for (uint256 i = 0; i < n; ++i) {
            uint256 share = i == n - 1
                ? total - paidOut // last payee takes the remainder (no dust)
                : (total * _bps[i]) / TOTAL_BPS;
            paidOut += share;
            (bool ok,) = _payees[i].call{value: share}("");
            if (!ok) revert PayFailed(_payees[i]);
            emit Paid(_payees[i], share);
        }
        emit Flushed(total);
    }

    // ----------------------------------------------------------------- views
    function payees() external view returns (address[] memory) {
        return _payees;
    }

    function bps() external view returns (uint16[] memory) {
        return _bps;
    }

    function sliceCount() external view returns (uint256) {
        return _payees.length;
    }
}
