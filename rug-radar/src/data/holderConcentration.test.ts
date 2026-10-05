import test from "node:test";
import assert from "node:assert/strict";
import { fetchHolderConcentrationInput } from "./holderConcentration.js";

test("combines token supply and largest accounts into signal input", async () => {
  const fakeRpc = {
    getTokenSupply: async () => ({
      amount: "1000000000",
      decimals: 6,
      uiAmount: 1000,
      uiAmountString: "1000",
    }),
    getTokenLargestAccounts: async () => [
      { address: "BondingCurve", amount: "600000000", decimals: 6, uiAmount: 600, uiAmountString: "600" },
      { address: "Holder1", amount: "100000000", decimals: 6, uiAmount: 100, uiAmountString: "100" },
    ],
  };

  const input = await fetchHolderConcentrationInput(fakeRpc, "Mint1", ["BondingCurve"]);

  assert.equal(input.totalSupply, 1_000_000_000n);
  assert.equal(input.holders.length, 2);
  assert.equal(input.holders[1].address, "Holder1");
  assert.equal(input.holders[1].amount, 100_000_000n);
  assert.deepEqual(input.excludedAddresses, ["BondingCurve"]);
});

test("skips getTokenSupply entirely when a known total supply is passed in", async () => {
  const fakeRpc = {
    getTokenSupply: async () => {
      throw new Error("should not be called when knownTotalSupply is provided");
    },
    getTokenLargestAccounts: async () => [
      { address: "Holder1", amount: "100000000", decimals: 6, uiAmount: 100, uiAmountString: "100" },
    ],
  };

  const input = await fetchHolderConcentrationInput(fakeRpc, "Mint1", [], 1_000_000_000n);

  assert.equal(input.totalSupply, 1_000_000_000n);
  assert.equal(input.holders.length, 1);
});
