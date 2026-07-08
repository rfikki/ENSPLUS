// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {LibAttestation} from "./LibAttestation.sol";

/// @title  LibTrust — L1-native civic reputation (replaces the EFP trust graph)
/// @notice Composes a bounded reputation score from signals ENSPLUS already
///         owns on mainnet — provenance (era + rank), tenure (time wrapped +
///         banked renewal years), participation (consistent voting + credits),
///         and category standing (club membership). No social graph, no Base,
///         no third-party service.
///
/// @dev    SYBIL RESISTANCE BY CONSTRUCTION: every input costs something a
///         freshly-minted wallet cannot fake —
///           * provenance costs HISTORY (you cannot manufacture a 2017 name or
///             a low ordinal rank);
///           * tenure costs TIME (wrapped duration, banked years);
///           * participation costs SUSTAINED EFFORT (distinct epochs voted,
///             credits earned over time);
///           * category is algorithmic and unspoofable.
///         A sybil ring of fresh wallets therefore scores ~0 -> multiplier 1.0x,
///         exactly the property the EFP graph gave (bought followers = 1.0x),
///         now with zero external dependency. This is strictly harder to game
///         than a follow graph, because none of the inputs can be minted on
///         demand — they must be earned or aged into.
///
///         BOUNDED (design D11): reputation in [0, SCALE] maps to a multiplier
///         in [1.0x, 1.25x] — it refines standing, never dominates the
///         quadratic + cap core. All-integer math; independent JS mirror
///         cross-fuzzed (LibWeight methodology). No double-counting: this is an
///         identity/standing signal for the social + airdrop + guild layer;
///         wiring it into governance weight remains a separate, T2-gated,
///         two-key decision (as the EFP score was).
library LibTrust {
    uint256 internal constant SCALE = 10_000; // sub-scores and reputation are basis points
    uint256 internal constant WAD = 1e18;

    // component weights (sum == SCALE)
    uint256 internal constant W_PROVENANCE = 4_000;
    uint256 internal constant W_TENURE = 2_500;
    uint256 internal constant W_PARTICIPATION = 3_000;
    uint256 internal constant W_CATEGORY = 500;

    // reputation -> multiplier bonus (D11: +25% cap)
    uint256 internal constant MAX_BONUS_WAD = 25e16; // 0.25e18

    // provenance sub-score bands
    uint256 internal constant ERA_MIN_WAD = 1e18; // Modern era multiplier
    uint256 internal constant ERA_MAX_WAD = 4e18; // Prepunk era multiplier
    uint256 internal constant ERA_PART_MAX = 7_000;
    uint256 internal constant RANK_PART_MAX = 3_000;

    // tenure sub-score
    uint256 internal constant TENURE_FULL_SECS = 730 days; // 2y wrapped = full
    uint256 internal constant TENURE_PART_MAX = 6_000;
    uint256 internal constant BANKED_PER_YEAR = 400;
    uint256 internal constant BANKED_CAP_YEARS = 10;

    // participation sub-score
    uint256 internal constant CONSISTENCY_MAX = 5_000;
    uint256 internal constant VOLUME_PER_EPOCH = 150;
    uint256 internal constant VOLUME_CAP_EPOCHS = 20;
    uint256 internal constant CREDITS_FULL_WAD = 1_000e18;
    uint256 internal constant CREDITS_PART_MAX = 2_000;

    // category sub-score
    uint256 internal constant CATEGORY_PER_CLUB = 2_500;

    /// @dev A verified unique human (zkPassport, via HumanAttestor) is the apex
    ///      complement to the history signals: it adds a flat bonus toward the
    ///      cap. Sybil-proof — it cannot be minted, only proven once per human.
    uint256 internal constant HUMANITY_BONUS = 2_000;

    struct TrustInputs {
        uint256 provenanceWad; // 0 = no attestation; else era multiplier in [1e18, 4e18]
        uint32 rank;           // 0 = unranked; 1 = best ordinal
        uint64 tenureSecs;     // now - wrappedAt (0 if not wrapped)
        uint32 bankedYears;    // renewal years written into the registrar
        uint32 epochsActive;   // distinct epochs the member revealed a ballot
        uint32 epochsSinceJoin;// epochs elapsed since the member joined
        uint256 credits;       // ParticipationCredits balance (wad)
        uint16 categoryBits;   // LibCategory club bits
        bool verifiedHuman;    // zkPassport proof-of-humanity (HumanAttestor)
    }

    /// @notice Provenance sub-score (0..SCALE): era band + rank tier. The apex
    ///         anti-sybil signal — costs 2017, not tokens.
    function provenanceScore(uint256 provenanceWad, uint32 rank) internal pure returns (uint256) {
        uint256 eraPart;
        if (provenanceWad > ERA_MIN_WAD) {
            uint256 w = provenanceWad > ERA_MAX_WAD ? ERA_MAX_WAD : provenanceWad;
            eraPart = ((w - ERA_MIN_WAD) * ERA_PART_MAX) / (ERA_MAX_WAD - ERA_MIN_WAD);
        }
        uint256 rankPart;
        // Canonical rank tiers come from LibAttestation.rankTier (D5) — a single
        // source of truth, so the score can never drift from the attestation
        // semantics. TOP_100 / TOP_1K / TOP_10K map to descending bonuses;
        // ranks outside the top 10k carry no rank bonus (era still counts).
        // (DECISION D-DERIVATION, resolved: reconciles the two rank-band defs.)
        uint8 tier = LibAttestation.rankTier(rank);
        if (tier == LibAttestation.TIER_TOP_100) rankPart = RANK_PART_MAX;
        else if (tier == LibAttestation.TIER_TOP_1K) rankPart = 2_000;
        else if (tier == LibAttestation.TIER_TOP_10K) rankPart = 1_000;
        else rankPart = 0;
        uint256 s = eraPart + rankPart;
        return s > SCALE ? SCALE : s;
    }

    /// @notice Tenure sub-score (0..SCALE): time wrapped + banked renewal years.
    ///         Costs time, which a fresh wallet does not have.
    function tenureScore(uint64 tenureSecs, uint32 bankedYears) internal pure returns (uint256) {
        uint256 tPart = uint256(tenureSecs) >= TENURE_FULL_SECS
            ? TENURE_PART_MAX
            : (uint256(tenureSecs) * TENURE_PART_MAX) / TENURE_FULL_SECS;
        uint256 b = bankedYears > BANKED_CAP_YEARS ? BANKED_CAP_YEARS : bankedYears;
        uint256 s = tPart + b * BANKED_PER_YEAR;
        return s > SCALE ? SCALE : s;
    }

    /// @notice Participation sub-score (0..SCALE): consistency (share of epochs
    ///         voted) + volume (distinct active epochs) + credits earned. Costs
    ///         sustained effort over time.
    function participationScore(uint32 epochsActive, uint32 epochsSinceJoin, uint256 credits)
        internal
        pure
        returns (uint256)
    {
        uint256 consistency;
        if (epochsSinceJoin != 0) {
            uint256 active = epochsActive > epochsSinceJoin ? epochsSinceJoin : epochsActive;
            consistency = (active * CONSISTENCY_MAX) / epochsSinceJoin;
        }
        uint256 vEpochs = epochsActive > VOLUME_CAP_EPOCHS ? VOLUME_CAP_EPOCHS : epochsActive;
        uint256 volume = vEpochs * VOLUME_PER_EPOCH;
        uint256 cPart = credits >= CREDITS_FULL_WAD
            ? CREDITS_PART_MAX
            : (credits * CREDITS_PART_MAX) / CREDITS_FULL_WAD;
        uint256 s = consistency + volume + cPart;
        return s > SCALE ? SCALE : s;
    }

    /// @notice Category sub-score (0..SCALE): unspoofable algorithmic club bits.
    function categoryScore(uint16 categoryBits) internal pure returns (uint256) {
        uint256 count;
        uint256 bits = categoryBits;
        while (bits != 0) {
            count += bits & 1;
            bits >>= 1;
        }
        uint256 s = count * CATEGORY_PER_CLUB;
        return s > SCALE ? SCALE : s;
    }

    /// @notice Composed reputation (0..SCALE) — the weighted blend plus the
    ///         sybil-proof humanity bonus, capped at SCALE.
    function reputation(TrustInputs memory t) internal pure returns (uint256) {
        uint256 p = provenanceScore(t.provenanceWad, t.rank);
        uint256 te = tenureScore(t.tenureSecs, t.bankedYears);
        uint256 pa = participationScore(t.epochsActive, t.epochsSinceJoin, t.credits);
        uint256 c = categoryScore(t.categoryBits);
        uint256 base = (p * W_PROVENANCE + te * W_TENURE + pa * W_PARTICIPATION + c * W_CATEGORY) / SCALE;
        if (t.verifiedHuman) base += HUMANITY_BONUS;
        return base > SCALE ? SCALE : base;
    }

    /// @notice Bounded trust multiplier in [1e18, 1.25e18] (D11 +25% cap).
    function trustMultiplierWad(TrustInputs memory t) internal pure returns (uint256) {
        return WAD + (reputation(t) * MAX_BONUS_WAD) / SCALE;
    }
}
