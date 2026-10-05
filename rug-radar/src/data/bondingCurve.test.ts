import test from "node:test";
import assert from "node:assert/strict";
import { fetchBondingCurveAccount } from "./bondingCurve.js";
import { base58Decode } from "../base58.js";

function fixtureAccountData(complete: boolean, tokenTotalSupply: bigint): [string, string] {
  const buf = Buffer.alloc(8 + 5 * 8 + 1 + 32);
  let offset = 8 + 4 * 8;
  buf.writeBigUInt64LE(tokenTotalSupply, offset); // token_total_supply
  offset += 8;
  buf.writeUInt8(complete ? 1 : 0, offset);
  offset += 1;
  Buffer.from(base58Decode("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")).copy(buf, offset);
  return [buf.toString("base64"), "base64"];
}

test("fetches and decodes the bonding curve account", async () => {
  const fakeRpc = {
    getAccountInfo: async () => ({
      data: fixtureAccountData(true, 1_000_000_000n),
      executable: false,
      lamports: 1,
      owner: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
      rentEpoch: 0,
    }),
  };

  const curve = await fetchBondingCurveAccount(fakeRpc, "CurveAddress");
  assert.equal(curve.complete, true);
  assert.equal(curve.tokenTotalSupply, 1_000_000_000n);
});

test("throws when the bonding curve account does not exist", async () => {
  const fakeRpc = { getAccountInfo: async () => null };
  await assert.rejects(() => fetchBondingCurveAccount(fakeRpc, "MissingAddress"));
});
