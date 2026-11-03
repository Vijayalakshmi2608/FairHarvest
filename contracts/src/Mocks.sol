// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {OrderEscrow} from "./OrderEscrow.sol";
import {ListingRegistry} from "./ListingRegistry.sol";

interface ITokenReceiver { function onTokenReceived() external; }

contract MockStablecoin is ERC20 {
    bool public strictReceiverCallbacks;
    constructor() ERC20("Mock QIE Stable Coin", "mQUSD") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
    function setStrictReceiverCallbacks(bool enabled) external { strictReceiverCallbacks = enabled; }
    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (to.code.length > 0) {
            if (strictReceiverCallbacks) ITokenReceiver(to).onTokenReceived();
            else try ITokenReceiver(to).onTokenReceived() {} catch {}
        }
    }
}

contract ReentrantReceiver is ITokenReceiver {
    ListingRegistry public registry;
    OrderEscrow public escrow;
    bool public attackEnabled;

    constructor(ListingRegistry registry_, OrderEscrow escrow_) { registry = registry_; escrow = escrow_; }
    function createListing() external returns (uint256) { return registry.createListing("wheat", "A", 10, 1, "pilot", 100 ether, "ipfs://demo"); }
    function markDelivered(uint256 orderId) external { escrow.markDelivered(orderId); }
    function attack() external { attackEnabled = true; escrow.withdraw(); }
    function onTokenReceived() external override { if (attackEnabled) escrow.withdraw(); }
}
