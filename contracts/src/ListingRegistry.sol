// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

interface IPriceIndexView {
    function getMedianPrice(string calldata cropType, string calldata grade, string calldata region) external view returns (uint256);
}

/// @title ListingRegistry
/// @notice Stores farmer listings and applies a transparent price sanity bound.
/// @dev AI suggestions are never used directly. The bound uses only the realized-sale median when available.
contract ListingRegistry is AccessControl {
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    uint256 public constant MIN_PRICE_MULTIPLIER = 3;
    uint256 public constant MAX_PRICE_MULTIPLIER = 3;
    uint256 public constant PRICE_MULTIPLIER_DENOMINATOR = 10;

    enum Status { Active, Sold, Cancelled }

    struct Listing {
        uint256 id;
        address farmer;
        string cropType;
        string grade;
        uint256 quantityKg;
        uint64 harvestDate;
        string region;
        uint256 minPrice;
        string ipfsMetadataHash;
        Status status;
    }

    uint256 private _nextListingId = 1;
    address public orderEscrow;
    address public priceIndex;
    mapping(uint256 => Listing) private _listings;

    event ListingCreated(uint256 indexed listingId, address indexed farmer, string cropType, uint256 quantityKg, uint256 minPrice);
    event ListingUpdated(uint256 indexed listingId, uint256 quantityKg, uint256 minPrice);
    event ListingCancelled(uint256 indexed listingId, address indexed farmer);
    event ListingSold(uint256 indexed listingId, address indexed farmer);
    event OrderEscrowUpdated(address indexed previousEscrow, address indexed newEscrow);
    event PriceIndexUpdated(address indexed previousIndex, address indexed newIndex);

    /// @param admin Initial administrator allowed to configure integrations.
    constructor(address admin) {
        require(admin != address(0), "admin is zero");
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(OPERATOR_ROLE, admin);
    }

    /// @notice Sets the contract authorized to mark listings sold.
    function setOrderEscrow(address newEscrow) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newEscrow != address(0), "escrow is zero");
        address previous = orderEscrow;
        orderEscrow = newEscrow;
        _grantRole(OPERATOR_ROLE, newEscrow);
        emit OrderEscrowUpdated(previous, newEscrow);
    }

    /// @notice Sets the realized-sale index used for the sane listing bound.
    function setPriceIndex(address newPriceIndex) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newPriceIndex != address(0), "index is zero");
        address previous = priceIndex;
        priceIndex = newPriceIndex;
        emit PriceIndexUpdated(previous, newPriceIndex);
    }

    /// @notice Creates an active listing owned by the caller.
    function createListing(
        string calldata cropType,
        string calldata grade,
        uint256 quantityKg,
        uint64 harvestDate,
        string calldata region,
        uint256 minPrice,
        string calldata ipfsMetadataHash
    ) external returns (uint256 listingId) {
        _validateFields(cropType, grade, region, quantityKg, minPrice);
        listingId = _nextListingId++;
        _listings[listingId] = Listing(listingId, msg.sender, cropType, grade, quantityKg, harvestDate, region, minPrice, ipfsMetadataHash, Status.Active);
        emit ListingCreated(listingId, msg.sender, cropType, quantityKg, minPrice);
    }

    /// @notice Updates an active listing owned by the caller.
    function updateListing(
        uint256 listingId,
        string calldata cropType,
        string calldata grade,
        uint256 quantityKg,
        uint64 harvestDate,
        string calldata region,
        uint256 minPrice,
        string calldata ipfsMetadataHash
    ) external {
        Listing storage listing = _listings[listingId];
        require(listing.farmer == msg.sender, "not listing owner");
        require(listing.status == Status.Active, "listing not active");
        _validateFields(cropType, grade, region, quantityKg, minPrice);
        listing.cropType = cropType;
        listing.grade = grade;
        listing.quantityKg = quantityKg;
        listing.harvestDate = harvestDate;
        listing.region = region;
        listing.minPrice = minPrice;
        listing.ipfsMetadataHash = ipfsMetadataHash;
        emit ListingUpdated(listingId, quantityKg, minPrice);
    }

    /// @notice Cancels an active listing before it is sold.
    function cancelListing(uint256 listingId) external {
        Listing storage listing = _listings[listingId];
        require(listing.farmer == msg.sender, "not listing owner");
        require(listing.status == Status.Active, "listing not active");
        listing.status = Status.Cancelled;
        emit ListingCancelled(listingId, msg.sender);
    }

    /// @notice Marks a listing sold after a confirmed order.
    function markSold(uint256 listingId) external onlyRole(OPERATOR_ROLE) {
        Listing storage listing = _listings[listingId];
        require(listing.status == Status.Active, "listing not active");
        listing.status = Status.Sold;
        emit ListingSold(listingId, listing.farmer);
    }

    /// @notice Returns a complete listing record.
    function getListing(uint256 listingId) external view returns (Listing memory) {
        require(_listings[listingId].farmer != address(0), "listing not found");
        return _listings[listingId];
    }

    /// @notice Returns the next identifier that will be assigned.
    function nextListingId() external view returns (uint256) { return _nextListingId; }

    function _validateFields(string calldata cropType, string calldata grade, string calldata region, uint256 quantityKg, uint256 minPrice) internal view {
        require(bytes(cropType).length > 0 && bytes(region).length > 0, "missing listing fields");
        require(quantityKg > 0 && minPrice > 0, "invalid quantity or price");
        _enforceSanePrice(cropType, grade, region, minPrice);
    }

    function _enforceSanePrice(string calldata cropType, string calldata grade, string calldata region, uint256 price) internal view {
        if (priceIndex == address(0)) return;
        try IPriceIndexView(priceIndex).getMedianPrice(cropType, grade, region) returns (uint256 median) {
            if (median > 0) {
                require(price * PRICE_MULTIPLIER_DENOMINATOR >= median * MIN_PRICE_MULTIPLIER, "price below 0.3x index");
                require(price <= median * MAX_PRICE_MULTIPLIER, "price above 3x index");
            }
        } catch {
            // No realized sales exist yet; the first farmer listing bootstraps the market.
        }
    }
}
