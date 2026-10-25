// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice An opaque receipt target. Account permissions belong to the smart account.
/// @dev A commitment is neither a performance proof nor verification of private inputs.
contract AngbaoCommitment {
    error NonZeroValue();
    error EmptyReference();
    error AlreadyCommitted();

    mapping(address account => mapping(bytes32 operationRef => bytes32 commitment)) public commitments;

    event Committed(address indexed account, bytes32 indexed operationRef, bytes32 commitment);

    function commit(bytes32 operationRef, bytes32 commitment) external payable {
        if (msg.value != 0) revert NonZeroValue();
        if (operationRef == bytes32(0) || commitment == bytes32(0)) revert EmptyReference();
        if (commitments[msg.sender][operationRef] != bytes32(0)) revert AlreadyCommitted();
        commitments[msg.sender][operationRef] = commitment;
        emit Committed(msg.sender, operationRef, commitment);
    }
}
