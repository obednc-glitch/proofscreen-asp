// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

/// @title ProofRegistry
/// @notice Anchors hash-commitments of off-chain compliance screening reports
///         for the ProofScreen Agent Service Provider (ASP).
/// @dev Stores ONLY the hash + metadata — never raw verdict data or PII.
contract ProofRegistry {
    struct ProofRecord {
        address submitter;
        uint64 timestamp;
        bool exists;
    }

    mapping(bytes32 => ProofRecord) private records;

    event ProofAnchored(bytes32 indexed proofHash, address indexed submitter, uint64 timestamp);

    function anchorProof(bytes32 proofHash) external {
        require(!records[proofHash].exists, "ProofRegistry: already anchored");

        records[proofHash] = ProofRecord({
            submitter: msg.sender,
            timestamp: uint64(block.timestamp),
            exists: true
        });

        emit ProofAnchored(proofHash, msg.sender, uint64(block.timestamp));
    }

    function verifyProof(bytes32 proofHash)
        external
        view
        returns (bool anchored, address submitter, uint64 timestamp)
    {
        ProofRecord memory record = records[proofHash];
        return (record.exists, record.submitter, record.timestamp);
    }
}
