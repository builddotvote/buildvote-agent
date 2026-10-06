import test from "node:test";
import assert from "node:assert/strict";
import { decodeBondingCurve, decodeCreateInstruction, decodeTradeInstruction } from "./pumpfun.js";
import { base58Decode, base58Encode } from "./base58.js";

// Builds a fixture buffer matching the real BondingCurve account layout
// (see pumpfun.ts) so the decoder can be tested offline, without any RPC call.
function buildBondingCurveFixture(fields: {
  virtualTokenReserves: bigint;
  virtualSolReserves: bigint;
  realTokenReserves: bigint;
  realSolReserves: bigint;
  tokenTotalSupply: bigint;
  complete: boolean;
  creator: string;
}): string {
  const buf = Buffer.alloc(8 + 5 * 8 + 1 + 32);
  let offset = 8; // discriminator, contents don't matter for decoding
  buf.writeBigUInt64LE(fields.virtualTokenReserves, offset);
  offset += 8;
  buf.writeBigUInt64LE(fields.virtualSolReserves, offset);
  offset += 8;
  buf.writeBigUInt64LE(fields.realTokenReserves, offset);
  offset += 8;
  buf.writeBigUInt64LE(fields.realSolReserves, offset);
  offset += 8;
  buf.writeBigUInt64LE(fields.tokenTotalSupply, offset);
  offset += 8;
  buf.writeUInt8(fields.complete ? 1 : 0, offset);
  offset += 1;
  Buffer.from(base58Decode(fields.creator)).copy(buf, offset);
  return buf.toString("base64");
}

test("decodes a still-bonding curve account", () => {
  const creator = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
  const base64 = buildBondingCurveFixture({
    virtualTokenReserves: 1_000_000_000n,
    virtualSolReserves: 30_000_000_000n,
    realTokenReserves: 500_000_000n,
    realSolReserves: 5_000_000_000n,
    tokenTotalSupply: 1_000_000_000_000n,
    complete: false,
    creator,
  });

  const decoded = decodeBondingCurve(base64);
  assert.equal(decoded.virtualTokenReserves, 1_000_000_000n);
  assert.equal(decoded.realSolReserves, 5_000_000_000n);
  assert.equal(decoded.complete, false);
  assert.equal(decoded.creator, creator);
});

test("decodes a completed (migrated) curve account", () => {
  const creator = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
  const base64 = buildBondingCurveFixture({
    virtualTokenReserves: 0n,
    virtualSolReserves: 0n,
    realTokenReserves: 0n,
    realSolReserves: 85_000_000_000n,
    tokenTotalSupply: 1_000_000_000_000n,
    complete: true,
    creator,
  });

  const decoded = decodeBondingCurve(base64);
  assert.equal(decoded.complete, true);
  assert.equal(decoded.creator, creator);
});

test("throws when the account data is too short to be a bonding curve", () => {
  const tooShort = Buffer.alloc(10).toString("base64");
  assert.throws(() => decodeBondingCurve(tooShort));
});

// Builds instruction accounts with a known address at a given index and
// filler addresses (irrelevant to the decoder) everywhere else.
function buildAccounts(count: number, known: Record<number, string>): string[] {
  return Array.from({ length: count }, (_, i) => known[i] ?? `Filler${i}Program1111111111111111111111`);
}

function instructionData(discriminator: number[], argBytes = 4): string {
  const buf = Buffer.concat([Buffer.from(discriminator), Buffer.alloc(argBytes)]);
  return base58Encode(buf);
}

test("decodes mint/bondingCurve/user from a create instruction", () => {
  const mint = "Mint11111111111111111111111111111111111111";
  const bondingCurve = "BondingCurve111111111111111111111111111111";
  const user = "Deployer11111111111111111111111111111111111";
  const accounts = buildAccounts(14, { 0: mint, 2: bondingCurve, 7: user });

  const decoded = decodeCreateInstruction(instructionData([24, 30, 200, 40, 5, 28, 7, 119]), accounts);
  assert.deepEqual(decoded, { mint, bondingCurve, user });
});

test("decodes mint/bondingCurve/user from a create_v2 instruction", () => {
  const mint = "Mint22222222222222222222222222222222222222";
  const bondingCurve = "BondingCurve222222222222222222222222222222";
  const user = "Deployer22222222222222222222222222222222222";
  const accounts = buildAccounts(9, { 0: mint, 2: bondingCurve, 4: user });

  const decoded = decodeCreateInstruction(instructionData([214, 144, 76, 236, 95, 139, 49, 180]), accounts);
  assert.deepEqual(decoded, { mint, bondingCurve, user });
});

test("returns null for an instruction with an unrelated discriminator", () => {
  const accounts = buildAccounts(14, {});
  const decoded = decodeCreateInstruction(instructionData([1, 2, 3, 4, 5, 6, 7, 8]), accounts);
  assert.equal(decoded, null);
});

test("returns null when the account list is too short for the matched variant", () => {
  const accounts = buildAccounts(3, {});
  const decoded = decodeCreateInstruction(instructionData([24, 30, 200, 40, 5, 28, 7, 119]), accounts);
  assert.equal(decoded, null);
});

// Encodes discriminator + amount (u64 LE) + trailing filler, matching the
// real buy/sell instruction data layout (amount is the first arg).
function tradeInstructionData(discriminator: number[], amount: bigint, trailingBytes = 9): string {
  const buf = Buffer.alloc(discriminator.length + 8 + trailingBytes);
  Buffer.from(discriminator).copy(buf, 0);
  buf.writeBigUInt64LE(amount, discriminator.length);
  return base58Encode(buf);
}

test("decodes a buy instruction's accounts and amount", () => {
  const mint = "Mint11111111111111111111111111111111111111";
  const bondingCurve = "BondingCurve111111111111111111111111111111";
  const user = "Buyer111111111111111111111111111111111111";
  const accounts = buildAccounts(16, { 2: mint, 3: bondingCurve, 6: user });

  const decoded = decodeTradeInstruction(
    tradeInstructionData([102, 6, 61, 18, 1, 218, 235, 234], 123_456_789n),
    accounts,
  );
  assert.deepEqual(decoded, { kind: "buy", mint, bondingCurve, user, amount: 123_456_789n });
});

test("decodes a sell instruction's accounts and amount", () => {
  const mint = "Mint11111111111111111111111111111111111111";
  const bondingCurve = "BondingCurve111111111111111111111111111111";
  const user = "Seller11111111111111111111111111111111111";
  const accounts = buildAccounts(14, { 2: mint, 3: bondingCurve, 6: user });

  const decoded = decodeTradeInstruction(
    tradeInstructionData([51, 230, 133, 164, 1, 127, 131, 173], 42n),
    accounts,
  );
  assert.deepEqual(decoded, { kind: "sell", mint, bondingCurve, user, amount: 42n });
});

test("returns null for a trade instruction with an unrelated discriminator", () => {
  const accounts = buildAccounts(16, {});
  const decoded = decodeTradeInstruction(tradeInstructionData([1, 2, 3, 4, 5, 6, 7, 8], 1n), accounts);
  assert.equal(decoded, null);
});

test("returns null when the account list is too short for a trade instruction", () => {
  const accounts = buildAccounts(3, {});
  const decoded = decodeTradeInstruction(
    tradeInstructionData([102, 6, 61, 18, 1, 218, 235, 234], 1n),
    accounts,
  );
  assert.equal(decoded, null);
});

test("returns null when trade instruction data is too short to hold the amount arg", () => {
  const accounts = buildAccounts(16, { 2: "Mint1", 3: "Curve1", 6: "User1" });
  const tooShort = base58Encode(Buffer.from([102, 6, 61, 18, 1, 218, 235, 234, 1, 2, 3]));
  const decoded = decodeTradeInstruction(tooShort, accounts);
  assert.equal(decoded, null);
});
