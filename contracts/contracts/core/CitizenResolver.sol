// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// @dev Minimal ENS registry read (owner gate for record writes).
interface IENSRegistryRead {
    function owner(bytes32 node) external view returns (address);
}

/// @dev TrustOracle civic reads (revert NotMembersName if not the member's name).
interface ITrustOracleCivic {
    function reputationOf(address member, bytes calldata label) external view returns (uint256);
    function multiplierOf(address member, bytes calldata label) external view returns (uint256);
}

interface IAttestorCivic {
    function boundTo(bytes32 labelhash) external view returns (address);
    function boundEra(bytes32 labelhash) external view returns (uint8);
    function boundRank(bytes32 labelhash) external view returns (uint32);
}

interface IRenewalCivic {
    function yearsBanked(uint256 tokenId) external view returns (uint256);
}

/// @title  CitizenResolver — ENSPLUS civic identity, as an ENS resolver
/// @notice A standards-conformant, READ-ONLY, OWNERLESS ENS resolver that lets
///         any ENS app display a name's ENSPLUS civic identity — era, rank,
///         banked years, live reputation — as ordinary text records, WITHOUT
///         knowing ENSPLUS exists. Members opt in by pointing their ENS name's
///         resolver here and linking the node to their ENSPLUS label. ENSPLUS
///         never replaces ENS resolution; it augments it.
///
/// @dev    OWNERLESS: no owner, no admin, no upgrade, no fees. All dependency
///         addresses are immutable. The only writers are the ENS-registry owner
///         of each node (gated on `registry.owner(node) == msg.sender`).
///
///         recordVersion PATTERN (from gwei-names): user records are keyed by
///         (node, recordVersion, key). link / unlink bump recordVersion, which
///         cheaply clears all prior records without paying to delete storage —
///         so a name sold or an ENSPLUS position unwrapped starts clean.
///
///         RESERVED CIVIC KEYS (`ensplus.*`) are NOT user-settable; they are
///         computed LIVE from the registries and reflect on-chain truth:
///           ensplus.era            Prepunk|Auction|Permanent|Modern (attested)
///           ensplus.rank           ordinal rank (attested)
///           ensplus.banked-years   renewal years written into the registrar
///           ensplus.reputation     live LibTrust reputation (0..10000)
///           ensplus.multiplier     live trust multiplier (wad, 1e18..1.25e18)
///         Civic records only render when the current ENS owner also holds the
///         ENSPLUS attestation for the linked label (the TrustOracle's own
///         membership check gates this) — so selling the ENS name does not
///         carry the seller's civic identity to the buyer.
///
///         ENSIP-10 (wildcard `resolve`) dispatches on-chain. CCIP-read
///         (EIP-3668) is wired for heavy OFF-chain data under the reserved
///         `ensplus.offchain.*` prefix (guild rosters, full graphs), served by
///         an off-chain gateway; the small civic records resolve on-chain.
contract CitizenResolver {
    using Strings for uint256;

    IENSRegistryRead public immutable registry;
    ITrustOracleCivic public immutable oracle;
    IAttestorCivic public immutable attestor;
    IRenewalCivic public immutable renewalPool;

    /// @dev CCIP gateway (mirrors gwei-names' worker gateway pattern).
    string public constant CCIP_GATEWAY = "https://ensplus.domains/ccip/{sender}/{data}.json";

    // node -> the ENSPLUS 2LD label it is linked to (empty = unlinked)
    mapping(bytes32 node => bytes) private _label;
    // recordVersion bump clears user records cheaply
    mapping(bytes32 node => uint64) public recordVersion;
    // user records, keyed by (node, version, ...)
    mapping(bytes32 node => mapping(uint64 => mapping(string => string))) private _text;
    mapping(bytes32 node => mapping(uint64 => mapping(uint256 => bytes))) private _addr;
    mapping(bytes32 node => mapping(uint64 => bytes)) private _contenthash;
    // reverse resolution (EIP-181): a node's primary name string
    mapping(bytes32 node => mapping(uint64 => string)) private _name;

    // ENS interface ids
    bytes4 private constant IID_ERC165 = 0x01ffc9a7;
    bytes4 private constant IID_ADDR = 0x3b3b57de;
    bytes4 private constant IID_ADDR_COIN = 0xf1cb7e06;
    bytes4 private constant IID_TEXT = 0x59d1d43c;
    bytes4 private constant IID_CONTENTHASH = 0xbc1c58d1;
    bytes4 private constant IID_NAME = 0x691f3431; // EIP-181 reverse resolution
    bytes4 private constant IID_RESOLVE = 0x9061b923; // ENSIP-10
    uint256 private constant COIN_ETH = 60;
    /// @dev namehash("eth") — the parent of every .eth 2LD, used to verify that
    ///      a linked label genuinely belongs to the linked node.
    bytes32 private constant ETH_NODE = 0x93cdeb708b7545dc668eb9280176169d1c33cfd8ed6f04690a0bcc88a93fc4ae;

    event Linked(bytes32 indexed node, address indexed owner, bytes label);
    event Unlinked(bytes32 indexed node, address indexed owner);
    event TextChanged(bytes32 indexed node, string key);
    event AddrChanged(bytes32 indexed node, uint256 coinType);
    event ContenthashChanged(bytes32 indexed node);
    event NameChanged(bytes32 indexed node, string name);

    error NotNodeOwner(bytes32 node, address caller);
    error ReservedKey(string key);
    error LabelNodeMismatch(bytes32 node, bytes32 expected);
    error UnsupportedResolverFunction(bytes4 selector);
    error OffchainLookup(address sender, string[] urls, bytes callData, bytes4 callbackFunction, bytes extraData);

    constructor(
        IENSRegistryRead registry_,
        ITrustOracleCivic oracle_,
        IAttestorCivic attestor_,
        IRenewalCivic renewalPool_
    ) {
        require(
            address(registry_) != address(0) && address(oracle_) != address(0)
                && address(attestor_) != address(0) && address(renewalPool_) != address(0),
            "zero dep"
        );
        registry = registry_;
        oracle = oracle_;
        attestor = attestor_;
        renewalPool = renewalPool_;
    }

    modifier onlyNodeOwner(bytes32 node) {
        if (registry.owner(node) != msg.sender) revert NotNodeOwner(node, msg.sender);
        _;
    }

    // --------------------------------------------------------------- linking
    /// @notice Link an ENS node to an ENSPLUS 2LD label. Owner-gated on the ENS
    ///         side; the TrustOracle gates the civic reads on the ENSPLUS side.
    ///         The label must genuinely belong to the node: for a `.eth` 2LD,
    ///         node == keccak256(namehash("eth"), keccak256(label)). Bumps
    ///         recordVersion (fresh record slate).
    function link(bytes32 node, bytes calldata label) external onlyNodeOwner(node) {
        bytes32 expected = keccak256(abi.encodePacked(ETH_NODE, keccak256(label)));
        if (node != expected) revert LabelNodeMismatch(node, expected);
        _label[node] = label;
        recordVersion[node] += 1;
        emit Linked(node, msg.sender, label);
    }

    function unlink(bytes32 node) external onlyNodeOwner(node) {
        delete _label[node];
        recordVersion[node] += 1;
        emit Unlinked(node, msg.sender);
    }

    function labelOf(bytes32 node) external view returns (bytes memory) {
        return _label[node];
    }

    // --------------------------------------------------------- record writes
    function setText(bytes32 node, string calldata key, string calldata value)
        external
        onlyNodeOwner(node)
    {
        if (_isReserved(bytes(key))) revert ReservedKey(key); // ensplus.* is computed, not set
        _text[node][recordVersion[node]][key] = value;
        emit TextChanged(node, key);
    }

    function setAddr(bytes32 node, uint256 coinType, bytes calldata value)
        external
        onlyNodeOwner(node)
    {
        _addr[node][recordVersion[node]][coinType] = value;
        emit AddrChanged(node, coinType);
    }

    function setContenthash(bytes32 node, bytes calldata value) external onlyNodeOwner(node) {
        _contenthash[node][recordVersion[node]] = value;
        emit ContenthashChanged(node);
    }

    /// @notice EIP-181 reverse record. The caller must own `node` — for a
    ///         reverse node `<addr>.addr.reverse`, the ENS reverse registrar
    ///         makes the address itself the owner, so an address sets its own
    ///         primary name here. Enables CitizenResolver to serve as a reverse
    ///         resolver, not only a forward one.
    function setName(bytes32 node, string calldata newName) external onlyNodeOwner(node) {
        _name[node][recordVersion[node]] = newName;
        emit NameChanged(node, newName);
    }

    // ---------------------------------------------------------------- reads
    /// @notice EIP-634 text. Reserved `ensplus.*` keys are computed live.
    function text(bytes32 node, string memory key) public view returns (string memory) {
        if (_isReserved(bytes(key))) return _civic(node, key);
        return _text[node][recordVersion[node]][key];
    }

    /// @notice EIP-137 ETH address. Defaults to the node's current controller.
    function addr(bytes32 node) public view returns (address payable) {
        bytes memory a = _addr[node][recordVersion[node]][COIN_ETH];
        if (a.length == 20) return payable(address(bytes20(a)));
        return payable(registry.owner(node));
    }

    /// @notice ENSIP-9 multichain address.
    function addr(bytes32 node, uint256 coinType) public view returns (bytes memory) {
        bytes memory a = _addr[node][recordVersion[node]][coinType];
        if (a.length > 0) return a;
        if (coinType == COIN_ETH) return abi.encodePacked(registry.owner(node));
        return "";
    }

    /// @notice EIP-1577 contenthash.
    function contenthash(bytes32 node) public view returns (bytes memory) {
        return _contenthash[node][recordVersion[node]];
    }

    /// @notice EIP-181 reverse resolution — the node's primary name.
    function name(bytes32 node) public view returns (string memory) {
        return _name[node][recordVersion[node]];
    }

    function supportsInterface(bytes4 id) external pure returns (bool) {
        return id == IID_ERC165 || id == IID_ADDR || id == IID_ADDR_COIN || id == IID_TEXT
            || id == IID_CONTENTHASH || id == IID_NAME || id == IID_RESOLVE;
    }

    // ---------------------------------------------------- ENSIP-10 + CCIP
    /// @notice ENSIP-10 wildcard resolve. Dispatches the inner call on-chain;
    ///         for `ensplus.offchain.*` text keys it raises EIP-3668
    ///         OffchainLookup to the gateway.
    function resolve(bytes calldata, bytes calldata data) external view returns (bytes memory) {
        bytes4 selector = bytes4(data[:4]);
        if (selector == IID_TEXT) {
            (bytes32 node, string memory key) = abi.decode(data[4:], (bytes32, string));
            if (_isOffchain(bytes(key))) {
                string[] memory urls = new string[](1);
                urls[0] = CCIP_GATEWAY;
                revert OffchainLookup(
                    address(this), urls, abi.encode(node, key), this.ccipCallback.selector, abi.encode(node, key)
                );
            }
            return abi.encode(text(node, key));
        }
        if (selector == IID_ADDR) {
            bytes32 node = abi.decode(data[4:], (bytes32));
            return abi.encode(addr(node));
        }
        if (selector == IID_ADDR_COIN) {
            (bytes32 node, uint256 coinType) = abi.decode(data[4:], (bytes32, uint256));
            return abi.encode(addr(node, coinType));
        }
        if (selector == IID_CONTENTHASH) {
            bytes32 node = abi.decode(data[4:], (bytes32));
            return abi.encode(contenthash(node));
        }
        if (selector == IID_NAME) {
            bytes32 node = abi.decode(data[4:], (bytes32));
            return abi.encode(name(node));
        }
        revert UnsupportedResolverFunction(selector);
    }

    /// @notice EIP-3668 callback. A production gateway signs its response; this
    ///         v1 returns the gateway payload as the resolved value (the signing
    ///         verification is the documented gateway-hardening step).
    function ccipCallback(bytes calldata response, bytes calldata) external pure returns (bytes memory) {
        return response;
    }

    // ------------------------------------------------------------- internals
    /// @dev Compute a reserved civic key live from the registries.
    function _civic(bytes32 node, string memory key) internal view returns (string memory) {
        bytes memory label = _label[node];
        if (label.length == 0) return "";
        address member = registry.owner(node);
        bytes32 labelhash = keccak256(label);
        bytes32 k = keccak256(bytes(key));

        if (k == keccak256("ensplus.era")) {
            if (attestor.boundTo(labelhash) != member) return "";
            return _eraName(attestor.boundEra(labelhash));
        }
        if (k == keccak256("ensplus.rank")) {
            if (attestor.boundTo(labelhash) != member) return "";
            uint32 r = attestor.boundRank(labelhash);
            return r == 0 ? "" : uint256(r).toString();
        }
        if (k == keccak256("ensplus.banked-years")) {
            return renewalPool.yearsBanked(uint256(labelhash)).toString();
        }
        if (k == keccak256("ensplus.reputation")) {
            try oracle.reputationOf(member, label) returns (uint256 rep) {
                return rep.toString();
            } catch {
                return "";
            }
        }
        if (k == keccak256("ensplus.multiplier")) {
            try oracle.multiplierOf(member, label) returns (uint256 m) {
                return m.toString();
            } catch {
                return "";
            }
        }
        return ""; // unknown ensplus.* key
    }

    function _eraName(uint8 era) internal pure returns (string memory) {
        if (era == 0) return "Prepunk";
        if (era == 1) return "Auction";
        if (era == 2) return "Permanent";
        return "Modern";
    }

    function _isReserved(bytes memory key) internal pure returns (bool) {
        return _hasPrefix(key, "ensplus.");
    }

    function _isOffchain(bytes memory key) internal pure returns (bool) {
        return _hasPrefix(key, "ensplus.offchain.");
    }

    function _hasPrefix(bytes memory s, bytes memory prefix) internal pure returns (bool) {
        if (s.length < prefix.length) return false;
        for (uint256 i = 0; i < prefix.length; ++i) {
            if (s[i] != prefix[i]) return false;
        }
        return true;
    }
}
