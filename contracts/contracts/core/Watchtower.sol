// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {NameVault} from "./NameVault.sol";

/// @dev Live expiry sources. .eth registrar names expire on the BaseRegistrar;
///      wrapped names carry expiry in the NameWrapper's packed data.
interface IExpiryRegistrar {
    function nameExpires(uint256 id) external view returns (uint256);
}

interface IExpiryWrapper {
    function getData(uint256 id) external view returns (address owner, uint32 fuses, uint64 expiry);
}

/// @title  Watchtower — the watch that never sleeps (name-layer observation)
/// @notice The observation half of the theft/lapse defenses (Sentinel Lock is
///         the intervention half). A contract cannot send you an email — but it
///         CAN be the single, immutable, timestamped source of truth that
///         off-chain alerting reads from. Watchtower:
///           * computes an escalation LEVEL from a name's live expiry;
///           * lets keepers checkpoint that level on-chain, emitting an
///             auditable trail and an Escalated event the moment risk worsens;
///           * records permissionless, attributed ALARMS (resolver changed,
///             owner changed, suspicious transfer seen);
///           * records CONFUSABLE reports (homoglyph / impersonation watchlist);
///           * anchors a RESURRECTION deadline once a name lapses (the v2
///             recent-owner premium-exemption recovery window).
///
/// @dev    PURE OBSERVATION LAYER: no privileged surface, no custody, no admin,
///         no governance hooks. It only READS the NameVault and the expiry
///         sources. Enrollment is holder-gated (watch your own names);
///         checkpoints, alarms, and confusable reports are permissionless and
///         attributed (a community watchtower). Decoupled from SentinelLock by
///         design in v1 — humans/keepers react to Watchtower signals via the
///         Sentinel; a "Watchtower-as-guardian" auto-freeze opt-in is a flagged
///         future integration.
contract Watchtower {
    NameVault public immutable nameVault;
    IExpiryRegistrar public immutable registrar;
    IExpiryWrapper public immutable nameWrapper;

    uint256 public constant CRITICAL_WINDOW = 7 days;
    uint256 public constant WARNING_WINDOW = 30 days;
    uint256 public constant NOTICE_WINDOW = 90 days;
    /// @dev v2 recent-owner premium-exemption window (placeholder duration).
    uint256 public constant RESURRECTION_WINDOW = 90 days;

    enum Level {
        Calm,     // > 90d
        Notice,   // 30-90d
        Warning,  // 7-30d
        Critical, // 0-7d
        Expired   // past expiry
    }

    enum AlarmKind {
        ResolverChanged,
        OwnerChanged,
        TransferObserved,
        Confusable,
        Other
    }

    struct Watch {
        bool active;
        uint8 custody;       // snapshot at enroll (NameVault.CUSTODY_*)
        uint8 lastLevel;
        uint48 enrolledAt;
        uint48 lastCheckedAt;
        uint48 lapsedAt;     // first time observed Expired (resurrection anchor)
    }

    mapping(uint256 tokenId => Watch) private _watches;
    uint256 public watchedCount;

    event Watched(uint256 indexed tokenId, address indexed holder, uint8 custody);
    event Unwatched(uint256 indexed tokenId, address indexed holder);
    event WatchClosed(uint256 indexed tokenId); // position left the vault
    event Checkpointed(uint256 indexed tokenId, Level level, uint256 expiry, address checker);
    event Escalated(uint256 indexed tokenId, Level from, Level to);
    event Lapsed(uint256 indexed tokenId, uint48 lapsedAt, uint256 resurrectionDeadline);
    event AlarmRaised(uint256 indexed tokenId, AlarmKind indexed kind, address indexed reporter, bytes32 dataHash);
    event ConfusableReported(uint256 indexed protectedTokenId, bytes32 indexed confusableLabelhash, address indexed reporter, bytes32 dataHash);

    error ZeroArg();
    error NotHolder(uint256 tokenId, address caller);
    error AlreadyWatched(uint256 tokenId);
    error NotWatched(uint256 tokenId);

    constructor(NameVault nameVault_, IExpiryRegistrar registrar_, IExpiryWrapper nameWrapper_) {
        if (
            address(nameVault_) == address(0) || address(registrar_) == address(0)
                || address(nameWrapper_) == address(0)
        ) revert ZeroArg();
        nameVault = nameVault_;
        registrar = registrar_;
        nameWrapper = nameWrapper_;
    }

    // ------------------------------------------------------------ enrollment
    /// @notice Enroll one of your NameVault positions for watching. Holder-only.
    function watch(uint256 tokenId) external {
        if (nameVault.ownerOf(tokenId) != msg.sender) revert NotHolder(tokenId, msg.sender);
        if (_watches[tokenId].active) revert AlreadyWatched(tokenId);
        uint8 custody = nameVault.position(tokenId).custodyClass;
        Level lvl = _levelOf(tokenId, custody);
        _watches[tokenId] = Watch({
            active: true,
            custody: custody,
            lastLevel: uint8(lvl),
            enrolledAt: uint48(block.timestamp),
            lastCheckedAt: uint48(block.timestamp),
            lapsedAt: lvl == Level.Expired ? uint48(block.timestamp) : 0
        });
        watchedCount += 1;
        emit Watched(tokenId, msg.sender, custody);
    }

    /// @notice Stop watching. Holder-only.
    function unwatch(uint256 tokenId) external {
        if (!_watches[tokenId].active) revert NotWatched(tokenId);
        if (nameVault.ownerOf(tokenId) != msg.sender) revert NotHolder(tokenId, msg.sender);
        _close(tokenId);
        emit Unwatched(tokenId, msg.sender);
    }

    // ------------------------------------------------------------ checkpoint
    /// @notice Record the current escalation level on-chain. Permissionless
    ///         (keeper / community watch duty). Emits Escalated when risk
    ///         worsens, anchors the resurrection deadline on first lapse, and
    ///         auto-closes the watch if the position has left the vault.
    function checkpoint(uint256 tokenId) public returns (Level level) {
        Watch storage w = _watches[tokenId];
        if (!w.active) revert NotWatched(tokenId);

        // position gone (unwrapped/migrated) -> auto-close, no false alarms
        try nameVault.ownerOf(tokenId) returns (address) {}
        catch {
            _close(tokenId);
            emit WatchClosed(tokenId);
            return Level.Calm;
        }

        level = _levelOf(tokenId, w.custody);
        uint256 expiry = _expiryOf(tokenId, w.custody);

        if (uint8(level) > w.lastLevel) emit Escalated(tokenId, Level(w.lastLevel), level);
        if (level == Level.Expired && w.lapsedAt == 0) {
            w.lapsedAt = uint48(block.timestamp);
            emit Lapsed(tokenId, w.lapsedAt, block.timestamp + RESURRECTION_WINDOW);
        }
        w.lastLevel = uint8(level);
        w.lastCheckedAt = uint48(block.timestamp);
        emit Checkpointed(tokenId, level, expiry, msg.sender);
    }

    /// @notice Batch checkpoint (keeper convenience).
    function checkpointBatch(uint256[] calldata tokenIds) external {
        for (uint256 i = 0; i < tokenIds.length; ++i) {
            if (_watches[tokenIds[i]].active) checkpoint(tokenIds[i]);
        }
    }

    // ---------------------------------------------------------------- alarms
    /// @notice Record an observed anomaly. Permissionless, attributed,
    ///         event-only (off-chain indexers consume). `dataHash` commits to
    ///         off-chain evidence (e.g. the changed resolver address).
    function raiseAlarm(uint256 tokenId, AlarmKind kind, bytes32 dataHash) external {
        emit AlarmRaised(tokenId, kind, msg.sender, dataHash);
    }

    /// @notice Report a confusable/homoglyph lookalike of a protected name.
    ///         Permissionless, attributed, event-only (impersonation watchlist).
    function reportConfusable(uint256 protectedTokenId, bytes32 confusableLabelhash, bytes32 dataHash)
        external
    {
        emit ConfusableReported(protectedTokenId, confusableLabelhash, msg.sender, dataHash);
    }

    // ----------------------------------------------------------------- views
    /// @notice Pure escalation ladder from an expiry timestamp.
    function levelFor(uint256 expiry, uint256 nowTs) public pure returns (Level) {
        if (nowTs >= expiry) return Level.Expired;
        uint256 remaining = expiry - nowTs;
        if (remaining <= CRITICAL_WINDOW) return Level.Critical;
        if (remaining <= WARNING_WINDOW) return Level.Warning;
        if (remaining <= NOTICE_WINDOW) return Level.Notice;
        return Level.Calm;
    }

    /// @notice Live level for a watched name.
    function levelOf(uint256 tokenId) external view returns (Level) {
        Watch storage w = _watches[tokenId];
        if (!w.active) revert NotWatched(tokenId);
        return _levelOf(tokenId, w.custody);
    }

    /// @notice Live expiry for a watched name.
    function expiryOf(uint256 tokenId) external view returns (uint256) {
        Watch storage w = _watches[tokenId];
        if (!w.active) revert NotWatched(tokenId);
        return _expiryOf(tokenId, w.custody);
    }

    function watchInfo(uint256 tokenId) external view returns (Watch memory) {
        return _watches[tokenId];
    }

    /// @notice Resurrection deadline once lapsed; 0 if not yet lapsed.
    function resurrectionDeadline(uint256 tokenId) external view returns (uint256) {
        uint48 lapsedAt = _watches[tokenId].lapsedAt;
        return lapsedAt == 0 ? 0 : uint256(lapsedAt) + RESURRECTION_WINDOW;
    }

    // ------------------------------------------------------------- internals
    function _expiryOf(uint256 tokenId, uint8 custody) internal view returns (uint256) {
        if (custody == nameVault.CUSTODY_W1155()) {
            (,, uint64 expiry) = nameWrapper.getData(tokenId);
            return expiry;
        }
        return registrar.nameExpires(tokenId);
    }

    function _levelOf(uint256 tokenId, uint8 custody) internal view returns (Level) {
        return levelFor(_expiryOf(tokenId, custody), block.timestamp);
    }

    function _close(uint256 tokenId) internal {
        _watches[tokenId].active = false;
        watchedCount -= 1;
    }
}
