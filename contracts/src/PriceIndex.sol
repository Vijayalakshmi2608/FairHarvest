// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title PriceIndex
/// @notice Stores realized sale prices and signed AI price-range commitments.
contract PriceIndex is AccessControl {
    bytes32 public constant ESCROW_ROLE = keccak256("ESCROW_ROLE");
    bytes32 public constant ORACLE_SIGNER_ROLE = keccak256("ORACLE_SIGNER_ROLE");
    bytes32 public constant ADAPTER_ROLE = keccak256("ADAPTER_ROLE");

    struct Sale { string cropType; string grade; string region; uint256 pricePerKg; uint64 timestamp; }
    struct AICommitment { uint256 priceLow; uint256 priceHigh; uint256 confidenceBps; bytes32 dataHash; uint64 timestamp; address signer; }

    Sale[] private _sales;
    mapping(bytes32 => AICommitment) private _latestCommitment;

    event SaleRecorded(uint256 indexed saleId, bytes32 indexed marketKey, uint256 pricePerKg);
    event AICommitmentAccepted(bytes32 indexed marketKey, uint256 priceLow, uint256 priceHigh, uint256 confidenceBps, bytes32 dataHash, uint64 timestamp, address indexed signer);

    /// @param admin Administrator for roles.
    /// @param oracleSigner Legacy direct-submission signer.
    constructor(address admin, address oracleSigner) {
        require(admin != address(0) && oracleSigner != address(0), "zero address");
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ORACLE_SIGNER_ROLE, oracleSigner);
    }

    /// @notice Grants an escrow contract permission to append completed sales.
    function setEscrow(address escrow) external onlyRole(DEFAULT_ADMIN_ROLE) { require(escrow != address(0), "escrow is zero"); _grantRole(ESCROW_ROLE, escrow); }

    /// @notice Grants the adapter permission to append verified AI commitments.
    function setAdapter(address adapter) external onlyRole(DEFAULT_ADMIN_ROLE) { require(adapter != address(0), "adapter is zero"); _grantRole(ADAPTER_ROLE, adapter); }

    /// @notice Records a completed sale for a market key.
    function recordSale(string calldata cropType, string calldata grade, string calldata region, uint256 pricePerKg) external onlyRole(ESCROW_ROLE) {
        require(pricePerKg > 0, "price is zero");
        _sales.push(Sale(cropType, grade, region, pricePerKg, uint64(block.timestamp)));
        emit SaleRecorded(_sales.length - 1, _marketKey(cropType, grade, region), pricePerKg);
    }

    /// @notice Stores a commitment after an adapter has verified its signature, freshness, and nonce.
    function recordAICommitment(
        string calldata cropType,
        string calldata grade,
        string calldata region,
        uint256 priceLow,
        uint256 priceHigh,
        uint256 confidenceBps,
        bytes32 dataHash,
        uint64 timestamp,
        address signer
    ) external onlyRole(ADAPTER_ROLE) {
        require(priceLow > 0 && priceHigh >= priceLow, "invalid range");
        require(confidenceBps <= 10_000, "confidence out of range");
        bytes32 key = _marketKey(cropType, grade, region);
        _latestCommitment[key] = AICommitment(priceLow, priceHigh, confidenceBps, dataHash, timestamp, signer);
        emit AICommitmentAccepted(key, priceLow, priceHigh, confidenceBps, dataHash, timestamp, signer);
    }

    /// @notice Legacy direct signed commitment path retained for migration compatibility.
    function submitAICommitment(
        string calldata cropType, string calldata grade, string calldata region,
        uint256 priceLow, uint256 priceHigh, uint256 confidenceBps, bytes32 dataHash, bytes calldata signature
    ) external {
        require(priceLow > 0 && priceHigh >= priceLow, "invalid range");
        require(confidenceBps <= 10_000, "confidence out of range");
        bytes32 digest = keccak256(abi.encode(address(this), block.chainid, cropType, grade, region, priceLow, priceHigh, confidenceBps, dataHash));
        address signer = _recover(digest, signature);
        require(hasRole(ORACLE_SIGNER_ROLE, signer), "unauthorized signer");
        _latestCommitment[_marketKey(cropType, grade, region)] = AICommitment(priceLow, priceHigh, confidenceBps, dataHash, uint64(block.timestamp), signer);
        emit AICommitmentAccepted(_marketKey(cropType, grade, region), priceLow, priceHigh, confidenceBps, dataHash, uint64(block.timestamp), signer);
    }

    /// @notice Returns the median realized price per kilogram for a market.
    function getMedianPrice(string calldata cropType, string calldata grade, string calldata region) external view returns (uint256) {
        uint256 count;
        for (uint256 i; i < _sales.length; i++) if (_matches(_sales[i], cropType, grade, region)) count++;
        require(count > 0, "no sales");
        uint256[] memory prices = new uint256[](count);
        uint256 cursor;
        for (uint256 i; i < _sales.length; i++) if (_matches(_sales[i], cropType, grade, region)) prices[cursor++] = _sales[i].pricePerKg;
        for (uint256 i = 1; i < prices.length; i++) { uint256 value = prices[i]; uint256 j = i; while (j > 0 && prices[j - 1] > value) { prices[j] = prices[j - 1]; j--; } prices[j] = value; }
        return prices.length % 2 == 1 ? prices[prices.length / 2] : (prices[prices.length / 2 - 1] + prices[prices.length / 2]) / 2;
    }

    /// @notice Returns the latest AI commitment for a market.
    function getLatestAICommitment(string calldata cropType, string calldata grade, string calldata region) external view returns (AICommitment memory) { return _latestCommitment[_marketKey(cropType, grade, region)]; }
    /// @notice Returns the number of recorded sales.
    function salesCount() external view returns (uint256) { return _sales.length; }

    function _marketKey(string memory cropType, string memory grade, string memory region) internal pure returns (bytes32) { return keccak256(abi.encode(cropType, grade, region)); }
    function _matches(Sale memory sale, string calldata cropType, string calldata grade, string calldata region) internal pure returns (bool) { return keccak256(bytes(sale.cropType)) == keccak256(bytes(cropType)) && keccak256(bytes(sale.grade)) == keccak256(bytes(grade)) && keccak256(bytes(sale.region)) == keccak256(bytes(region)); }
    function _recover(bytes32 digest, bytes calldata signature) internal pure returns (address) { bytes32 ethHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", digest)); require(signature.length == 65, "invalid signature"); bytes32 r; bytes32 s; uint8 v; assembly { r := calldataload(signature.offset) s := calldataload(add(signature.offset, 32)) v := byte(0, calldataload(add(signature.offset, 64))) } return ecrecover(ethHash, v, r, s); }
}
