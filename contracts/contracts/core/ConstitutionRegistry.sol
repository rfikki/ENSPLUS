// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {GovernorExecuted} from "./GovernorExecuted.sol";
import {InternalGovernor} from "./InternalGovernor.sol";

/// @title  ConstitutionRegistry — the constitution as on-chain data
/// @notice Layer 0: the original ENS constitution articles, inscribed verbatim
///         at construction and IMMUTABLE forever — preserved as a historical
///         artifact and the root of module authorization. Layer 1: ENSPLUS
///         amendments, ratified one at a time by Constitutional-tier internal
///         proposals via the execute-by-proposal pattern (no admin, no owner).
///
/// @dev    Article numbering is 1-based and append-only. Layer-0 articles can
///         never be modified, superseded, or repealed by anything in this
///         contract — there is no code path. Amendments may be superseded by
///         later amendments (recorded, never deleted; history is append-only).
contract ConstitutionRegistry is GovernorExecuted {
    bytes32 public constant ACTION_AMEND = keccak256("AMEND");
    bytes32 public constant ACTION_SUPERSEDE = keccak256("SUPERSEDE");

    struct Article {
        string text;
        bool layer0;
        bool inForce;
        uint16 supersededBy; // 0 = not superseded
        uint256 ratifiedByProposal; // 0 = genesis (layer 0)
    }

    Article[] private _articles; // index 0 unused; article ids are 1-based
    uint16 public immutable layer0Count;

    event ArticleInscribed(uint16 indexed articleId, bool layer0, uint256 proposalId);
    event ArticleSuperseded(uint16 indexed articleId, uint16 indexed byArticleId, uint256 proposalId);

    error EmptyLayer0();
    error EmptyArticleText();
    error UnknownArticle(uint16 articleId);
    error CannotSupersedeLayer0(uint16 articleId);
    error AlreadySuperseded(uint16 articleId);

    constructor(InternalGovernor governor_, string[] memory layer0Texts)
        GovernorExecuted(governor_)
    {
        if (layer0Texts.length == 0) revert EmptyLayer0();
        _articles.push(); // burn index 0
        for (uint256 i = 0; i < layer0Texts.length; ++i) {
            if (bytes(layer0Texts[i]).length == 0) revert EmptyArticleText();
            _articles.push(
                Article({
                    text: layer0Texts[i],
                    layer0: true,
                    inForce: true,
                    supersededBy: 0,
                    ratifiedByProposal: 0
                })
            );
            emit ArticleInscribed(uint16(i + 1), true, 0);
        }
        layer0Count = uint16(layer0Texts.length);
    }

    // ------------------------------------------------------------ amendments
    /// @notice Inscribe an amendment authorized by a Succeeded Constitutional
    ///         proposal whose descriptionHash binds this exact text.
    ///         Permissionless execution (keeper job class).
    function ratifyAmendment(uint256 proposalId, string calldata text)
        external
        returns (uint16 articleId)
    {
        if (bytes(text).length == 0) revert EmptyArticleText();
        _consumeProposal(
            proposalId,
            InternalGovernor.ProposalKind.Constitutional,
            ACTION_AMEND,
            keccak256(bytes(text))
        );
        _articles.push(
            Article({
                text: text,
                layer0: false,
                inForce: true,
                supersededBy: 0,
                ratifiedByProposal: proposalId
            })
        );
        articleId = uint16(_articles.length - 1);
        emit ArticleInscribed(articleId, false, proposalId);
    }

    /// @notice Supersede an existing AMENDMENT with a new one, atomically, via
    ///         a Succeeded Constitutional proposal. Layer 0 is untouchable.
    function supersedeAmendment(uint256 proposalId, uint16 oldArticleId, string calldata newText)
        external
        returns (uint16 newArticleId)
    {
        if (bytes(newText).length == 0) revert EmptyArticleText();
        Article storage old = _article(oldArticleId);
        if (old.layer0) revert CannotSupersedeLayer0(oldArticleId);
        if (old.supersededBy != 0) revert AlreadySuperseded(oldArticleId);
        _consumeProposal(
            proposalId,
            InternalGovernor.ProposalKind.Constitutional,
            ACTION_SUPERSEDE,
            keccak256(abi.encode(oldArticleId, keccak256(bytes(newText))))
        );
        _articles.push(
            Article({
                text: newText,
                layer0: false,
                inForce: true,
                supersededBy: 0,
                ratifiedByProposal: proposalId
            })
        );
        newArticleId = uint16(_articles.length - 1);
        old.inForce = false;
        old.supersededBy = newArticleId;
        emit ArticleInscribed(newArticleId, false, proposalId);
        emit ArticleSuperseded(oldArticleId, newArticleId, proposalId);
    }

    // ----------------------------------------------------------------- views
    function articleCount() external view returns (uint256) {
        return _articles.length - 1;
    }

    function article(uint16 articleId) external view returns (Article memory) {
        return _article(articleId);
    }

    function articleText(uint16 articleId) external view returns (string memory) {
        return _article(articleId).text;
    }

    /// @notice Machine check used by the ModuleRegistry: an article authorizes
    ///         modules only while it exists and is in force.
    function articleInForce(uint16 articleId) external view returns (bool) {
        if (articleId == 0 || articleId >= _articles.length) return false;
        return _articles[articleId].inForce;
    }

    function _article(uint16 articleId) internal view returns (Article storage) {
        if (articleId == 0 || articleId >= _articles.length) revert UnknownArticle(articleId);
        return _articles[articleId];
    }
}
