import test from "node:test";
import assert from "node:assert/strict";
import { BalanceIndex } from "./balanceIndex.js";

test("returns nothing for a mint it hasn't seen", () => {
  const index = new BalanceIndex();
  assert.deepEqual(index.getHolders("MintA"), []);
});

test("a buy records a positive balance", () => {
  const index = new BalanceIndex();
  index.recordTrade({ kind: "buy", mint: "MintA", user: "Wallet1", amount: 100n });

  assert.deepEqual(index.getHolders("MintA"), [{ address: "Wallet1", balance: 100n }]);
});

test("a sell reduces the balance", () => {
  const index = new BalanceIndex();
  index.recordTrade({ kind: "buy", mint: "MintA", user: "Wallet1", amount: 100n });
  index.recordTrade({ kind: "sell", mint: "MintA", user: "Wallet1", amount: 40n });

  assert.deepEqual(index.getHolders("MintA"), [{ address: "Wallet1", balance: 60n }]);
});

test("a wallet that sells out to zero no longer appears as a holder", () => {
  const index = new BalanceIndex();
  index.recordTrade({ kind: "buy", mint: "MintA", user: "Wallet1", amount: 100n });
  index.recordTrade({ kind: "sell", mint: "MintA", user: "Wallet1", amount: 100n });

  assert.deepEqual(index.getHolders("MintA"), []);
});

test("a sell with no observed prior buy clamps to zero instead of going negative", () => {
  const index = new BalanceIndex();
  index.recordTrade({ kind: "sell", mint: "MintA", user: "Wallet1", amount: 50n });

  assert.deepEqual(index.getHolders("MintA"), []);
});

test("excludes the given addresses, e.g. the bonding curve", () => {
  const index = new BalanceIndex();
  index.recordTrade({ kind: "buy", mint: "MintA", user: "BondingCurve", amount: 500n });
  index.recordTrade({ kind: "buy", mint: "MintA", user: "Wallet1", amount: 100n });

  assert.deepEqual(index.getHolders("MintA", ["BondingCurve"]), [{ address: "Wallet1", balance: 100n }]);
});

test("keeps mints separate", () => {
  const index = new BalanceIndex();
  index.recordTrade({ kind: "buy", mint: "MintA", user: "Wallet1", amount: 100n });
  index.recordTrade({ kind: "buy", mint: "MintB", user: "Wallet1", amount: 7n });

  assert.deepEqual(index.getHolders("MintA"), [{ address: "Wallet1", balance: 100n }]);
  assert.deepEqual(index.getHolders("MintB"), [{ address: "Wallet1", balance: 7n }]);
});

test("evicts the oldest (mint, wallet) entry once past the max size", () => {
  const index = new BalanceIndex(2);
  index.recordTrade({ kind: "buy", mint: "MintA", user: "Wallet1", amount: 10n });
  index.recordTrade({ kind: "buy", mint: "MintA", user: "Wallet2", amount: 20n });
  index.recordTrade({ kind: "buy", mint: "MintB", user: "Wallet3", amount: 30n });

  // (MintA, Wallet1) was recorded first, so it's evicted once the 3rd entry pushes past max size 2.
  assert.deepEqual(index.getHolders("MintA"), [{ address: "Wallet2", balance: 20n }]);
  assert.deepEqual(index.getHolders("MintB"), [{ address: "Wallet3", balance: 30n }]);
});

test("repeated trades on the same (mint, wallet) pair don't count as new entries toward eviction", () => {
  const index = new BalanceIndex(2);
  index.recordTrade({ kind: "buy", mint: "MintA", user: "Wallet1", amount: 10n });
  index.recordTrade({ kind: "buy", mint: "MintA", user: "Wallet1", amount: 5n });
  index.recordTrade({ kind: "buy", mint: "MintB", user: "Wallet2", amount: 20n });

  // Only 2 distinct (mint, wallet) pairs exist, so neither was evicted.
  assert.deepEqual(index.getHolders("MintA"), [{ address: "Wallet1", balance: 15n }]);
  assert.deepEqual(index.getHolders("MintB"), [{ address: "Wallet2", balance: 20n }]);
});
