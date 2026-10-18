import test from "node:test";
import assert from "node:assert/strict";
import { scoreHolderConcentration, type HolderConcentrationInput } from "./holderConcentration.js";

function baseInput(overrides: Partial<HolderConcentrationInput> = {}): HolderConcentrationInput {
  return {
    totalSupply: 1_000_000_000n,
    holders: [],
    excludedAddresses: [],
    ...overrides,
  };
}

test("scores high risk when top 10 holders own more than half of supply", () => {
  const result = scoreHolderConcentration(
    baseInput({
      totalSupply: 1_000_000_000n,
      holders: [
        { address: "H1", amount: 300_000_000n },
        { address: "H2", amount: 250_000_000n },
      ],
    }),
  );
  assert.equal(result.name, "holder-concentration");
  assert.equal(result.score, 90);
  assert.match(result.reasons[0], /55\.0%/);
});

test("excludes the bonding curve and known program accounts before ranking", () => {
  const result = scoreHolderConcentration(
    baseInput({
      totalSupply: 1_000_000_000n,
      holders: [
        { address: "BondingCurve", amount: 700_000_000n },
        { address: "RealHolder1", amount: 100_000_000n },
        { address: "RealHolder2", amount: 50_000_000n },
      ],
      excludedAddresses: ["BondingCurve"],
    }),
  );
  // Only RealHolder1 + RealHolder2 count: 150M / 1000M = 15%.
  assert.equal(result.score, 15);
  assert.match(result.reasons[0], /15\.0%/);
  assert.match(result.reasons[0], /top 2/);
});

test("scores moderate risk in the 30-50% band", () => {
  const result = scoreHolderConcentration(
    baseInput({
      totalSupply: 1_000_000_000n,
      holders: [{ address: "H1", amount: 400_000_000n }],
    }),
  );
  assert.equal(result.score, 55);
});

test("only considers the top 10 remaining holders even if more are supplied", () => {
  const holders = Array.from({ length: 15 }, (_, i) => ({
    address: `Holder${i}`,
    amount: 10_000_000n,
  }));
  const result = scoreHolderConcentration(baseInput({ totalSupply: 1_000_000_000n, holders }));
  // 10 * 10M / 1000M = 10%
  assert.equal(result.score, 10);
  assert.match(result.reasons[0], /top 10/);
});

test("returns a zero score with a reason when total supply is zero", () => {
  const result = scoreHolderConcentration(baseInput({ totalSupply: 0n }));
  assert.equal(result.score, 0);
  assert.match(result.reasons[0], /zero/);
});

test("boundary: exactly 50% share counts as high risk", () => {
  const result = scoreHolderConcentration(
    baseInput({
      totalSupply: 1_000_000_000n,
      holders: [{ address: "H1", amount: 500_000_000n }],
    }),
  );
  assert.equal(result.score, 90);
  assert.match(result.reasons[0], />= 50%/);
});

test("boundary: exactly 30% share counts as moderate risk", () => {
  const result = scoreHolderConcentration(
    baseInput({
      totalSupply: 1_000_000_000n,
      holders: [{ address: "H1", amount: 300_000_000n }],
    }),
  );
  assert.equal(result.score, 55);
  assert.match(result.reasons[0], /30-50%/);
});
