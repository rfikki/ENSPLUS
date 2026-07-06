// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {LibTrust} from "../libraries/LibTrust.sol";
import {LibCategory} from "../libraries/LibCategory.sol";

/// @dev Minimal read surfaces of the live ENSPLUS contracts the oracle reads.
interface IAttestorRead {
    function boundTo(bytes32 labelhash) external view returns (address);
    function boundEra(bytes32 labelhash) external view returns (uint8);
    function boundRank(bytes32 labelhash) external view returns (uint32);
    function eraWad(uint256 era) external view returns (uint256);
}

interface IGovernorRead {
    function currentEpoch() external view returns (uint256);
    function activeInEpoch(uint256 epoch, address account) external view returns (bool);
}

interface INameVaultRead {
    struct Position {
        uint8 custodyClass;
        uint8 v2Status;
        uint48 wrappedAt;
        uint32 fuseSnapshot;
        uint64 expirySnapshot;
    }

    function ownerOf(uint256 tokenId) external view returns (address);
    function position(uint256 tokenId) external view returns (Position memory);
}

interface IRenewalRead {
    function yearsBanked(uint256 tokenId) external view returns (uint256);
}

interface ICitizenRead {
    function creditsOf(address member) external view returns (uint256);
}

interface IHumanRead {
    function isVerifiedHuman(address account) external view returns (bool);
}

/// @title  TrustOracle — LibTrust, live against the real ENSPLUS registries
/// @notice A pure READ-ONLY aggregator (no state, no admin, no writes). It
///         gathers a member's L1-native reputation inputs from the sources
///         ENSPLUS already owns and returns LibTrust's reputation + multiplier.
///         Designed to be called via eth_call by the dApp / indexer, so the
///         O(epochs) participation scan is free (it is a view, never a tx).
///
/// @dev    A profile is anchored to a name the member presents (by label — the
///         self-verifying preimage of the labelhash/tokenId). Signal gradient:
///           * PROVENANCE (era + rank): only when the name is ATTESTED to the
///             member (registry.boundTo == member). Era 0 = Prepunk is only
///             trusted behind that binding (the LNR "0 is real, not a sentinel"
///             rule) — an unbound name never reads as Prepunk.
///           * CATEGORY: algorithmic from the label; counts for any name the
///             member is associated with (attested or vault-owned).
///           * TENURE + BANKED YEARS: only for a position the member CURRENTLY
///             owns in the vault (guards against stale attestation bindings).
///           * PARTICIPATION + CREDITS: member-level, from the governor and the
///             Citizen ledger.
///         The participation scan is anchored to the member's TRUE first active
///         epoch (found by scanning from 0), so the consistency denominator
///         cannot be gamed by a caller-chosen window.
contract TrustOracle {
    IAttestorRead public immutable attestor;
    IGovernorRead public immutable governor;
    INameVaultRead public immutable nameVault;
    IRenewalRead public immutable renewalPool;
    ICitizenRead public immutable citizen;
    /// @dev Optional proof-of-humanity source; address(0) = humanity signal off.
    IHumanRead public immutable humanAttestor;

    /// @dev Safety cap on the epoch scan (epochs are coarse; hundreds over the
    ///      protocol's life). Prevents a pathological unbounded view loop.
    uint256 public constant MAX_EPOCH_SCAN = 5_000;

    error ZeroArg();
    error NotMembersName(bytes32 labelhash, address member);

    constructor(
        IAttestorRead attestor_,
        IGovernorRead governor_,
        INameVaultRead nameVault_,
        IRenewalRead renewalPool_,
        ICitizenRead citizen_,
        IHumanRead humanAttestor_
    ) {
        if (
            address(attestor_) == address(0) || address(governor_) == address(0)
                || address(nameVault_) == address(0) || address(renewalPool_) == address(0)
                || address(citizen_) == address(0)
        ) revert ZeroArg();
        attestor = attestor_;
        governor = governor_;
        nameVault = nameVault_;
        renewalPool = renewalPool_;
        citizen = citizen_;
        humanAttestor = humanAttestor_; // may be address(0): humanity signal disabled
    }

    /// @notice Assemble a member's live LibTrust inputs anchored to `label`.
    function inputsOf(address member, bytes calldata label)
        public
        view
        returns (LibTrust.TrustInputs memory t)
    {
        bytes32 labelhash = keccak256(label);
        uint256 tokenId = uint256(labelhash);

        bool attested = attestor.boundTo(labelhash) == member;
        bool vaultOwned = _vaultOwned(tokenId, member);
        if (!attested && !vaultOwned) revert NotMembersName(labelhash, member);

        // provenance — only behind an attestation binding (era 0 gated here)
        if (attested) {
            t.provenanceWad = attestor.eraWad(attestor.boundEra(labelhash));
            t.rank = attestor.boundRank(labelhash);
        }

        // category — algorithmic from the label
        t.categoryBits = uint16(LibCategory.categoryBits(label));

        // tenure + banked years — only for a currently-owned vault position
        if (vaultOwned) {
            try nameVault.position(tokenId) returns (INameVaultRead.Position memory p) {
                if (p.wrappedAt != 0 && block.timestamp > p.wrappedAt) {
                    t.tenureSecs = uint64(block.timestamp - p.wrappedAt);
                }
            } catch {}
            t.bankedYears = uint32(renewalPool.yearsBanked(tokenId));
        }

        // participation — member-level, ungameable denominator
        (uint32 active, uint32 sinceJoin) = _participation(member);
        t.epochsActive = active;
        t.epochsSinceJoin = sinceJoin;

        // credits — member-level
        t.credits = citizen.creditsOf(member);

        // proof-of-humanity — optional, sybil-proof
        if (address(humanAttestor) != address(0)) {
            t.verifiedHuman = humanAttestor.isVerifiedHuman(member);
        }
    }

    /// @notice Live reputation (0..10000 bps) for `member` anchored to `label`.
    function reputationOf(address member, bytes calldata label) external view returns (uint256) {
        return LibTrust.reputation(inputsOf(member, label));
    }

    /// @notice Live bounded trust multiplier (1e18..1.25e18).
    function multiplierOf(address member, bytes calldata label) external view returns (uint256) {
        return LibTrust.trustMultiplierWad(inputsOf(member, label));
    }

    /// @notice Full breakdown for transparency / the profile UI.
    function breakdownOf(address member, bytes calldata label)
        external
        view
        returns (
            uint256 provenance,
            uint256 tenure,
            uint256 participation,
            uint256 category,
            uint256 reputation,
            uint256 multiplierWad
        )
    {
        LibTrust.TrustInputs memory t = inputsOf(member, label);
        provenance = LibTrust.provenanceScore(t.provenanceWad, t.rank);
        tenure = LibTrust.tenureScore(t.tenureSecs, t.bankedYears);
        participation = LibTrust.participationScore(t.epochsActive, t.epochsSinceJoin, t.credits);
        category = LibTrust.categoryScore(t.categoryBits);
        reputation = LibTrust.reputation(t);
        multiplierWad = LibTrust.trustMultiplierWad(t);
    }

    // ------------------------------------------------------------- internals
    function _vaultOwned(uint256 tokenId, address member) internal view returns (bool) {
        try nameVault.ownerOf(tokenId) returns (address o) {
            return o == member;
        } catch {
            return false;
        }
    }

    /// @dev Count distinct active epochs and epochs-since-first-activity by
    ///      scanning from epoch 0 (true first activity — ungameable). View-only.
    function _participation(address member)
        internal
        view
        returns (uint32 active, uint32 sinceJoin)
    {
        uint256 cur = governor.currentEpoch();
        uint256 end = cur > MAX_EPOCH_SCAN ? MAX_EPOCH_SCAN : cur;
        uint256 first = type(uint256).max;
        uint256 count;
        for (uint256 e = 0; e < end; ++e) {
            if (governor.activeInEpoch(e, member)) {
                if (first == type(uint256).max) first = e;
                count += 1;
            }
        }
        active = uint32(count);
        sinceJoin = first == type(uint256).max ? 0 : uint32(cur - first);
    }
}
