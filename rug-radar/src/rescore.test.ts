import test from "node:test";
import assert from "node:assert/strict";
import { rescoreHolderConcentrationFromIndex } from "./rescore.js";
import { BalanceIndex } from "./balanceIndex.js";
import { base58Decode } from "./base58.js";

function fixtureAccountData(tokenTotalSupply: bigint): [string, string] {
  const buf = Buffer.alloc(8 + 5 * 8 + 1 + 32);
  let offset = 8 + 4 * 8;
  buf.writeBigUInt64LE(tokenTotalSupply, offset); // token_total_supply
  offset += 8;
  buf.writeUInt8(0, offset); // complete
  offset += 1;
  Buffer.from(base58Decode("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")).copy(buf, offset);
  return [buf.toString("base64"), "base64"];
}

const launch = { mint: "Mint1", deployer: "Deployer1", bondingCurve: "Curve1", createdAt: 0, signature: "sig1" };

function fakeRpc(tokenTotalSupply: bigint) {
  return {
    getAccountInfo: async () => ({
      data: fixtureAccountData(tokenTotalSupply),
      executable: false,
      lamports: 1,
      owner: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
      rentEpoch: 0,
    }),
  };
}

test("returns null when the index has observed no trades for this mint", async () => {
  const balanceIndex = new BalanceIndex();
  const result = await rescoreHolderConcentrationFromIndex(fakeRpc(1_000_000n), launch, balanceIndex);
  assert.equal(result, null);
});

test("scores holder-concentration from observed trades", async () => {
  const balanceIndex = new BalanceIndex();
  balanceIndex.recordTrade({ kind: "buy", mint: "Mint1", user: "Whale", amount: 600_000n });
  balanceIndex.recordTrade({ kind: "buy", mint: "Mint1", user: "Small", amount: 100_000n });

  const result = await rescoreHolderConcentrationFromIndex(fakeRpc(1_000_000n), launch, balanceIndex);
  assert.ok(result);
  assert.equal(result?.name, "holder-concentration");
  assert.equal(result?.score, 90); // 70% of supply in the top holders, >= 50%
});

test("excludes the bonding curve address from the index lookup", async () => {
  const balanceIndex = new BalanceIndex();
  balanceIndex.recordTrade({ kind: "buy", mint: "Mint1", user: "Curve1", amount: 900_000n });
  balanceIndex.recordTrade({ kind: "buy", mint: "Mint1", user: "Real", amount: 100_000n });

  const result = await rescoreHolderConcentrationFromIndex(fakeRpc(1_000_000n), launch, balanceIndex);
  assert.ok(result);
  assert.match(result?.reasons[0] ?? "", /10\.0%/);
});

test("returns null when the bonding curve account can't be read", async () => {
  const balanceIndex = new BalanceIndex();
  balanceIndex.recordTrade({ kind: "buy", mint: "Mint1", user: "Whale", amount: 600_000n });
  const failingRpc = { getAccountInfo: async () => null };

  const result = await rescoreHolderConcentrationFromIndex(failingRpc, launch, balanceIndex);
  assert.equal(result, null);
});
