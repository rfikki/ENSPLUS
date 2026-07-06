// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {GovernorExecuted} from "./GovernorExecuted.sol";
import {InternalGovernor} from "./InternalGovernor.sol";
import {ConstitutionRegistry} from "./ConstitutionRegistry.sol";
import {IENSPLUSModule} from "../interfaces/IENSPLUSModule.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/// @title  ModuleRegistry — features cannot exist outside the constitution
/// @notice The on-chain half of the manifest spec's machine checks (§5).
///         A module activates ONLY if its manifest core passes every check:
///         constitutional citations in force, code hash matched, ERC-165
///         surface verified, permissions within the closed taxonomy with the
///         ratifying proposal's kind meeting the permission-derived floor, and
///         the canonical forfeitures text acknowledged byte-exactly.
///         There is NO override path — a supermajority cannot skip a check.
///
/// @dev    Registry is append-only: versions are monotonic per moduleId and
///         history is never rewritten. Retirement flips status, never deletes.
///         GENESIS: the constructor may register an initial bundle (the
///         genesis constitution's en-bloc ratification) through the SAME
///         machine checks minus the proposal requirement, flagged genesis=true.
contract ModuleRegistry is GovernorExecuted {
    // --------------------------------------------------- permission taxonomy
    uint8 public constant P_READ = 1 << 0;
    uint8 public constant P_CREDIT = 1 << 1;
    uint8 public constant P_REVENUE = 1 << 2;
    uint8 public constant P_EXEC = 1 << 3;
    uint8 public constant P_TREASURY = 1 << 4;
    uint8 public constant P_ROLE = 1 << 5;
    uint8 public constant P_EXT = 1 << 6;
    uint8 public constant P_ALL = 0x7f;

    /// @notice Canonical forfeitures text (manifest spec §4.2). Every manifest
    ///         must acknowledge this hash byte-exactly.
    string public constant FORFEITURES_V1 =
        "ENSPLUS-FORFEITURES-V1: no access to vaulted principal outside holder-initiated flows; "
        "no mutation of covenants, splitter percentages, attestation roots, or the constitution; "
        "no role grants to third parties on member names; no pause, freeze, or gating of unwrap/exit; "
        "no external calls outside a named adapter; no interaction with positions mid-migration.";
    bytes32 public immutable FORFEITURES_HASH;

    bytes32 public constant ACTION_REGISTER = keccak256("REGISTER_MODULE");
    bytes32 public constant ACTION_RETIRE = keccak256("RETIRE_MODULE");

    enum Status {
        None,
        Active,
        Retired
    }

    struct ManifestCore {
        string moduleId;
        address implementation;
        uint8 permissions;
        uint16[] articleIds;
        bytes32 forfeituresHash; // must equal FORFEITURES_HASH
        bytes32 fullManifestHash; // hash of the complete off-chain manifest document
    }

    struct ModuleVersion {
        address implementation;
        bytes32 codeHash;
        uint8 permissions;
        uint16[] articleIds;
        bytes32 fullManifestHash;
        Status status;
        bool genesis;
        uint256 ratifiedByProposal; // 0 for genesis
    }

    ConstitutionRegistry public immutable constitution;

    mapping(bytes32 moduleKey => uint16) public latestVersion;
    mapping(bytes32 moduleKey => mapping(uint16 version => ModuleVersion)) private _versions;

    /// @dev reverse lookup: implementation address -> its charter coordinates,
    ///      enabling RUNTIME permission checks by consumer contracts (e.g. the
    ///      Citizen ledger verifying P_CREDIT before minting credits).
    struct ImplRef {
        bytes32 moduleKey;
        uint16 version;
    }

    mapping(address implementation => ImplRef) public implRef;

    event ModuleRegistered(
        bytes32 indexed moduleKey,
        uint16 version,
        address implementation,
        uint8 permissions,
        bool genesis,
        uint256 proposalId
    );
    event ModuleIdBound(bytes32 indexed moduleKey, string moduleId);
    event ModuleRetired(bytes32 indexed moduleKey, uint16 version, uint256 proposalId);

    error ZeroConstitution();
    error EmptyModuleId();
    error ZeroImplementation();
    error NoPermissions();
    error UnknownPermissionBits(uint8 permissions);
    error NoCitations();
    error ArticleNotInForce(uint16 articleId);
    error ForfeituresNotAcknowledged(bytes32 expected, bytes32 actual);
    error CodeHashMismatch(bytes32 declared, bytes32 actual);
    error InterfaceCheckFailed(address implementation, bytes4 interfaceId);
    error ModuleIdMismatch(string declared, string reported);
    error NotActive(bytes32 moduleKey, uint16 version);

    constructor(
        InternalGovernor governor_,
        ConstitutionRegistry constitution_,
        ManifestCore[] memory genesisManifests
    ) GovernorExecuted(governor_) {
        if (address(constitution_) == address(0)) revert ZeroConstitution();
        constitution = constitution_;
        FORFEITURES_HASH = keccak256(bytes(FORFEITURES_V1));
        for (uint256 i = 0; i < genesisManifests.length; ++i) {
            _register(genesisManifests[i], true, 0);
        }
    }

    // ---------------------------------------------------------- registration
    /// @notice Register a manifest ratified by a Succeeded internal proposal of
    ///         the permission-derived kind. Permissionless execution.
    function registerModule(uint256 proposalId, ManifestCore calldata m)
        external
        returns (uint16 version)
    {
        _consumeProposal(proposalId, requiredKind(m.permissions), ACTION_REGISTER, _payloadHash(m));
        return _register(m, false, proposalId);
    }

    /// @notice Retire a module version via a Succeeded proposal of the same
    ///         kind floor its permissions required. Append-only: never deletes.
    function retireModule(uint256 proposalId, string calldata moduleId, uint16 version) external {
        bytes32 key = moduleKey(moduleId);
        ModuleVersion storage v = _versions[key][version];
        if (v.status != Status.Active) revert NotActive(key, version);
        _consumeProposal(
            proposalId,
            requiredKind(v.permissions),
            ACTION_RETIRE,
            keccak256(abi.encode(moduleId, version))
        );
        v.status = Status.Retired;
        emit ModuleRetired(key, version, proposalId);
    }

    // -------------------------------------------------------- machine checks
    function _register(ManifestCore memory m, bool genesis, uint256 proposalId)
        internal
        returns (uint16 version)
    {
        // check 1: shape
        if (bytes(m.moduleId).length == 0) revert EmptyModuleId();
        if (m.implementation == address(0)) revert ZeroImplementation();
        if (m.permissions == 0) revert NoPermissions();
        if (m.permissions & ~P_ALL != 0) revert UnknownPermissionBits(m.permissions);
        if (m.articleIds.length == 0) revert NoCitations();

        // check 2: every citation exists and is in force
        for (uint256 i = 0; i < m.articleIds.length; ++i) {
            if (!constitution.articleInForce(m.articleIds[i])) {
                revert ArticleNotInForce(m.articleIds[i]);
            }
        }

        // check 3: forfeitures acknowledged byte-exactly
        if (m.forfeituresHash != FORFEITURES_HASH) {
            revert ForfeituresNotAcknowledged(FORFEITURES_HASH, m.forfeituresHash);
        }

        // check 4: live bytecode present (EXTCODEHASH recorded as the pinned hash)
        bytes32 actualCodeHash = m.implementation.codehash;
        if (actualCodeHash == bytes32(0) || actualCodeHash == keccak256("")) {
            revert CodeHashMismatch(bytes32(0), actualCodeHash);
        }

        // check 5: ERC-165 surface — both ids must answer true
        if (!IERC165(m.implementation).supportsInterface(type(IERC165).interfaceId)) {
            revert InterfaceCheckFailed(m.implementation, type(IERC165).interfaceId);
        }
        if (!IERC165(m.implementation).supportsInterface(type(IENSPLUSModule).interfaceId)) {
            revert InterfaceCheckFailed(m.implementation, type(IENSPLUSModule).interfaceId);
        }

        // check 6: the module reports the same moduleId it is chartered under
        string memory reported = IENSPLUSModule(m.implementation).moduleId();
        if (keccak256(bytes(reported)) != keccak256(bytes(m.moduleId))) {
            revert ModuleIdMismatch(m.moduleId, reported);
        }

        // append-only version assignment
        bytes32 key = moduleKey(m.moduleId);
        version = ++latestVersion[key];
        ModuleVersion storage v = _versions[key][version];
        v.implementation = m.implementation;
        v.codeHash = actualCodeHash;
        v.permissions = m.permissions;
        v.articleIds = m.articleIds;
        v.fullManifestHash = m.fullManifestHash;
        v.status = Status.Active;
        v.genesis = genesis;
        v.ratifiedByProposal = proposalId;
        implRef[m.implementation] = ImplRef({moduleKey: key, version: version});

        if (version == 1) emit ModuleIdBound(key, m.moduleId);
        emit ModuleRegistered(key, version, m.implementation, m.permissions, genesis, proposalId);
    }

    // ----------------------------------------------------------------- views
    function moduleKey(string memory moduleId) public pure returns (bytes32) {
        return keccak256(bytes(moduleId));
    }

    /// @notice Ratification floor derived from the permission set (spec §3):
    ///         TREASURY/ROLE/EXT require a Treasury-kind (T2) proposal;
    ///         everything else a Standard-kind (T1) proposal.
    function requiredKind(uint8 permissions) public pure returns (InternalGovernor.ProposalKind) {
        if (permissions & (P_TREASURY | P_ROLE | P_EXT) != 0) {
            return InternalGovernor.ProposalKind.Treasury;
        }
        return InternalGovernor.ProposalKind.Standard;
    }

    function moduleVersion(string calldata moduleId, uint16 version)
        external
        view
        returns (ModuleVersion memory)
    {
        return _versions[moduleKey(moduleId)][version];
    }

    function isActive(string calldata moduleId, uint16 version) external view returns (bool) {
        return _versions[moduleKey(moduleId)][version].status == Status.Active;
    }

    /// @notice Runtime charter check: is `implementation` an ACTIVE module
    ///         version holding `permBit`? Consumer contracts gate privileged
    ///         surfaces on this (the manifest's permissions, enforced in use).
    function hasActivePermission(address implementation, uint8 permBit) external view returns (bool) {
        ImplRef memory r = implRef[implementation];
        if (r.moduleKey == bytes32(0)) return false;
        ModuleVersion storage v = _versions[r.moduleKey][r.version];
        return v.status == Status.Active && (v.permissions & permBit) != 0;
    }

    function _payloadHash(ManifestCore calldata m) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                m.moduleId,
                m.implementation,
                m.permissions,
                m.articleIds,
                m.forfeituresHash,
                m.fullManifestHash
            )
        );
    }

    /// @notice Helper for proposers: the payload hash a registration proposal
    ///         must bind via expectedDescriptionHash(ACTION_REGISTER, ...).
    function registrationPayloadHash(ManifestCore calldata m) external pure returns (bytes32) {
        return _payloadHash(m);
    }
}
