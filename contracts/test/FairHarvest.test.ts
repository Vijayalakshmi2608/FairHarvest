import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

const e = ethers;
const units = (n: number) => e.parseEther(String(n));

async function deployFixture() {
  const [admin, farmer, buyer, arbiter, oracle, stranger] = await e.getSigners();
  const Token = await e.getContractFactory("MockStablecoin");
  const token = await Token.deploy();
  const Index = await e.getContractFactory("PriceIndex");
  const index = await Index.deploy(admin.address, oracle.address);
  const Registry = await e.getContractFactory("ListingRegistry");
  const registry = await Registry.deploy(admin.address);
  const Reputation = await e.getContractFactory("Reputation");
  const reputation = await Reputation.deploy(admin.address);
  const Escrow = await e.getContractFactory("OrderEscrow");
  const escrow = await Escrow.deploy(admin.address, arbiter.address, token.target, registry.target, reputation.target, index.target, 100);
  const Adapter = await e.getContractFactory("PriceOracleAdapter");
  const adapter = await Adapter.deploy(admin.address, oracle.address, index.target);

  await registry.setOrderEscrow(escrow.target);
  await registry.setPriceIndex(index.target);
  await index.setEscrow(escrow.target);
  await index.setAdapter(adapter.target);
  await reputation.setEscrow(escrow.target);
  await index.grantRole(await index.ESCROW_ROLE(), admin.address);
  await index.recordSale("wheat", "A", "pilot", units(100));
  await token.mint(buyer.address, units(10_000));
  await token.connect(buyer).approve(escrow.target, units(10_000));
  return { admin, farmer, buyer, arbiter, oracle, stranger, token, index, registry, reputation, escrow, adapter };
}

async function createListing(registry: any, farmer: any, price = 100) {
  await registry.connect(farmer).createListing("wheat", "A", 10, 1, "pilot", units(price), "ipfs://demo");
}

async function signPayload(adapter: any, signer: any, values: any) {
  const digest = await adapter.payloadHash(...values);
  return signer.signMessage(e.getBytes(digest));
}

describe("FairHarvest contracts", function () {
  it("allows a farmer to create, update, and cancel a listing", async function () {
    const { registry, farmer } = await deployFixture();
    await createListing(registry, farmer, 100);
    await registry.connect(farmer).updateListing(1, "wheat", "B", 8, 2, "pilot", units(120), "ipfs://updated");
    expect((await registry.getListing(1)).grade).to.equal("B");
    await registry.connect(farmer).cancelListing(1);
    expect((await registry.getListing(1)).status).to.equal(2);
  });

  it("rejects prices outside the 0.3x–3x realized index bound", async function () {
    const { registry, farmer } = await deployFixture();
    await expect(registry.connect(farmer).createListing("wheat", "A", 1, 1, "pilot", units(29), "x")).to.be.revertedWith("price below 0.3x index");
    await expect(registry.connect(farmer).createListing("wheat", "A", 1, 1, "pilot", units(301), "x")).to.be.revertedWith("price above 3x index");
    await createListing(registry, farmer, 30);
    await createListing(registry, farmer, 300);
  });

  it("runs create → deliver → confirm and pays farmer minus the fee", async function () {
    const { registry, farmer, buyer, escrow, token, reputation } = await deployFixture();
    await createListing(registry, farmer, 100);
    await escrow.connect(buyer).createOrder(1, 5, units(100));
    await escrow.connect(farmer).markDelivered(1);
    await escrow.connect(buyer).confirmDelivery(1, 5);
    expect(await escrow.pendingWithdrawals(farmer.address)).to.equal(units(495));
    expect(await escrow.pendingWithdrawals((await escrow.platformFeeRecipient()))).to.equal(units(5));
    const before = await token.balanceOf(farmer.address);
    await escrow.connect(farmer).withdraw();
    expect((await token.balanceOf(farmer.address)) - before).to.equal(units(495));
    expect((await reputation.getProfile(farmer.address))[0]).to.equal(1);
  });

  it("refunds a buyer after a dispute and leaves the farmer without escrow funds", async function () {
    const { registry, farmer, buyer, arbiter, escrow, token, reputation } = await deployFixture();
    await createListing(registry, farmer, 100);
    await escrow.connect(buyer).createOrder(1, 2, units(100));
    await escrow.connect(buyer).openDispute(1);
    await escrow.connect(arbiter).resolveDispute(1, false);
    await expect(escrow.connect(farmer).withdraw()).to.be.revertedWith("nothing to withdraw");
    const before = await token.balanceOf(buyer.address);
    await escrow.connect(buyer).withdraw();
    expect((await token.balanceOf(buyer.address)) - before).to.equal(units(200));
    const farmerProfile = await reputation.getProfile(farmer.address);
    const buyerProfile = await reputation.getProfile(buyer.address);
    expect(farmerProfile[0]).to.equal(0);
    expect(farmerProfile[1]).to.equal(0);
    expect(buyerProfile[1]).to.equal(1);
  });

  it("blocks a reentrant withdraw attempt", async function () {
    const { registry, farmer, buyer, escrow, token } = await deployFixture();
    await createListing(registry, farmer, 100);
    const Receiver = await e.getContractFactory("ReentrantReceiver");
    const receiver = await Receiver.deploy(registry.target, escrow.target);
    await registry.connect(farmer).createListing("wheat", "A", 10, 1, "pilot", units(100), "x");
    // The receiver owns the second listing and acts as its farmer.
    await receiver.createListing();
    await escrow.connect(buyer).createOrder(3, 1, units(100));
    await receiver.markDelivered(1);
    await escrow.connect(buyer).confirmDelivery(1, 5);
    expect(await escrow.pendingWithdrawals(receiver.target)).to.equal(units(99));
    await token.setStrictReceiverCallbacks(true);
    await expect(receiver.attack()).to.be.reverted;
    expect(await escrow.pendingWithdrawals(receiver.target)).to.equal(units(99));
    expect(await token.balanceOf(receiver.target)).to.equal(0);
  });

  it("updates completed reputation only on confirmation", async function () {
    const { registry, farmer, buyer, escrow, arbiter, reputation } = await deployFixture();
    await createListing(registry, farmer, 100);
    await escrow.connect(buyer).createOrder(1, 1, units(100));
    await escrow.connect(buyer).openDispute(1);
    expect((await reputation.getProfile(farmer.address))[0]).to.equal(0);
    await escrow.connect(arbiter).resolveDispute(1, true);
    expect((await reputation.getProfile(farmer.address))[0]).to.equal(0);
  });

  it("calculates odd and even medians", async function () {
    const { index, admin } = await deployFixture();
    await index.recordSale("wheat", "A", "pilot", units(50));
    await index.recordSale("wheat", "A", "pilot", units(150));
    expect(await index.getMedianPrice("wheat", "A", "pilot")).to.equal(units(100));
    await index.recordSale("wheat", "A", "pilot", units(200));
    expect(await index.getMedianPrice("wheat", "A", "pilot")).to.equal(units(125));
    expect(admin.address).to.be.properAddress;
  });

  it("accepts a fresh oracle payload and exposes the fair range", async function () {
    const { adapter, oracle } = await deployFixture();
    const now = await time.latest();
    const values = ["wheat", "A", "pilot", units(80), units(120), 8_500, now, 1n];
    const signature = await signPayload(adapter, oracle, values);
    await adapter.submitPriceRange(...values, signature);
    const result = await adapter.getFairPriceRange("wheat", "A", "pilot");
    expect(result[0]).to.equal(units(80));
    expect(result[1]).to.equal(units(120));
    expect(result[2]).to.equal(8_500);
    expect(result[3]).to.equal(now);
  });

  it("rejects expired timestamps, bad signatures, and replayed nonces", async function () {
    const { adapter, oracle, stranger } = await deployFixture();
    const expired = (await time.latest()) - 86_401;
    const expiredValues = ["wheat", "A", "pilot", units(80), units(120), 8_500, expired, 2n];
    await expect(adapter.submitPriceRange(...expiredValues, await signPayload(adapter, oracle, expiredValues))).to.be.revertedWith("oracle payload expired");
    const now = await time.latest();
    const values = ["wheat", "A", "pilot", units(80), units(120), 8_500, now, 3n];
    await expect(adapter.submitPriceRange(...values, await signPayload(adapter, stranger, values))).to.be.revertedWith("bad oracle signature");
    const good = await signPayload(adapter, oracle, values);
    await adapter.submitPriceRange(...values, good);
    await expect(adapter.submitPriceRange(...values, good)).to.be.revertedWith("nonce already used");
  });
});
