import test from "node:test";
import assert from "node:assert/strict";
import { scoreLaunch } from "./pipeline.js";
import { base58Decode } from "./base58.js";
import { DeployerIndex } from "./deployerIndex.js";
import type { DiscoveredLaunch } from "./discovery.js";

const LAUNCH: DiscoveredLaunch = {
  mint: "Mint1111111111111111111111111111111111111",
  deployer: "Deployer111111111111111111111111111111111",
  bondingCurve: "BondingCurve11111111111111111111111111111",
  createdAt: 1700000000,
  signature: "sigCreate",
};

function bondingCurveAccountData(complete: boolean, realSolReserves: bigint): [string, string] {
  const buf = Buffer.alloc(8 + 5 * 8 + 1 + 32);
  let offset = 8 + 3 * 8;
  buf.writeBigUInt64LE(realSolReserves, offset);
  offset += 8;
  buf.writeBigUInt64LE(1_000_000_000n, offset); // token_total_supply
  offset += 8;
  buf.writeUInt8(complete ? 1 : 0, offset);
  offset += 1;
  Buffer.from(base58Decode("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")).copy(buf, offset);
  return [buf.toString("base64"), "base64"];
}

function baseFakeRpc() {
  return {
    async getTokenSupply() {
      return { amount: "1000000000", decimals: 6, uiAmount: 1000, uiAmountString: "1000" };
    },
    async getTokenLargestAccounts() {
      return [
        { address: LAUNCH.bondingCurve, amount: "600000000", decimals: 6, uiAmount: 600, uiAmountString: "600" },
        { address: "Holder1", amount: "50000000", decimals: 6, uiAmount: 50, uiAmountString: "50" },
      ];
    },
    async getAccountInfo() {
      return {
        data: bondingCurveAccountData(false, 8_000_000_000n),
        executable: false,
        lamports: 1,
        owner: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
        rentEpoch: 0,
      };
    },
    async getSignaturesForAddress() {
      return [];
    },
    async getTransaction() {
      return null;
    },
  };
}

test("scores a launch by combining all four signals", async () => {
  const score = await scoreLaunch(baseFakeRpc(), LAUNCH);

  assert.equal(score.mint, LAUNCH.mint);
  const names = score.signals.map((s) => s.name).sort();
  assert.deepEqual(names, [
    "bundled-buys",
    "deployer-history",
    "holder-concentration",
    "liquidity",
  ]);
  assert.ok(score.score >= 0 && score.score <= 100);
});

test("uses the deployer index to catch prior launches the signature scan missed", async () => {
  const rpc = baseFakeRpc(); // getSignaturesForAddress returns [] — scan alone finds no history
  const deployerIndex = new DeployerIndex();
  const priorLaunch: DiscoveredLaunch = {
    mint: "MintPrior11111111111111111111111111111111",
    deployer: LAUNCH.deployer,
    bondingCurve: "CurvePrior111111111111111111111111111111",
    createdAt: 1699999000,
    signature: "sigPrior",
  };

  // Simulate the watcher/poller having observed one earlier launch from this
  // deployer before the current one is scored.
  deployerIndex.record(priorLaunch);

  const score = await scoreLaunch(rpc, LAUNCH, deployerIndex);
  const deployerHistory = score.signals.find((s) => s.name === "deployer-history");

  assert.ok(deployerHistory);
  assert.ok(deployerHistory.reasons.some((r) => r.includes("1 of 1 prior token")));
});

test("records the current launch so a later launch from the same deployer sees it", async () => {
  const rpc = baseFakeRpc();
  const deployerIndex = new DeployerIndex();

  await scoreLaunch(rpc, LAUNCH, deployerIndex);

  assert.deepEqual(deployerIndex.getPriorLaunches(LAUNCH.deployer, "SomeOtherMint"), [
    { mint: LAUNCH.mint, bondingCurve: LAUNCH.bondingCurve },
  ]);
});

test("shares the bonding curve fetch between liquidity and holder-concentration, skipping getTokenSupply", async () => {
  let getTokenSupplyCalls = 0;
  const rpc = {
    ...baseFakeRpc(),
    async getTokenSupply() {
      getTokenSupplyCalls++;
      return { amount: "1000000000", decimals: 6, uiAmount: 1000, uiAmountString: "1000" };
    },
  };

  const score = await scoreLaunch(rpc, LAUNCH);

  assert.equal(getTokenSupplyCalls, 0);
  const holderConcentration = score.signals.find((s) => s.name === "holder-concentration");
  assert.ok(holderConcentration);
});

test("drops a signal that fails to fetch instead of failing the whole launch", async () => {
  const rpc = {
    ...baseFakeRpc(),
    async getAccountInfo() {
      throw new Error("RPC timeout");
    },
  };

  const score = await scoreLaunch(rpc, LAUNCH);
  const names = score.signals.map((s) => s.name).sort();
  assert.deepEqual(names, ["bundled-buys", "deployer-history", "holder-concentration"]);
});
