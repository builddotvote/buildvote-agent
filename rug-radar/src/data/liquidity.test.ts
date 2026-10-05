import test from "node:test";
import assert from "node:assert/strict";
import { fetchLiquidityInput } from "./liquidity.js";
import { base58Decode } from "../base58.js";

function fixtureAccountData(complete: boolean, realSolReserves: bigint): [string, string] {
  const buf = Buffer.alloc(8 + 5 * 8 + 1 + 32);
  let offset = 8;
  buf.writeBigUInt64LE(1_000_000n, offset); // virtual_token_reserves
  offset += 8;
  buf.writeBigUInt64LE(30_000_000_000n, offset); // virtual_sol_reserves
  offset += 8;
  buf.writeBigUInt64LE(500_000n, offset); // real_token_reserves
  offset += 8;
  buf.writeBigUInt64LE(realSolReserves, offset); // real_sol_reserves
  offset += 8;
  buf.writeBigUInt64LE(1_000_000_000n, offset); // token_total_supply
  offset += 8;
  buf.writeUInt8(complete ? 1 : 0, offset);
  offset += 1;
  Buffer.from(base58Decode("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")).copy(buf, offset);
  return [buf.toString("base64"), "base64"];
}

test("fetches and decodes the bonding curve into a LiquidityInput", async () => {
  const fakeRpc = {
    getAccountInfo: async () => ({
      data: fixtureAccountData(false, 8_000_000_000n),
      executable: false,
      lamports: 1,
      owner: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
      rentEpoch: 0,
    }),
  };

  const input = await fetchLiquidityInput(fakeRpc, "CurveAddress");
  assert.equal(input.complete, false);
  assert.equal(input.realSolReserves, 8_000_000_000n);
});

test("throws when the bonding curve account does not exist", async () => {
  const fakeRpc = { getAccountInfo: async () => null };
  await assert.rejects(() => fetchLiquidityInput(fakeRpc, "MissingAddress"));
});

test("skips the RPC call entirely when a known curve is passed in", async () => {
  const fakeRpc = {
    getAccountInfo: async () => {
      throw new Error("should not be called when knownCurve is provided");
    },
  };

  const input = await fetchLiquidityInput(fakeRpc, "CurveAddress", {
    virtualTokenReserves: 0n,
    virtualSolReserves: 0n,
    realTokenReserves: 0n,
    realSolReserves: 8_000_000_000n,
    tokenTotalSupply: 1_000_000_000n,
    complete: false,
    creator: "Creator111111111111111111111111111111111",
  });
  assert.equal(input.complete, false);
  assert.equal(input.realSolReserves, 8_000_000_000n);
});
