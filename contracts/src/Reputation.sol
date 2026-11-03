// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title Reputation
/// @notice Maintains marketplace trust metrics for participants.
contract Reputation is AccessControl {
    bytes32 public constant ESCROW_ROLE = keccak256("ESCROW_ROLE");

    /// @notice Aggregated reputation data for an address.
    struct Profile { uint256 completedOrders; uint256 disputes; uint256 ratingTotal; uint256 ratingCount; }
    mapping(address => Profile) private _profiles;

    event CompletedOrderRecorded(address indexed participant, uint8 rating);
    event DisputeRecorded(address indexed participant);

    /// @param admin Initial administrator.
    constructor(address admin) {
        require(admin != address(0), "admin is zero");
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    /// @notice Grants an escrow contract write access.
    function setEscrow(address escrow) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(escrow != address(0), "escrow is zero");
        _grantRole(ESCROW_ROLE, escrow);
    }

    /// @notice Records a completed order and optional 1-5 rating.
    function recordCompletedOrder(address participant, uint8 rating) external onlyRole(ESCROW_ROLE) {
        require(participant != address(0), "participant is zero");
        require(rating >= 1 && rating <= 5, "rating out of range");
        Profile storage profile = _profiles[participant];
        profile.completedOrders++;
        profile.ratingTotal += rating;
        profile.ratingCount++;
        emit CompletedOrderRecorded(participant, rating);
    }

    /// @notice Records a dispute against a participant.
    function recordDispute(address participant) external onlyRole(ESCROW_ROLE) {
        _profiles[participant].disputes++;
        emit DisputeRecorded(participant);
    }

    /// @notice Returns completed orders, disputes, and average rating in whole basis points.
    function getProfile(address participant) external view returns (uint256 completedOrders, uint256 disputes, uint256 averageRatingBps) {
        Profile memory profile = _profiles[participant];
        averageRatingBps = profile.ratingCount == 0 ? 0 : (profile.ratingTotal * 10_000) / profile.ratingCount / 5;
        return (profile.completedOrders, profile.disputes, averageRatingBps);
    }

    /// @notice Returns whether an address has completed at least one rated order.
    function hasTrustBadge(address participant) external view returns (bool) { return _profiles[participant].completedOrders > 0; }
}
