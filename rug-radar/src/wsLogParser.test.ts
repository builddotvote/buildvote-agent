import { test } from "node:test";
import assert from "node:assert/strict";
import { detectCreateInstruction, detectTradeInstruction } from "./wsLogParser.js";

const PUMP_FUN_PROGRAM_ID = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";

// Captured live from wss://api.mainnet-beta.solana.com's logsSubscribe for
// the pump.fun program (see rug-radar/README.md): a real create_v2 + bundled
// dev buy in one transaction (signature
// 22V7GKTxYumj38FyZ8zp8yZjXQX45VAa6tuLTABEck6jPsq3JyVP5i7JDFSafuXB55MJfbzouSiYcSPY6yeDmh6B).
const REAL_CREATE_V2_LOGS = [
  "Program ComputeBudget111111111111111111111111111111 invoke [1]",
  "Program ComputeBudget111111111111111111111111111111 success",
  "Program ComputeBudget111111111111111111111111111111 invoke [1]",
  "Program ComputeBudget111111111111111111111111111111 success",
  "Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P invoke [1]",
  "Program log: Instruction: CreateV2",
  "Program 11111111111111111111111111111111 invoke [2]",
  "Program 11111111111111111111111111111111 success",
  "Program TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb invoke [2]",
  "Program log: MetadataPointerInstruction::Initialize",
  "Program TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb success",
  "Program TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb invoke [2]",
  "Program log: Instruction: InitializeMint2",
  "Program TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb success",
  "Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P consumed 95741 of 499700 compute units",
  "Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P success",
  "Program ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL invoke [1]",
  "Program log: CreateIdempotent",
  "Program ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL success",
  "Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P invoke [1]",
  "Program log: Instruction: BuyV2",
  "Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P success",
];

// Also captured live: a transaction that mentions the pump.fun program (so
// it passes logsSubscribe's `mentions` filter) but whose only "Create"-ish
// log line belongs to a different program
// (proVF4pMXVaYqmy4NjniPh4pqKNfMmsihgd4wdkCX3u's "Instruction:
// CreateTokenAccount") — a plain substring/regex match on the whole log
// array would false-positive on this; stack-aware parsing should not.
const REAL_UNRELATED_CREATE_TEXT_LOGS = [
  "Program 11111111111111111111111111111111 invoke [1]",
  "Program 11111111111111111111111111111111 success",
  "Program proVF4pMXVaYqmy4NjniPh4pqKNfMmsihgd4wdkCX3u invoke [1]",
  "Program log: Instruction: CreateTokenAccount",
  "Program proVF4pMXVaYqmy4NjniPh4pqKNfMmsihgd4wdkCX3u success",
];

test("detects a real CreateV2 inside the program's own invoke frame", () => {
  assert.equal(detectCreateInstruction(PUMP_FUN_PROGRAM_ID, REAL_CREATE_V2_LOGS), "create_v2");
});

test("ignores a same-looking instruction name under an unrelated program", () => {
  assert.equal(
    detectCreateInstruction(PUMP_FUN_PROGRAM_ID, REAL_UNRELATED_CREATE_TEXT_LOGS),
    null,
  );
});

test("detects the plain (non-V2) create variant", () => {
  const logs = [
    "Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P invoke [1]",
    "Program log: Instruction: Create",
    "Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P success",
  ];
  assert.equal(detectCreateInstruction(PUMP_FUN_PROGRAM_ID, logs), "create");
});

test("a Create log line emitted by a program the target CPIs into does not count", () => {
  const logs = [
    "Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P invoke [1]",
    "Program SomeOtherProgram1111111111111111111111111 invoke [2]",
    "Program log: Instruction: Create",
    "Program SomeOtherProgram1111111111111111111111111 success",
    "Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P success",
  ];
  // The log line's own frame (top of stack) is the callee, not pump.fun —
  // only lines the program logs directly about itself should match.
  assert.equal(detectCreateInstruction(PUMP_FUN_PROGRAM_ID, logs), null);
});

test("a buy-only transaction (no create) returns null", () => {
  const logs = [
    "Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P invoke [1]",
    "Program log: Instruction: BuyV2",
    "Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P success",
  ];
  assert.equal(detectCreateInstruction(PUMP_FUN_PROGRAM_ID, logs), null);
});

test("empty logs return null", () => {
  assert.equal(detectCreateInstruction(PUMP_FUN_PROGRAM_ID, []), null);
});

test("detects the bundled dev BuyV2 inside a real create_v2 transaction", () => {
  // Same captured transaction as the "detects a real CreateV2" test above —
  // it is a create_v2 *and* a bundled first buy in one tx, so this should
  // see the BuyV2 the create detector correctly ignores.
  assert.equal(detectTradeInstruction(PUMP_FUN_PROGRAM_ID, REAL_CREATE_V2_LOGS), "buy");
});

test("detects the plain (non-V2) sell variant", () => {
  const logs = [
    "Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P invoke [1]",
    "Program log: Instruction: Sell",
    "Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P success",
  ];
  assert.equal(detectTradeInstruction(PUMP_FUN_PROGRAM_ID, logs), "sell");
});

test("detects the plain (non-V2) buy variant", () => {
  const logs = [
    "Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P invoke [1]",
    "Program log: Instruction: Buy",
    "Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P success",
  ];
  assert.equal(detectTradeInstruction(PUMP_FUN_PROGRAM_ID, logs), "buy");
});

test("detects SellV2", () => {
  const logs = [
    "Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P invoke [1]",
    "Program log: Instruction: SellV2",
    "Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P success",
  ];
  assert.equal(detectTradeInstruction(PUMP_FUN_PROGRAM_ID, logs), "sell");
});

test("ignores a same-looking Buy instruction name under an unrelated program", () => {
  const logs = [
    "Program 11111111111111111111111111111111 invoke [1]",
    "Program log: Instruction: Buy",
    "Program 11111111111111111111111111111111 success",
  ];
  assert.equal(detectTradeInstruction(PUMP_FUN_PROGRAM_ID, logs), null);
});

test("a create-only transaction (no trade) returns null", () => {
  const logs = [
    "Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P invoke [1]",
    "Program log: Instruction: Create",
    "Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P success",
  ];
  assert.equal(detectTradeInstruction(PUMP_FUN_PROGRAM_ID, logs), null);
});

test("trade: empty logs return null", () => {
  assert.equal(detectTradeInstruction(PUMP_FUN_PROGRAM_ID, []), null);
});
