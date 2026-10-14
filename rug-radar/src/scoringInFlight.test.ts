import { test } from "node:test";
import assert from "node:assert/strict";
import { ScoringInFlight } from "./scoringInFlight.js";

test("claims a mint not already in flight", () => {
  const inFlight = new ScoringInFlight();
  assert.equal(inFlight.tryAcquire("mintA"), true);
});

test("rejects a mint already claimed by another in-flight score", () => {
  const inFlight = new ScoringInFlight();
  inFlight.tryAcquire("mintA");
  assert.equal(inFlight.tryAcquire("mintA"), false);
});

test("different mints don't contend with each other", () => {
  const inFlight = new ScoringInFlight();
  assert.equal(inFlight.tryAcquire("mintA"), true);
  assert.equal(inFlight.tryAcquire("mintB"), true);
});

test("release frees the mint for a later acquire", () => {
  const inFlight = new ScoringInFlight();
  inFlight.tryAcquire("mintA");
  assert.equal(inFlight.tryAcquire("mintA"), false);
  inFlight.release("mintA");
  assert.equal(inFlight.tryAcquire("mintA"), true);
});
