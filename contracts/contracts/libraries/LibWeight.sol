// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title  LibWeight — internal-governance voting weight primitives
/// @notice Pure math for the ENSPLUS InternalGovernor: quadratic weighting,
///         per-identity caps, wrap-time vesting, dormancy decay, and their
///         composition. All multipliers are WAD-scaled (1e18 = 1.0x).
///
/// @dev    UNITS & CONVENTIONS
///         * balance: wrapped ENS in wei (18 decimals).
///         * quadraticWeight = floor(sqrt(balance)) — "sqrt-wei" units. Only
///           RATIOS of weights ever matter to tallies, so the unusual unit is
///           harmless and avoids precision loss from pre-normalization.
///           (1 ENS -> 1e9, 100 ENS -> 1e10: 100x the tokens, 10x the voice.)
///         * All multiplier functions return WAD in [0, ~2e18] and are meant
///           to be composed via composeWeight().
///         * capBps applies to a SNAPSHOT total supplied by the governor
///           (autopilot spec: snapshot at proposal creation, G3). The cap rule
///           is min(w, total*capBps/10000); overflow-to-commons redistribution
///           is governor-level policy built on top of cappedWeight().
///         * Dormancy (autopilot G7): weight halves per DORMANCY_STEP missed
///           consecutive votes, floored at 1/2^DORMANCY_MAX_HALVINGS.
///           Regeneration-on-participation is governor state policy; this
///           library only prices the current miss count.
///         * Provenance multipliers are PARAMETERS (governance-tunable at T1),
///           passed in as WAD — deliberately not constants here.
library LibWeight {
    uint256 internal constant WAD = 1e18;
    uint256 internal constant BPS = 10_000;

    uint256 internal constant DORMANCY_STEP = 3;         // missed votes per halving
    uint256 internal constant DORMANCY_MAX_HALVINGS = 5; // floor = 1/32

    error CapBpsOutOfRange(uint256 capBps);
    error MultiplierOutOfRange(uint256 wad);

    /// @dev sanity ceiling for any single multiplier (4.0x) — a tunable-parameter
    ///      fat-finger guard, not an economic statement.
    uint256 internal constant MULTIPLIER_CEILING = 4e18;

    // -------------------------------------------------------------- quadratic
    /// @notice floor(sqrt(balance)) via OZ Math (Babylonian, floor rounding).
    function quadraticWeight(uint256 balance) internal pure returns (uint256) {
        return Math.sqrt(balance);
    }

    // ------------------------------------------------------------------ cap
    /// @notice Cap a weight at capBps of a snapshot total. total==0 -> 0.
    function cappedWeight(uint256 weight, uint256 snapshotTotal, uint256 capBps)
        internal
        pure
        returns (uint256)
    {
        if (capBps == 0 || capBps > BPS) revert CapBpsOutOfRange(capBps);
        uint256 cap = Math.mulDiv(snapshotTotal, capBps, BPS);
        return weight > cap ? cap : weight;
    }

    // -------------------------------------------------------------- vesting
    /// @notice Linear wrap-time vesting ramp (G3 flash-wrap defense).
    /// @param elapsed  seconds since the position's wrap (or last top-up policy point)
    /// @param period   vesting period in seconds; 0 disables vesting (returns 1e18)
    function vestingWad(uint256 elapsed, uint256 period) internal pure returns (uint256) {
        if (period == 0 || elapsed >= period) return WAD;
        return Math.mulDiv(elapsed, WAD, period);
    }

    // ------------------------------------------------------------- dormancy
    /// @notice Dormancy decay: halve per DORMANCY_STEP consecutive missed votes,
    ///         floored at 1/2^DORMANCY_MAX_HALVINGS (= 1/32).
    function dormancyWad(uint256 missedConsecutive) internal pure returns (uint256) {
        uint256 halvings = missedConsecutive / DORMANCY_STEP;
        if (halvings > DORMANCY_MAX_HALVINGS) halvings = DORMANCY_MAX_HALVINGS;
        return WAD >> halvings;
    }

    // -------------------------------------------------------------- compose
    /// @notice Effective pre-cap weight:
    ///         floor(sqrt(balance)) * prov * vest * dorm   (each WAD).
    /// @dev    Overflow-safe by construction: sqrt(uint256) < 2^128 and each
    ///         multiplier <= MULTIPLIER_CEILING (2^62), so every intermediate
    ///         product < 2^190. Multipliers are range-checked to enforce that
    ///         precondition against mis-set governance parameters.
    function composeWeight(
        uint256 balance,
        uint256 provenanceWad,
        uint256 vestingWad_,
        uint256 dormancyWad_
    ) internal pure returns (uint256 w) {
        _checkMultiplier(provenanceWad);
        _checkMultiplier(vestingWad_);
        _checkMultiplier(dormancyWad_);
        w = Math.sqrt(balance);
        w = Math.mulDiv(w, provenanceWad, WAD);
        w = Math.mulDiv(w, vestingWad_, WAD);
        w = Math.mulDiv(w, dormancyWad_, WAD);
    }

    function _checkMultiplier(uint256 wad) private pure {
        if (wad > MULTIPLIER_CEILING) revert MultiplierOutOfRange(wad);
    }
}
