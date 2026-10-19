import test from "node:test";
import assert from "node:assert/strict";
import { base58Encode, base58Decode } from "./base58.js";

test("encodes 32 zero bytes as the system program address", () => {
  assert.equal(base58Encode(new Uint8Array(32)), "11111111111111111111111111111111");
});

test("round-trips known Solana program addresses", () => {
  const addresses = [
    "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
    "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
    "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
  ];
  for (const address of addresses) {
    const decoded = base58Decode(address);
    assert.equal(decoded.length, 32, `${address} should decode to 32 bytes`);
    assert.equal(base58Encode(decoded), address);
  }
});

test("rejects invalid base58 characters", () => {
  assert.throws(() => base58Decode("0OIl"));
});

test("decodes the system program address (all leading zeros, no digits) back to 32 zero bytes", () => {
  const decoded = base58Decode("11111111111111111111111111111111");
  assert.equal(decoded.length, 32);
  assert.ok(decoded.every((byte) => byte === 0));
});

test("decodes a single \"1\" to a single zero byte, not two", () => {
  assert.deepEqual(base58Decode("1"), new Uint8Array([0]));
});

test("decodes an empty string to an empty byte array", () => {
  assert.deepEqual(base58Decode(""), new Uint8Array(0));
});
