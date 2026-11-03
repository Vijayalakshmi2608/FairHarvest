// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {PriceIndex} from "./PriceIndex.sol";

/// @title PriceOracleAdapter
/// @notice Verifies signed AgriPrice Engine ranges before forwarding them to PriceIndex.
/// @dev The adapter stores no authority to create listings or orders; its output is advisory metadata only.
contract PriceOracleAdapter is AccessControl {
    bytes32 public constant ORACLE_SIGNER_ROLE = keccak256("ORACLE_SIGNER_ROLE");
    uint256 public constant MAX_AGE = 24 hours;

    PriceIndex public immutable priceIndex;
    address public immutable oracleSigner;
    mapping(address => mapping(uint256 => bool)) public usedNonces;

    event PriceRangeAccepted(bytes32 indexed marketKey, address indexed signer, uint256 nonce, uint256 priceLow, uint256 priceHigh, uint256 confidenceBps, uint256 timestamp);

    /// @param admin Administrator for signer roles.
    /// @param oracleSignerAddress Known public address corresponding to the AI service signing key.
    /// @param priceIndexAddress PriceIndex receiving verified commitments.
    constructor(address admin, address oracleSignerAddress, address priceIndexAddress) {
        require(admin != address(0) && oracleSignerAddress != address(0) && priceIndexAddress != address(0), "zero address");
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ORACLE_SIGNER_ROLE, oracleSignerAddress);
        priceIndex = PriceIndex(priceIndexAddress);
        oracleSigner = oracleSignerAddress;
    }

    /// @notice Verifies and forwards a signed AI price range.
    /// @dev The signed digest is domain-separated by adapter address and chain ID.
    function submitPriceRange(
        string calldata cropType,
        string calldata grade,
        string calldata region,
        uint256 priceLow,
        uint256 priceHigh,
        uint256 confidenceBps,
        uint256 timestamp,
        uint256 nonce,
        bytes calldata signature
    ) external {
        require(timestamp <= block.timestamp, "timestamp in future");
        require(block.timestamp - timestamp <= MAX_AGE, "oracle payload expired");
        require(priceLow > 0 && priceHigh >= priceLow, "invalid range");
        require(confidenceBps <= 10_000, "confidence out of range");
        bytes32 digest = _payloadHash(cropType, grade, region, priceLow, priceHigh, confidenceBps, timestamp, nonce);
        address signer = _recover(digest, signature);
        require(hasRole(ORACLE_SIGNER_ROLE, signer), "bad oracle signature");
        require(!usedNonces[signer][nonce], "nonce already used");
        usedNonces[signer][nonce] = true;
        bytes32 dataHash = keccak256(abi.encode(cropType, grade, region, priceLow, priceHigh, confidenceBps, timestamp, nonce));
        priceIndex.recordAICommitment(cropType, grade, region, priceLow, priceHigh, confidenceBps, dataHash, uint64(timestamp), signer);
        emit PriceRangeAccepted(keccak256(abi.encode(cropType, grade, region)), signer, nonce, priceLow, priceHigh, confidenceBps, timestamp);
    }

    /// @notice Returns the latest advisory range for a market.
    function getFairPriceRange(string calldata cropType, string calldata grade, string calldata region)
        external
        view
        returns (uint256 low, uint256 high, uint256 confidence, uint256 lastUpdated)
    {
        PriceIndex.AICommitment memory commitment = priceIndex.getLatestAICommitment(cropType, grade, region);
        return (commitment.priceLow, commitment.priceHigh, commitment.confidenceBps, commitment.timestamp);
    }

    /// @notice Returns the exact digest the AI signer must sign with EIP-191.
    function payloadHash(string calldata cropType, string calldata grade, string calldata region, uint256 priceLow, uint256 priceHigh, uint256 confidenceBps, uint256 timestamp, uint256 nonce) external view returns (bytes32) {
        return _payloadHash(cropType, grade, region, priceLow, priceHigh, confidenceBps, timestamp, nonce);
    }

    function _payloadHash(string calldata cropType, string calldata grade, string calldata region, uint256 priceLow, uint256 priceHigh, uint256 confidenceBps, uint256 timestamp, uint256 nonce) internal view returns (bytes32) {
        return keccak256(abi.encode(address(this), block.chainid, cropType, grade, region, priceLow, priceHigh, confidenceBps, timestamp, nonce));
    }

    function _recover(bytes32 digest, bytes calldata signature) internal pure returns (address) {
        require(signature.length == 65, "invalid signature");
        bytes32 ethHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", digest));
        bytes32 r; bytes32 s; uint8 v;
        assembly { r := calldataload(signature.offset) s := calldataload(add(signature.offset, 32)) v := byte(0, calldataload(add(signature.offset, 64))) }
        return ecrecover(ethHash, v, r, s);
    }
}
