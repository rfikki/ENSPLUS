// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {LibWeight} from "../libraries/LibWeight.sol";
import {ENSPLUSVault} from "./ENSPLUSVault.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

/// @notice Provenance multiplier source (genesis: attestation-backed Elders
///         registry). Returns WAD; MUST return a value in [1e18, 4e18] for
///         attested accounts and 0 or 1e18 for unknown accounts.
interface IProvenanceSource {
    function provenanceWad(address account) external view returns (uint256);
}

/// @title  InternalGovernor — ENSPLUS internal governance (complete: pass 1+2)
/// @notice Proposal lifecycle with COMMIT-REVEAL ballots, snapshot-anchored
///         quadratic/capped weights, Policy A/B silent-weight registry,
///         epoch participation accounting, and the participation-tier gate.
///
/// @dev    DESIGN DECISIONS ENCODED (traceable to project docs):
///         * COMMIT-REVEAL (G5): ballots are sealed hashes during Commit and
///           opened during Reveal — interim tallies are unknowable, which
///           removes both last-minute vote sniping (the abstain-then-hammer
///           pattern) and verifiable mid-vote bribery (G4). Commitments bind
///           (chainid, governor, proposalId, voter, support, salt): they cannot
///           be replayed across chains, deployments, proposals, or voters.
///         * SNAPSHOT (G3/I9): balances checkpoint at creation-1s; post-snapshot
///           balances carry zero weight for that proposal.
///         * VESTING AT SNAPSHOT: measured snapshot-relative against the CURRENT
///           blended vestingStart; post-snapshot acquisitions can only LOWER
///           weight (the blend moves the start later). Conservative.
///         * CAP (G1/I7): capBps of sqrt(totalSupplyAt(snapshot)) — O(1),
///           snapshot-fixed, a LOWER bound of aggregate weight so it binds
///           early. v1 BURNS the excess above the cap (no re-amplification
///           path); commons redistribution is deferred to a ratified tally
///           module. Documented divergence from the autopilot sketch.
///         * DORMANCY (G7): epoch-based. missedEpochs = epochs fully elapsed
///           since the account's last revealed vote, minus one grace epoch;
///           never-active accounts are NOT penalized (0 missed). Weight for the
///           current proposal is computed BEFORE the reveal updates activity.
///         * EPOCHS & TIER (autopilot §2): fixed-length epochs from deployment.
///           closeEpoch() is a permissionless keeper job; the tier is
///           computeTier(min distinct citizens, min turnout) over the trailing
///           TRAILING_EPOCHS closed epochs — conservative smoothing. Turnout
///           denominator is the vault holderCount AT CLOSE TIME (v1
///           simplification, documented). Participation counts toward epochs
///           only when revealed weight >= minCountWeight (tier-gaming guard
///           until Citizen-anchored counting arrives).
///         * QUORUM: revealed weight (for+against+abstain) >= quorumBps of the
///           proposal's capBase. Below quorum the outcome is QuorumFailed —
///           the GovernorAdapter's mirror translates that to external ABSTAIN
///           (autopilot: silence never empowers anyone).
///         * PARAMETERS: immutable this generation (Ark pattern). No owner,
///           no pause, no upgrade path anywhere in this contract.
contract InternalGovernor {
    // ------------------------------------------------------------- proposal
    enum ProposalKind {
        Override,        // T0: SO/classification override, delegatee direction
        Standard,        // T1: category ratification, module params in charter bounds
        Treasury,        // T2: discretionary treasury lines, charters, adapters
        Constitutional   // T3: amendments, Article X, bloc-mode authorization
    }

    enum ProposalState {
        Pending,
        Commit,
        Reveal,
        Ended
    }

    enum Outcome {
        NotEnded,
        QuorumFailed,
        Succeeded,
        Defeated
    }

    uint8 public constant SUPPORT_AGAINST = 0;
    uint8 public constant SUPPORT_FOR = 1;
    uint8 public constant SUPPORT_ABSTAIN = 2;

    struct Proposal {
        address proposer;
        ProposalKind kind;
        uint48 snapshot;
        uint48 commitStart;
        uint48 revealStart;
        uint48 end;
        bytes32 descriptionHash;
        uint208 capBase; // sqrt(totalSupplyAt(snapshot))
    }

    struct Tally {
        uint256 forWeight;
        uint256 againstWeight;
        uint256 abstainWeight;
        uint32 revealedVoters;
    }

    struct Ballot {
        bytes32 commitment;
        bool revealed;
    }

    // --------------------------------------------------------------- policy
    enum SilentPolicy {
        Unset,                // behaves as AbstainWhenSilent
        ConstitutionDelegate, // Policy A: silent weight follows Standing Orders
        AbstainWhenSilent     // Policy B: silent weight always abstains
    }

    // --------------------------------------------------------------- config
    ENSPLUSVault public immutable vault;
    IProvenanceSource public immutable provenanceSource; // address(0) => neutral

    uint256 public immutable capBps;
    uint256 public immutable quorumBps;
    uint256 public immutable vestingPeriod;
    uint256 public immutable minCountWeight; // participation-counting floor
    uint48 public immutable votingDelay;
    uint48 public immutable commitDuration;
    uint48 public immutable revealDuration;
    uint48 public immutable epochDuration;
    uint48 public immutable genesisTime;

    uint8 public constant TRAILING_EPOCHS = 3;

    uint32[3] public minCitizens;
    uint16[3] public minTurnoutBps;

    // ---------------------------------------------------------------- state
    uint256 public proposalCount;
    mapping(uint256 proposalId => Proposal) internal _proposals;
    mapping(uint256 proposalId => Tally) internal _tallies;
    mapping(uint256 proposalId => mapping(address voter => Ballot)) internal _ballots;

    mapping(address account => SilentPolicy) public silentPolicy;

    /// @dev epoch index + 1 of last counted participation; 0 = never active.
    mapping(address account => uint48) internal _lastActiveEpochPlusOne;

    struct EpochStats {
        uint32 distinctActive;
        uint16 turnoutBps;
        bool closed;
    }
    mapping(uint256 epoch => EpochStats) public epochStats;
    mapping(uint256 epoch => mapping(address account => bool)) public activeInEpoch;
    uint256 public lastClosedEpoch; // index+1 of highest closed epoch; 0 = none

    uint8 public currentTier;

    // ---------------------------------------------------------------- events
    event ProposalCreated(
        uint256 indexed proposalId,
        address indexed proposer,
        ProposalKind kind,
        uint48 snapshot,
        uint48 commitStart,
        uint48 revealStart,
        uint48 end,
        bytes32 descriptionHash
    );
    event VoteCommitted(uint256 indexed proposalId, address indexed voter);
    event VoteRevealed(uint256 indexed proposalId, address indexed voter, uint8 support, uint256 weight);
    event SilentPolicySet(address indexed account, SilentPolicy policy);
    event EpochClosed(uint256 indexed epoch, uint32 distinctActive, uint16 turnoutBps, uint8 newTier);

    // ---------------------------------------------------------------- errors
    error ZeroAddress();
    error TierTooLow(uint8 required, uint8 current);
    error UnknownProposal(uint256 proposalId);
    error BadTierLadder();
    error WrongPhase(ProposalState current, ProposalState required);
    error NoCommitment();
    error AlreadyRevealed();
    error BadReveal();
    error BadSupport(uint8 support);
    error EpochNotOver(uint256 epoch);
    error EpochAlreadyClosed(uint256 epoch);
    error EpochOutOfOrder(uint256 epoch, uint256 expected);

    /// @dev Constructor configuration (struct to keep the ABI decoder within
    ///      stack limits; all values land in immutables/storage once).
    struct Config {
        ENSPLUSVault vault;
        IProvenanceSource provenanceSource; // address(0) = neutral
        uint256 capBps;
        uint256 quorumBps;
        uint256 vestingPeriod;
        uint256 minCountWeight;
        uint48 votingDelay;
        uint48 commitDuration;
        uint48 revealDuration;
        uint48 epochDuration;
        uint32[3] minCitizens;
        uint16[3] minTurnoutBps;
    }

    constructor(Config memory cfg) {
        if (address(cfg.vault) == address(0)) revert ZeroAddress();
        if (cfg.capBps == 0 || cfg.capBps > LibWeight.BPS) {
            revert LibWeight.CapBpsOutOfRange(cfg.capBps);
        }
        if (cfg.quorumBps == 0 || cfg.quorumBps > LibWeight.BPS) {
            revert LibWeight.CapBpsOutOfRange(cfg.quorumBps);
        }
        if (cfg.epochDuration == 0 || cfg.commitDuration == 0 || cfg.revealDuration == 0) {
            revert BadTierLadder();
        }
        if (
            !(cfg.minCitizens[0] < cfg.minCitizens[1] && cfg.minCitizens[1] < cfg.minCitizens[2])
                || !(
                    cfg.minTurnoutBps[0] <= cfg.minTurnoutBps[1]
                        && cfg.minTurnoutBps[1] <= cfg.minTurnoutBps[2]
                )
                || cfg.minTurnoutBps[2] > LibWeight.BPS
        ) revert BadTierLadder();

        vault = cfg.vault;
        provenanceSource = cfg.provenanceSource;
        capBps = cfg.capBps;
        quorumBps = cfg.quorumBps;
        vestingPeriod = cfg.vestingPeriod;
        minCountWeight = cfg.minCountWeight;
        votingDelay = cfg.votingDelay;
        commitDuration = cfg.commitDuration;
        revealDuration = cfg.revealDuration;
        epochDuration = cfg.epochDuration;
        genesisTime = SafeCast.toUint48(block.timestamp);
        minCitizens = cfg.minCitizens;
        minTurnoutBps = cfg.minTurnoutBps;
    }

    // ------------------------------------------------------------ proposals
    function createProposal(ProposalKind kind, bytes32 descriptionHash)
        external
        returns (uint256 proposalId)
    {
        uint8 required = minTierFor(kind);
        if (currentTier < required) revert TierTooLow(required, currentTier);

        uint48 nowTs = SafeCast.toUint48(block.timestamp);
        proposalId = ++proposalCount;

        Proposal storage p = _proposals[proposalId];
        p.proposer = msg.sender;
        p.kind = kind;
        p.descriptionHash = descriptionHash;
        p.snapshot = nowTs - 1;
        p.commitStart = nowTs + votingDelay;
        p.revealStart = p.commitStart + commitDuration;
        p.end = p.revealStart + revealDuration;
        p.capBase = SafeCast.toUint208(LibWeight.quadraticWeight(vault.totalSupplyAt(p.snapshot)));

        emit ProposalCreated(
            proposalId, msg.sender, kind, p.snapshot, p.commitStart, p.revealStart, p.end, descriptionHash
        );
    }

    function proposal(uint256 proposalId) external view returns (Proposal memory p) {
        p = _proposals[proposalId];
        if (p.snapshot == 0) revert UnknownProposal(proposalId);
    }

    function state(uint256 proposalId) public view returns (ProposalState) {
        Proposal storage p = _proposals[proposalId];
        if (p.snapshot == 0) revert UnknownProposal(proposalId);
        uint256 t = block.timestamp;
        if (t < p.commitStart) return ProposalState.Pending;
        if (t < p.revealStart) return ProposalState.Commit;
        if (t < p.end) return ProposalState.Reveal;
        return ProposalState.Ended;
    }

    function minTierFor(ProposalKind kind) public pure returns (uint8) {
        if (kind == ProposalKind.Override) return 0;
        if (kind == ProposalKind.Standard) return 1;
        if (kind == ProposalKind.Treasury) return 2;
        return 3;
    }

    // --------------------------------------------------------- commit-reveal
    /// @notice Commitment digest for (support, salt) by `voter` on `proposalId`.
    ///         Binds chainid and this deployment: no cross-context replay.
    function commitmentOf(uint256 proposalId, address voter, uint8 support, bytes32 salt)
        public
        view
        returns (bytes32)
    {
        return keccak256(abi.encode(block.chainid, address(this), proposalId, voter, support, salt));
    }

    /// @notice Submit (or overwrite) a sealed ballot during the Commit phase.
    ///         The LAST commitment before reveal is the one that counts.
    function commit(uint256 proposalId, bytes32 commitment) external {
        ProposalState s = state(proposalId);
        if (s != ProposalState.Commit) revert WrongPhase(s, ProposalState.Commit);
        _ballots[proposalId][msg.sender].commitment = commitment;
        emit VoteCommitted(proposalId, msg.sender);
    }

    /// @notice Open a sealed ballot during the Reveal phase. Weight is computed
    ///         at reveal (snapshot-anchored) BEFORE participation is recorded,
    ///         so this proposal's dormancy uses pre-reveal activity state.
    function reveal(uint256 proposalId, uint8 support, bytes32 salt) external {
        ProposalState s = state(proposalId);
        if (s != ProposalState.Reveal) revert WrongPhase(s, ProposalState.Reveal);
        if (support > SUPPORT_ABSTAIN) revert BadSupport(support);

        Ballot storage b = _ballots[proposalId][msg.sender];
        if (b.commitment == bytes32(0)) revert NoCommitment();
        if (b.revealed) revert AlreadyRevealed();
        if (b.commitment != commitmentOf(proposalId, msg.sender, support, salt)) revert BadReveal();
        b.revealed = true;

        uint256 w = weightAt(msg.sender, proposalId);

        Tally storage t = _tallies[proposalId];
        if (support == SUPPORT_FOR) t.forWeight += w;
        else if (support == SUPPORT_AGAINST) t.againstWeight += w;
        else t.abstainWeight += w;
        t.revealedVoters += 1;

        if (w >= minCountWeight) _recordParticipation(msg.sender);

        emit VoteRevealed(proposalId, msg.sender, support, w);
    }

    function ballot(uint256 proposalId, address voter) external view returns (Ballot memory) {
        return _ballots[proposalId][voter];
    }

    function tally(uint256 proposalId) external view returns (Tally memory t) {
        if (_proposals[proposalId].snapshot == 0) revert UnknownProposal(proposalId);
        return _tallies[proposalId];
    }

    // ---------------------------------------------------------- finalization
    function quorumReached(uint256 proposalId) public view returns (bool) {
        Proposal storage p = _proposals[proposalId];
        if (p.snapshot == 0) revert UnknownProposal(proposalId);
        Tally storage t = _tallies[proposalId];
        uint256 revealed = t.forWeight + t.againstWeight + t.abstainWeight;
        return revealed >= (uint256(p.capBase) * quorumBps) / LibWeight.BPS;
    }

    /// @notice Outcome after end. QuorumFailed maps to external ABSTAIN in the
    ///         GovernorAdapter; the full tally is exposed for mirror-mode casts.
    function outcome(uint256 proposalId) external view returns (Outcome) {
        if (state(proposalId) != ProposalState.Ended) return Outcome.NotEnded;
        if (!quorumReached(proposalId)) return Outcome.QuorumFailed;
        Tally storage t = _tallies[proposalId];
        return t.forWeight > t.againstWeight ? Outcome.Succeeded : Outcome.Defeated;
    }

    // --------------------------------------------------------------- policy
    function setSilentPolicy(SilentPolicy policy) external {
        silentPolicy[msg.sender] = policy;
        emit SilentPolicySet(msg.sender, policy);
    }

    function effectiveSilentPolicy(address account) external view returns (SilentPolicy) {
        SilentPolicy p = silentPolicy[account];
        return p == SilentPolicy.Unset ? SilentPolicy.AbstainWhenSilent : p;
    }

    // -------------------------------------------------------------- weights
    function rawWeightAt(address account, uint256 proposalId) public view returns (uint256) {
        Proposal storage p = _proposals[proposalId];
        if (p.snapshot == 0) revert UnknownProposal(proposalId);

        uint256 bal = vault.balanceOfAt(account, p.snapshot);
        if (bal == 0) return 0;

        uint256 prov = LibWeight.WAD;
        if (address(provenanceSource) != address(0)) {
            uint256 sourced = provenanceSource.provenanceWad(account);
            if (sourced != 0) prov = sourced;
        }

        uint64 start = vault.vestingStart(account);
        uint256 elapsed = p.snapshot > start ? p.snapshot - start : 0;
        uint256 vest = LibWeight.vestingWad(elapsed, vestingPeriod);

        uint256 dorm = LibWeight.dormancyWad(missedConsecutive(account));

        return LibWeight.composeWeight(bal, prov, vest, dorm);
    }

    function weightAt(address account, uint256 proposalId) public view returns (uint256) {
        Proposal storage p = _proposals[proposalId];
        uint256 raw = rawWeightAt(account, proposalId);
        return LibWeight.cappedWeight(raw, p.capBase, capBps);
    }

    // --------------------------------------------------------------- epochs
    function currentEpoch() public view returns (uint256) {
        return (block.timestamp - genesisTime) / epochDuration;
    }

    function epochOf(uint256 timestamp) public view returns (uint256) {
        return (timestamp - genesisTime) / epochDuration;
    }

    /// @notice Fully elapsed epochs since last counted activity, with one
    ///         grace epoch; never-active accounts are unpenalized.
    function missedConsecutive(address account) public view returns (uint256) {
        uint48 lastPlusOne = _lastActiveEpochPlusOne[account];
        if (lastPlusOne == 0) return 0;
        uint256 last = lastPlusOne - 1;
        uint256 cur = currentEpoch();
        return cur > last + 1 ? cur - last - 1 : 0;
    }

    function _recordParticipation(address account) internal {
        uint256 ep = currentEpoch();
        if (!activeInEpoch[ep][account]) {
            activeInEpoch[ep][account] = true;
            epochStats[ep].distinctActive += 1;
        }
        uint48 epPlusOne = SafeCast.toUint48(ep + 1);
        if (epPlusOne > _lastActiveEpochPlusOne[account]) {
            _lastActiveEpochPlusOne[account] = epPlusOne;
        }
    }

    /// @notice Close an elapsed epoch (permissionless keeper job): freezes its
    ///         turnout, then recomputes the tier from the min stats across the
    ///         trailing TRAILING_EPOCHS closed epochs. Sequential by design.
    function closeEpoch(uint256 epoch) external {
        if (epoch >= currentEpoch()) revert EpochNotOver(epoch);
        if (epochStats[epoch].closed) revert EpochAlreadyClosed(epoch);
        if (epoch != lastClosedEpoch) revert EpochOutOfOrder(epoch, lastClosedEpoch);

        EpochStats storage st = epochStats[epoch];
        uint256 holders = vault.holderCount(); // v1: at close time (documented)
        uint16 turnout = holders == 0
            ? 0
            : SafeCast.toUint16((uint256(st.distinctActive) * LibWeight.BPS) / holders);
        if (turnout > LibWeight.BPS) turnout = uint16(LibWeight.BPS); // holders shrank below actives
        st.turnoutBps = turnout;
        st.closed = true;
        lastClosedEpoch = epoch + 1;

        // trailing-min smoothing across up to TRAILING_EPOCHS closed epochs
        uint32 minC = type(uint32).max;
        uint16 minT = type(uint16).max;
        uint256 span = epoch + 1 < TRAILING_EPOCHS ? epoch + 1 : TRAILING_EPOCHS;
        for (uint256 i = 0; i < span; ++i) {
            EpochStats storage e = epochStats[epoch - i];
            if (e.distinctActive < minC) minC = e.distinctActive;
            if (e.turnoutBps < minT) minT = e.turnoutBps;
        }
        currentTier = computeTier(minC, minT);

        emit EpochClosed(epoch, st.distinctActive, turnout, currentTier);
    }

    // ----------------------------------------------------------------- tier
    function computeTier(uint32 activeCitizens, uint16 turnoutBps) public view returns (uint8) {
        for (uint8 t = 3; t >= 1; --t) {
            if (activeCitizens >= minCitizens[t - 1] && turnoutBps >= minTurnoutBps[t - 1]) {
                return t;
            }
        }
        return 0;
    }
}
