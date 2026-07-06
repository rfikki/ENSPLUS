// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ISentinel} from "./NameVault.sol";

/// @dev The subset of NameVault the Sentinel needs to read.
interface INameVaultOwnership {
    function ownerOf(uint256 tokenId) external view returns (address);
}

/// @title  SentinelLock — opt-in theft protection for NameVault positions
/// @notice A member voluntarily arms per-account protection: departures of a
///         position (transfer of the ENS+N NFT, or unwrap of the underlying)
///         must be announced and clear a self-chosen timelock. Trusted
///         guardians can fast-track a legitimate release or slam a panic
///         freeze; a wallet drainer who holds the keys is left staring at a
///         delay while the owner and guardians react.
///
/// @dev    COVENANT POSITION (why this doesn't violate exit sovereignty, C4):
///         The Sentinel is the OWNER's OWN door lock, never the protocol's.
///         * Unarmed accounts are never gated — consume* returns immediately.
///         * An armed owner can ALWAYS release their own asset by waiting out
///           the timelock THEY chose (bounded by MAX_TIMELOCK).
///         * Neither ENSPLUS, governance, nor any majority can arm, freeze, or
///           delay anyone — only the account holder and their chosen guardians
///           can, and only for that account.
///         So "the protocol cannot block your exit" stays literally true; the
///         only thing that can delay you is a restraint you put on yourself.
///
///         ANTI-THIEF STRUCTURE (a key-compromise attacker cannot instantly
///         undo protection):
///         * Arming is immediate (strengthening is always safe).
///         * WEAKENING — disarming, or lowering the timelock — is itself
///           timelocked and guardian-vetoable (requestDisarm/executeDisarm).
///         * A panic freeze (owner OR any single guardian) halts every pending
///           release; unfreezing needs the guardian threshold, so a lone thief
///           holding just the owner key cannot lift it.
///
///         CLAIM (per the claims register, STRONG not HARD): "theft requires
///         defeating your timelock, your guardians, and your alerts." Never
///         "cannot be stolen."
contract SentinelLock is ISentinel {
    INameVaultOwnership public immutable nameVault;

    uint32 public constant MIN_TIMELOCK = 1 hours;
    uint32 public constant MAX_TIMELOCK = 30 days;
    uint8 public constant MAX_GUARDIANS = 10;

    // -------------------------------------------------------------- config
    struct Guard {
        bool armed;
        bool frozen;
        uint32 timelock;
        uint8 threshold;      // guardians needed to fast-track / unfreeze
        address[] guardians;
        uint48 disarmReadyAt; // 0 = no pending disarm
    }

    enum ReleaseKind {
        None,
        Transfer,
        Unwrap
    }

    struct Release {
        ReleaseKind kind;
        address to;       // Transfer target (address(0) for Unwrap)
        uint48 readyAt;
        uint8 approvals;
    }

    mapping(address owner => Guard) private _guards;
    mapping(uint256 tokenId => Release) private _releases;
    mapping(uint256 tokenId => mapping(address guardian => bool)) public releaseApproved;
    mapping(address owner => mapping(address guardian => bool)) public unfreezeApproved;
    mapping(address owner => uint8) public unfreezeApprovals;

    // -------------------------------------------------------------- events
    event Armed(address indexed owner, uint32 timelock, uint8 threshold, uint256 guardianCount);
    event DisarmRequested(address indexed owner, uint48 readyAt);
    event Disarmed(address indexed owner);
    event ReleaseRequested(uint256 indexed tokenId, address indexed owner, ReleaseKind kind, address to, uint48 readyAt);
    event ReleaseApproved(uint256 indexed tokenId, address indexed guardian, uint8 approvals);
    event ReleaseCancelled(uint256 indexed tokenId, address indexed by);
    event ReleaseConsumed(uint256 indexed tokenId, ReleaseKind kind);
    event PanicFrozen(address indexed owner, address indexed by);
    event Unfrozen(address indexed owner);

    // -------------------------------------------------------------- errors
    error ZeroArg();
    error NotNameVault(address caller);
    error AlreadyArmed();
    error NotArmed();
    error BadTimelock(uint32 timelock);
    error TooManyGuardians(uint256 count);
    error BadThreshold(uint8 threshold, uint256 guardianCount);
    error NotOwner(uint256 tokenId, address caller);
    error NotGuardian(address caller);
    error Frozen();
    error NotFrozen();
    error NoRelease(uint256 tokenId);
    error ReleaseNotReady(uint256 tokenId, uint48 readyAt);
    error WrongRelease(uint256 tokenId);
    error DisarmNotReady(uint48 readyAt);
    error NoDisarmPending();
    error AlreadyApproved();

    constructor(INameVaultOwnership nameVault_) {
        if (address(nameVault_) == address(0)) revert ZeroArg();
        nameVault = nameVault_;
    }

    // ------------------------------------------------------------ arming
    /// @notice Arm protection for the caller's account. Immediate (arming only
    ///         ever strengthens). Fails if already armed — weaken via disarm.
    function arm(uint32 timelock, address[] calldata guardians, uint8 threshold) external {
        Guard storage g = _guards[msg.sender];
        if (g.armed) revert AlreadyArmed();
        if (timelock < MIN_TIMELOCK || timelock > MAX_TIMELOCK) revert BadTimelock(timelock);
        if (guardians.length > MAX_GUARDIANS) revert TooManyGuardians(guardians.length);
        if (threshold > guardians.length) revert BadThreshold(threshold, guardians.length);
        for (uint256 i = 0; i < guardians.length; ++i) {
            if (guardians[i] == address(0) || guardians[i] == msg.sender) revert ZeroArg();
        }
        g.armed = true;
        g.frozen = false;
        g.timelock = timelock;
        g.threshold = threshold;
        g.guardians = guardians;
        g.disarmReadyAt = 0;
        emit Armed(msg.sender, timelock, threshold, guardians.length);
    }

    /// @notice Begin disarming — timelocked and guardian-vetoable, so a thief
    ///         cannot instantly strip protection.
    function requestDisarm() external {
        Guard storage g = _guards[msg.sender];
        if (!g.armed) revert NotArmed();
        g.disarmReadyAt = uint48(block.timestamp) + g.timelock;
        emit DisarmRequested(msg.sender, g.disarmReadyAt);
    }

    /// @notice Complete a matured disarm. Frozen accounts cannot disarm.
    function executeDisarm() external {
        Guard storage g = _guards[msg.sender];
        if (!g.armed) revert NotArmed();
        if (g.frozen) revert Frozen();
        if (g.disarmReadyAt == 0) revert NoDisarmPending();
        if (block.timestamp < g.disarmReadyAt) revert DisarmNotReady(g.disarmReadyAt);
        delete _guards[msg.sender];
        emit Disarmed(msg.sender);
    }

    /// @notice Guardian veto of a pending disarm (theft response).
    function vetoDisarm(address owner) external {
        Guard storage g = _guards[owner];
        _requireGuardian(g, msg.sender);
        g.disarmReadyAt = 0;
        emit DisarmRequested(owner, 0);
    }

    // ------------------------------------------------------- release flow
    /// @notice Announce intent to move a position (Transfer or Unwrap). Starts
    ///         the owner's timelock. Overwrites any prior pending release.
    function requestRelease(uint256 tokenId, ReleaseKind kind, address to) external {
        if (nameVault.ownerOf(tokenId) != msg.sender) revert NotOwner(tokenId, msg.sender);
        Guard storage g = _guards[msg.sender];
        if (!g.armed) revert NotArmed();
        if (g.frozen) revert Frozen();
        if (kind == ReleaseKind.None) revert WrongRelease(tokenId);
        if (kind == ReleaseKind.Transfer && to == address(0)) revert ZeroArg();

        _clearApprovals(tokenId);
        _releases[tokenId] = Release({
            kind: kind,
            to: kind == ReleaseKind.Transfer ? to : address(0),
            readyAt: uint48(block.timestamp) + g.timelock,
            approvals: 0
        });
        emit ReleaseRequested(tokenId, msg.sender, kind, to, _releases[tokenId].readyAt);
    }

    /// @notice Guardian approval of a pending release; at threshold the release
    ///         matures immediately (fast-track a legitimate move).
    function approveRelease(uint256 tokenId) external {
        address owner = nameVault.ownerOf(tokenId);
        Guard storage g = _guards[owner];
        _requireGuardian(g, msg.sender);
        Release storage r = _releases[tokenId];
        if (r.kind == ReleaseKind.None) revert NoRelease(tokenId);
        if (releaseApproved[tokenId][msg.sender]) revert AlreadyApproved();
        releaseApproved[tokenId][msg.sender] = true;
        r.approvals += 1;
        if (g.threshold != 0 && r.approvals >= g.threshold) {
            r.readyAt = uint48(block.timestamp); // fast-track
        }
        emit ReleaseApproved(tokenId, msg.sender, r.approvals);
    }

    /// @notice Cancel a pending release. Owner (changed mind) OR any guardian
    ///         (suspected theft) may call.
    function cancelRelease(uint256 tokenId) external {
        address owner = nameVault.ownerOf(tokenId);
        if (msg.sender != owner) {
            _requireGuardian(_guards[owner], msg.sender);
        }
        if (_releases[tokenId].kind == ReleaseKind.None) revert NoRelease(tokenId);
        _clearApprovals(tokenId);
        delete _releases[tokenId];
        emit ReleaseCancelled(tokenId, msg.sender);
    }

    // ----------------------------------------------------------- panic
    /// @notice Instantly halt all releases for an account. Owner OR any single
    ///         guardian may trigger — the fastest possible theft response.
    function panicFreeze(address owner) external {
        Guard storage g = _guards[owner];
        if (!g.armed) revert NotArmed();
        if (msg.sender != owner) {
            _requireGuardian(g, msg.sender);
        }
        g.frozen = true;
        emit PanicFrozen(owner, msg.sender);
    }

    /// @notice Guardian votes to lift a freeze. Needs the guardian threshold,
    ///         so a lone key-holding thief cannot unfreeze. If the account has
    ///         no guardians (threshold 0), the owner lifts it directly.
    function approveUnfreeze(address owner) external {
        Guard storage g = _guards[owner];
        if (!g.frozen) revert NotFrozen();
        _requireGuardian(g, msg.sender);
        if (unfreezeApproved[owner][msg.sender]) revert AlreadyApproved();
        unfreezeApproved[owner][msg.sender] = true;
        unfreezeApprovals[owner] += 1;
        if (unfreezeApprovals[owner] >= g.threshold && g.threshold != 0) {
            _unfreeze(owner, g);
        }
    }

    /// @notice Owner-driven unfreeze, allowed only when there are no guardians
    ///         to consult (threshold 0). With guardians, unfreeze is theirs.
    function ownerUnfreeze() external {
        Guard storage g = _guards[msg.sender];
        if (!g.frozen) revert NotFrozen();
        if (g.threshold != 0) revert NotGuardian(msg.sender);
        _unfreeze(msg.sender, g);
    }

    function _unfreeze(address owner, Guard storage g) internal {
        g.frozen = false;
        // reset unfreeze tally
        for (uint256 i = 0; i < g.guardians.length; ++i) {
            unfreezeApproved[owner][g.guardians[i]] = false;
        }
        unfreezeApprovals[owner] = 0;
        emit Unfrozen(owner);
    }

    // --------------------------------------------------- vault guard hooks
    /// @inheritdoc ISentinel
    function consumeTransfer(address from, address to, uint256 tokenId) external {
        if (msg.sender != address(nameVault)) revert NotNameVault(msg.sender);
        Guard storage g = _guards[from];
        if (!g.armed) return; // unarmed: never gated
        if (g.frozen) revert Frozen();
        Release storage r = _releases[tokenId];
        if (r.kind != ReleaseKind.Transfer || r.to != to) revert WrongRelease(tokenId);
        if (block.timestamp < r.readyAt) revert ReleaseNotReady(tokenId, r.readyAt);
        _clearApprovals(tokenId);
        delete _releases[tokenId];
        emit ReleaseConsumed(tokenId, ReleaseKind.Transfer);
    }

    /// @inheritdoc ISentinel
    function consumeUnwrap(address owner, uint256 tokenId) external {
        if (msg.sender != address(nameVault)) revert NotNameVault(msg.sender);
        Guard storage g = _guards[owner];
        if (!g.armed) return; // unarmed: never gated
        if (g.frozen) revert Frozen();
        Release storage r = _releases[tokenId];
        if (r.kind != ReleaseKind.Unwrap) revert WrongRelease(tokenId);
        if (block.timestamp < r.readyAt) revert ReleaseNotReady(tokenId, r.readyAt);
        _clearApprovals(tokenId);
        delete _releases[tokenId];
        emit ReleaseConsumed(tokenId, ReleaseKind.Unwrap);
    }

    // ----------------------------------------------------------- views
    function guardOf(address owner)
        external
        view
        returns (bool armed, bool frozen, uint32 timelock, uint8 threshold, address[] memory guardians, uint48 disarmReadyAt)
    {
        Guard storage g = _guards[owner];
        return (g.armed, g.frozen, g.timelock, g.threshold, g.guardians, g.disarmReadyAt);
    }

    function releaseOf(uint256 tokenId) external view returns (Release memory) {
        return _releases[tokenId];
    }

    function isGuardian(address owner, address who) public view returns (bool) {
        address[] storage gs = _guards[owner].guardians;
        for (uint256 i = 0; i < gs.length; ++i) {
            if (gs[i] == who) return true;
        }
        return false;
    }

    // --------------------------------------------------------- internals
    function _requireGuardian(Guard storage g, address who) internal view {
        if (!g.armed) revert NotArmed();
        address[] storage gs = g.guardians;
        for (uint256 i = 0; i < gs.length; ++i) {
            if (gs[i] == who) return;
        }
        revert NotGuardian(who);
    }

    function _clearApprovals(uint256 tokenId) internal {
        Release storage r = _releases[tokenId];
        if (r.approvals == 0) return;
        // approvals are keyed per guardian; clearing the release plus resetting
        // the per-guardian flags for the current owner's guardian set.
        address owner = nameVault.ownerOf(tokenId);
        address[] storage gs = _guards[owner].guardians;
        for (uint256 i = 0; i < gs.length; ++i) {
            releaseApproved[tokenId][gs[i]] = false;
        }
    }
}
