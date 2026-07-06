// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {GovernorExecuted} from "./GovernorExecuted.sol";
import {InternalGovernor, IProvenanceSource} from "./InternalGovernor.sol";
import {LibAttestation} from "../libraries/LibAttestation.sol";

/// @dev Minimal ownership surface of the ENS BaseRegistrar (tokenId = uint256(labelhash)).
interface INameRegistrar {
    function ownerOf(uint256 tokenId) external view returns (address);
}

/// @title  AttestorRegistry — the Registry of Elders (claim-based provenance)
/// @notice Stores attestation ROOTS only (D4: no push ceremony); holders claim
///         their own leaves with Merkle proofs, binding a name's era provenance
///         to the account that currently owns the name. The registry then
///         serves as the InternalGovernor's IProvenanceSource.
///
/// @dev    BINDING RULES (anti-duplication):
///         * A labelhash binds to at most ONE account at a time. Claiming a
///           name that is bound elsewhere REBINDS it: the previous account's
///           era count decrements (its multiplier recomputes), the claimer's
///           increments. Sell the name, lose the provenance — the buyer claims
///           it for themselves. No multiplier duplication path exists.
///         * Claims require CURRENT registrar ownership of the name
///           (ownerOf(uint256(labelhash)) == claimant). Names custodied by the
///           ENSPLUS NameVault claim via the vault position holder in a later
///           slice; v1 covers direct holders.
///         * provenanceWad returns the BEST era multiplier among an account's
///           bound names (era 0 = Prepunk = highest), or 0 for unknown accounts
///           (the governor treats 0 as neutral 1.0x). Era 0 is real data,
///           never a sentinel — presence is proven by the Merkle proof.
///         * Roots are append-only: genesis roots at construction, additions
///           via Treasury-kind (T2) proposals. A root can never be edited.
contract AttestorRegistry is GovernorExecuted, IProvenanceSource {
    bytes32 public constant ACTION_ADD_ROOT = keccak256("ADD_ATTESTATION_ROOT");

    INameRegistrar public immutable registrar;

    /// @dev era code => multiplier WAD; validated to [1e18, 4e18], non-increasing
    ///      with era code (older eras never weaker).
    uint256[4] public eraWad;

    bytes32[] private _roots;

    mapping(bytes32 labelhash => address) public boundTo;
    mapping(bytes32 labelhash => uint8) public boundEra;
    /// @notice Ordinal rank of the currently-bound claim (0 = unranked). Rank
    ///         is per-name (overwritten on rebind); read by the TrustOracle.
    mapping(bytes32 labelhash => uint32) public boundRank;
    mapping(address account => uint32[4]) private _eraCounts;

    event RootAdded(uint256 indexed rootIndex, bytes32 root, uint256 proposalId);
    event NameClaimed(bytes32 indexed labelhash, address indexed account, uint8 era, uint32 rank);
    event NameUnbound(bytes32 indexed labelhash, address indexed previousAccount);

    error ZeroArg();
    error BadEraWad(uint256 index, uint256 wad);
    error UnknownRoot(uint256 rootIndex);
    error NotNameOwner(bytes32 labelhash, address claimant);
    error InvalidProof();
    error AlreadyBoundToClaimant(bytes32 labelhash);

    constructor(
        InternalGovernor governor_,
        INameRegistrar registrar_,
        uint256[4] memory eraWad_,
        bytes32[] memory genesisRoots
    ) GovernorExecuted(governor_) {
        if (address(registrar_) == address(0)) revert ZeroArg();
        for (uint256 i = 0; i < 4; ++i) {
            if (eraWad_[i] < 1e18 || eraWad_[i] > 4e18) revert BadEraWad(i, eraWad_[i]);
            if (i > 0 && eraWad_[i] > eraWad_[i - 1]) revert BadEraWad(i, eraWad_[i]);
        }
        registrar = registrar_;
        eraWad = eraWad_;
        for (uint256 i = 0; i < genesisRoots.length; ++i) {
            if (genesisRoots[i] == bytes32(0)) revert ZeroArg();
            _roots.push(genesisRoots[i]);
            emit RootAdded(i, genesisRoots[i], 0);
        }
    }

    // ----------------------------------------------------------------- roots
    /// @notice Append a new attestation root via a Succeeded Treasury-kind
    ///         proposal binding the exact root. Permissionless execution.
    function addRoot(uint256 proposalId, bytes32 newRoot) external returns (uint256 rootIndex) {
        if (newRoot == bytes32(0)) revert ZeroArg();
        _consumeProposal(
            proposalId,
            InternalGovernor.ProposalKind.Treasury,
            ACTION_ADD_ROOT,
            keccak256(abi.encode(newRoot))
        );
        _roots.push(newRoot);
        rootIndex = _roots.length - 1;
        emit RootAdded(rootIndex, newRoot, proposalId);
    }

    function rootCount() external view returns (uint256) {
        return _roots.length;
    }

    function root(uint256 rootIndex) external view returns (bytes32) {
        if (rootIndex >= _roots.length) revert UnknownRoot(rootIndex);
        return _roots[rootIndex];
    }

    // ----------------------------------------------------------------- claim
    /// @notice Claim (or rebind) a name's attested provenance to the caller.
    ///         Requires current registrar ownership and a valid proof against
    ///         the referenced root.
    function claim(uint256 rootIndex, bytes32[] calldata proof, LibAttestation.Leaf calldata leaf)
        external
    {
        if (rootIndex >= _roots.length) revert UnknownRoot(rootIndex);
        if (registrar.ownerOf(uint256(leaf.labelhash)) != msg.sender) {
            revert NotNameOwner(leaf.labelhash, msg.sender);
        }
        if (!LibAttestation.verify(proof, _roots[rootIndex], leaf)) revert InvalidProof();

        address prev = boundTo[leaf.labelhash];
        if (prev == msg.sender) revert AlreadyBoundToClaimant(leaf.labelhash);
        if (prev != address(0)) {
            _eraCounts[prev][boundEra[leaf.labelhash]] -= 1;
            emit NameUnbound(leaf.labelhash, prev);
        }
        boundTo[leaf.labelhash] = msg.sender;
        boundEra[leaf.labelhash] = leaf.era;
        boundRank[leaf.labelhash] = leaf.ordinalRank;
        _eraCounts[msg.sender][leaf.era] += 1;

        emit NameClaimed(leaf.labelhash, msg.sender, leaf.era, leaf.ordinalRank);
    }

    // ------------------------------------------------------------ provenance
    /// @inheritdoc IProvenanceSource
    /// @dev Best (lowest era code with a bound name) multiplier; 0 = unknown
    ///      (governor resolves to neutral). O(4).
    function provenanceWad(address account) external view returns (uint256) {
        uint32[4] storage counts = _eraCounts[account];
        for (uint256 e = 0; e < 4; ++e) {
            if (counts[e] > 0) return eraWad[e];
        }
        return 0;
    }

    function eraCount(address account, uint8 era) external view returns (uint32) {
        return _eraCounts[account][era];
    }
}
