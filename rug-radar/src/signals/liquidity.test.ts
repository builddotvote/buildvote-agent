import test from "node:test";
import assert from "node:assert/strict";
import { scoreLiquidity } from "./liquidity.js";

const LAMPORTS_PER_SOL = 1_000_000_000n;

test("scores low risk when the curve has graduated", () => {
  const result = scoreLiquidity({ complete: true, realSolReserves: 0n });
  assert.equal(result.name, "liquidity");
  assert.equal(result.score, 10);
  assert.match(result.reasons[0], /migrated to an AMM/);
});

test("scores high risk when still bonding with thin liquidity", () => {
  const result = scoreLiquidity({ complete: false, realSolReserves: 2n * LAMPORTS_PER_SOL });
  assert.equal(result.score, 80);
  assert.match(result.reasons[0], /thin real liquidity/);
});

test("scores moderate risk with moderate liquidity", () => {
  const result = scoreLiquidity({ complete: false, realSolReserves: 10n * LAMPORTS_PER_SOL });
  assert.equal(result.score, 45);
  assert.match(result.reasons[0], /moderate real liquidity/);
});

test("scores lower risk when deep in the curve and approaching graduation", () => {
  const result = scoreLiquidity({ complete: false, realSolReserves: 40n * LAMPORTS_PER_SOL });
  assert.equal(result.score, 20);
  assert.match(result.reasons[0], /deep real liquidity/);
});

test("boundary: exactly the low-liquidity threshold still counts as thin", () => {
  const result = scoreLiquidity({ complete: false, realSolReserves: 5n * LAMPORTS_PER_SOL });
  assert.equal(result.score, 80);
});

test("boundary: exactly the moderate-liquidity threshold still counts as moderate", () => {
  const result = scoreLiquidity({ complete: false, realSolReserves: 15n * LAMPORTS_PER_SOL });
  assert.equal(result.score, 45);
  assert.match(result.reasons[0], /moderate real liquidity/);
});
