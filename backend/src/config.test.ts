import assert from "node:assert/strict";
import { config } from "./config.js";

assert.equal(config.STABLECOIN_DECIMALS, 18, "backend must use STABLECOIN_DECIMALS=18");
console.log(`backend STABLECOIN_DECIMALS=${config.STABLECOIN_DECIMALS}`);
