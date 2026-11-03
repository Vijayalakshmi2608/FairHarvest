// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ListingRegistry} from "./ListingRegistry.sol";
import {Reputation} from "./Reputation.sol";
import {PriceIndex} from "./PriceIndex.sol";

/// @title OrderEscrow
/// @notice Holds QIE Stable Coin until delivery is confirmed or a dispute is resolved.
/// @dev All outgoing transfers use a pull-payment balance to avoid external calls during settlement.
contract OrderEscrow is AccessControl, ReentrancyGuard {
    /// @notice Role allowed to resolve disputed orders.
    bytes32 public constant ARBITER_ROLE = keccak256("ARBITER_ROLE");
    /// @notice The maximum platform fee, expressed in basis points.
    uint256 public constant MAX_PLATFORM_FEE_BPS = 200;

    /// @notice Order lifecycle states.
    enum State { Created, Delivered, Confirmed, Disputed, Refunded }

    /// @notice Escrow record for one listing purchase.
    struct Order {
        uint256 id;
        uint256 listingId;
        address buyer;
        address farmer;
        uint256 quantityKg;
        uint256 pricePerKg;
        uint256 totalAmount;
        State state;
    }

    IERC20 public immutable stablecoin;
    ListingRegistry public immutable registry;
    Reputation public immutable reputation;
    PriceIndex public immutable priceIndex;
    address public platformFeeRecipient;
    uint256 public platformFeeBps;
    uint256 private _nextOrderId = 1;
    mapping(uint256 => Order) public orders;
    mapping(address => uint256) public pendingWithdrawals;

    event OrderCreated(uint256 indexed orderId, uint256 indexed listingId, address indexed buyer, uint256 amount);
    event Delivered(uint256 indexed orderId);
    event Confirmed(uint256 indexed orderId, uint256 farmerAmount, uint256 fee);
    event Disputed(uint256 indexed orderId, address indexed initiator);
    event Refunded(uint256 indexed orderId, uint256 buyerAmount);
    event Withdrawal(address indexed payee, uint256 amount);
    event PlatformFeeUpdated(uint256 feeBps);
    event PlatformFeeRecipientUpdated(address indexed recipient);

    /// @param admin Administrator and initial fee recipient.
    /// @param arbiter Address allowed to resolve disputes.
    /// @param stablecoinAddress QIE Stable Coin ERC-20 address.
    /// @param registryAddress ListingRegistry address.
    /// @param reputationAddress Reputation contract address.
    /// @param priceIndexAddress PriceIndex contract address.
    /// @param initialFeeBps Initial platform fee in basis points, at most 200.
    constructor(
        address admin,
        address arbiter,
        address stablecoinAddress,
        address registryAddress,
        address reputationAddress,
        address priceIndexAddress,
        uint256 initialFeeBps
    ) {
        require(admin != address(0) && arbiter != address(0), "zero role address");
        require(stablecoinAddress != address(0) && registryAddress != address(0), "zero core address");
        require(reputationAddress != address(0) && priceIndexAddress != address(0), "zero index address");
        require(initialFeeBps <= MAX_PLATFORM_FEE_BPS, "fee too high");
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ARBITER_ROLE, arbiter);
        stablecoin = IERC20(stablecoinAddress);
        registry = ListingRegistry(registryAddress);
        reputation = Reputation(reputationAddress);
        priceIndex = PriceIndex(priceIndexAddress);
        platformFeeRecipient = admin;
        platformFeeBps = initialFeeBps;
    }

    /// @notice Updates the platform fee, capped at 2%.
    /// @param newFeeBps New fee in basis points.
    function setPlatformFeeBps(uint256 newFeeBps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newFeeBps <= MAX_PLATFORM_FEE_BPS, "fee too high");
        platformFeeBps = newFeeBps;
        emit PlatformFeeUpdated(newFeeBps);
    }

    /// @notice Updates the address that can withdraw platform fees.
    /// @param recipient New fee recipient.
    function setPlatformFeeRecipient(address recipient) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(recipient != address(0), "recipient is zero");
        platformFeeRecipient = recipient;
        emit PlatformFeeRecipientUpdated(recipient);
    }

    /// @notice Creates an order and transfers its full amount into escrow.
    /// @param listingId Active listing being purchased.
    /// @param quantityKg Quantity purchased.
    /// @param agreedPricePerKg Agreed price per kilogram, not below the listing minimum.
    /// @return orderId Newly created order identifier.
    function createOrder(uint256 listingId, uint256 quantityKg, uint256 agreedPricePerKg)
        external
        nonReentrant
        returns (uint256 orderId)
    {
        ListingRegistry.Listing memory listing = registry.getListing(listingId);
        require(listing.status == ListingRegistry.Status.Active, "listing inactive");
        require(quantityKg > 0 && quantityKg <= listing.quantityKg, "invalid quantity");
        require(agreedPricePerKg >= listing.minPrice, "below minimum price");
        uint256 amount = quantityKg * agreedPricePerKg;
        require(stablecoin.transferFrom(msg.sender, address(this), amount), "payment failed");
        orderId = _nextOrderId++;
        orders[orderId] = Order(orderId, listingId, msg.sender, listing.farmer, quantityKg, agreedPricePerKg, amount, State.Created);
        emit OrderCreated(orderId, listingId, msg.sender, amount);
    }

    /// @notice Marks an order delivered; callable by the farmer.
    /// @param orderId Order being marked delivered.
    function markDelivered(uint256 orderId) external {
        Order storage order = orders[orderId];
        require(order.farmer == msg.sender, "not farmer");
        require(order.state == State.Created, "invalid state");
        order.state = State.Delivered;
        emit Delivered(orderId);
    }

    /// @notice Confirms delivery, credits the farmer, and records the realized sale.
    /// @param orderId Order being confirmed.
    /// @param buyerRating Buyer's 1-5 rating for the farmer.
    function confirmDelivery(uint256 orderId, uint8 buyerRating) external nonReentrant {
        Order storage order = orders[orderId];
        require(order.buyer == msg.sender, "not buyer");
        require(order.state == State.Delivered, "not delivered");
        ListingRegistry.Listing memory listing = registry.getListing(order.listingId);
        order.state = State.Confirmed;
        uint256 fee = (order.totalAmount * platformFeeBps) / 10_000;
        uint256 farmerAmount = order.totalAmount - fee;
        pendingWithdrawals[order.farmer] += farmerAmount;
        pendingWithdrawals[platformFeeRecipient] += fee;
        registry.markSold(order.listingId);
        reputation.recordCompletedOrder(order.farmer, buyerRating);
        priceIndex.recordSale(listing.cropType, listing.grade, listing.region, order.pricePerKg);
        emit Confirmed(orderId, farmerAmount, fee);
    }

    /// @notice Opens a dispute by either order party.
    /// @param orderId Order being disputed.
    function openDispute(uint256 orderId) external {
        Order storage order = orders[orderId];
        require(msg.sender == order.buyer || msg.sender == order.farmer, "not party");
        require(order.state == State.Created || order.state == State.Delivered, "cannot dispute");
        order.state = State.Disputed;
        reputation.recordDispute(msg.sender);
        emit Disputed(orderId, msg.sender);
    }

    /// @notice Resolves a dispute in favor of the farmer or buyer.
    /// @param orderId Disputed order.
    /// @param favorFarmer Whether the escrow should be paid to the farmer.
    function resolveDispute(uint256 orderId, bool favorFarmer) external onlyRole(ARBITER_ROLE) nonReentrant {
        Order storage order = orders[orderId];
        require(order.state == State.Disputed, "not disputed");
        if (favorFarmer) {
            order.state = State.Confirmed;
            pendingWithdrawals[order.farmer] += order.totalAmount;
            registry.markSold(order.listingId);
            emit Confirmed(orderId, order.totalAmount, 0);
        } else {
            order.state = State.Refunded;
            pendingWithdrawals[order.buyer] += order.totalAmount;
            emit Refunded(orderId, order.totalAmount);
        }
    }

    /// @notice Withdraws the caller's credited funds.
    function withdraw() external nonReentrant {
        uint256 amount = pendingWithdrawals[msg.sender];
        require(amount > 0, "nothing to withdraw");
        pendingWithdrawals[msg.sender] = 0;
        require(stablecoin.transfer(msg.sender, amount), "withdrawal failed");
        emit Withdrawal(msg.sender, amount);
    }
}
