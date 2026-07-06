// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title  LibCategory — algorithmic category bits for ENS labels
/// @notice Pure, deterministic classification of a raw ENS label into the
///         ALGORITHMIC region (bits 0..15) of the ENSPLUS category bitmap.
///
///         Bitmap regions (per ENSPLUS_ENSV2_MIGRATION_SPEC / category design):
///           bits   0..15   ALGORITHMIC  — computed here, from the label alone
///           bits  16..63   ATTESTED     — Merkle-attested historical facts (LibAttestation)
///           bits  64..255  CURATED      — governance-ratified category slots (registry)
///
/// @dev    SCOPE RULES (deliberate, documented):
///         * Operates on the RAW REGISTERED LABEL bytes (decision D6: the chain
///           keys on labels as registered; ENSIP-15 normalization is client-side only).
///         * ASCII-only semantics: if any byte >= 0x80 the label is outside the
///           algorithmic scope and ALL algorithmic bits are zero. Unicode/emoji
///           categories (Ethmoji etc.) are byte-ambiguous at this layer and are
///           handled as ATTESTED or CURATED bits instead.
///         * Empty labels return 0. Length limits: labels longer than 255 bytes
///           return 0 (registrar practice never produces them; guards the loops).
///         * BIP-39 membership needs the 2048-word list and is an ATTESTED bit,
///           not computed here.
library LibCategory {
    // ------------------------------------------------------------------ bits
    uint256 internal constant BIT_CLUB_999      = 1 << 0; // exactly 3 ASCII digits ("000".."999")
    uint256 internal constant BIT_CLUB_10K      = 1 << 1; // exactly 4 ASCII digits
    uint256 internal constant BIT_CLUB_100K     = 1 << 2; // exactly 5 ASCII digits
    uint256 internal constant BIT_LETTERS_3     = 1 << 3; // exactly 3 lowercase a-z
    uint256 internal constant BIT_PALINDROME    = 1 << 4; // byte palindrome, length >= 3
    uint256 internal constant BIT_REPEATED_CHAR = 1 << 5; // all bytes identical, length >= 2

    uint256 internal constant ALGORITHMIC_MASK = (1 << 16) - 1;

    // ---------------------------------------------------------------- entry
    /// @notice Compute all algorithmic category bits for a raw label.
    /// @param label Raw label bytes exactly as registered (no normalization).
    function categoryBits(bytes memory label) internal pure returns (uint256 bits) {
        uint256 len = label.length;
        if (len == 0 || len > 255) return 0;

        bool allDigits = true;
        bool allLower = true;
        bool allSame = true;
        bool asciiOnly = true;
        bytes1 first = label[0];

        for (uint256 i = 0; i < len; ++i) {
            bytes1 c = label[i];
            if (uint8(c) >= 0x80) { asciiOnly = false; break; }
            if (c < 0x30 || c > 0x39) allDigits = false;
            if (c < 0x61 || c > 0x7a) allLower = false;
            if (c != first) allSame = false;
        }
        if (!asciiOnly) return 0;

        if (allDigits) {
            if (len == 3) bits |= BIT_CLUB_999;
            else if (len == 4) bits |= BIT_CLUB_10K;
            else if (len == 5) bits |= BIT_CLUB_100K;
        }
        if (allLower && len == 3) bits |= BIT_LETTERS_3;
        if (allSame && len >= 2) bits |= BIT_REPEATED_CHAR;
        if (len >= 3 && _isPalindrome(label, len)) bits |= BIT_PALINDROME;
    }

    // -------------------------------------------------------------- helpers
    function _isPalindrome(bytes memory label, uint256 len) private pure returns (bool) {
        uint256 i = 0;
        uint256 j = len - 1;
        while (i < j) {
            if (label[i] != label[j]) return false;
            unchecked { ++i; --j; }
        }
        return true;
    }
}
