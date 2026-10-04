import { test } from "node:test";
import assert from "node:assert/strict";
import { ScoringGate } from "./scoringGate.js";

test("allows acquiring up to the cap", () => {
  const gate = new ScoringGate(2);
  assert.equal(gate.tryAcquire(), true);
  assert.equal(gate.tryAcquire(), true);
});

test("rejects once the cap is reached", () => {
  const gate = new ScoringGate(2);
  gate.tryAcquire();
  gate.tryAcquire();
  assert.equal(gate.tryAcquire(), false);
});

test("release frees a slot for a later acquire", () => {
  const gate = new ScoringGate(1);
  assert.equal(gate.tryAcquire(), true);
  assert.equal(gate.tryAcquire(), false);
  gate.release();
  assert.equal(gate.tryAcquire(), true);
});

test("a cap of 0 rejects immediately", () => {
  const gate = new ScoringGate(0);
  assert.equal(gate.tryAcquire(), false);
});
