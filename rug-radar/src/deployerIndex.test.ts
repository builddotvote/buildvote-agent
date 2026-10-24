import test from "node:test";
import assert from "node:assert/strict";
import { DeployerIndex } from "./deployerIndex.js";

test("returns nothing for a deployer it hasn't seen", () => {
  const index = new DeployerIndex();
  assert.deepEqual(index.getPriorLaunches("Deployer1", "CurrentMint"), []);
});

test("records a launch and returns it as prior history for a later lookup", () => {
  const index = new DeployerIndex();
  index.record({ deployer: "Deployer1", mint: "MintA", bondingCurve: "CurveA" });

  assert.deepEqual(index.getPriorLaunches("Deployer1", "CurrentMint"), [
    { mint: "MintA", bondingCurve: "CurveA" },
  ]);
});

test("excludes the mint currently being scored", () => {
  const index = new DeployerIndex();
  index.record({ deployer: "Deployer1", mint: "MintA", bondingCurve: "CurveA" });

  assert.deepEqual(index.getPriorLaunches("Deployer1", "MintA"), []);
});

test("dedups repeated records of the same mint", () => {
  const index = new DeployerIndex();
  index.record({ deployer: "Deployer1", mint: "MintA", bondingCurve: "CurveA" });
  index.record({ deployer: "Deployer1", mint: "MintA", bondingCurve: "CurveA" });

  assert.equal(index.getPriorLaunches("Deployer1", "CurrentMint").length, 1);
});

test("keeps deployers separate", () => {
  const index = new DeployerIndex();
  index.record({ deployer: "Deployer1", mint: "MintA", bondingCurve: "CurveA" });
  index.record({ deployer: "Deployer2", mint: "MintB", bondingCurve: "CurveB" });

  assert.deepEqual(index.getPriorLaunches("Deployer1", "CurrentMint"), [
    { mint: "MintA", bondingCurve: "CurveA" },
  ]);
  assert.deepEqual(index.getPriorLaunches("Deployer2", "CurrentMint"), [
    { mint: "MintB", bondingCurve: "CurveB" },
  ]);
});

test("evicts the oldest entry once past the max size, across all deployers", () => {
  const index = new DeployerIndex(2);
  index.record({ deployer: "Deployer1", mint: "MintA", bondingCurve: "CurveA" });
  index.record({ deployer: "Deployer1", mint: "MintB", bondingCurve: "CurveB" });
  index.record({ deployer: "Deployer2", mint: "MintC", bondingCurve: "CurveC" });

  // MintA was recorded first, so it's evicted once the 3rd entry pushes past max size 2.
  assert.deepEqual(index.getPriorLaunches("Deployer1", "CurrentMint"), [
    { mint: "MintB", bondingCurve: "CurveB" },
  ]);
  assert.deepEqual(index.getPriorLaunches("Deployer2", "CurrentMint"), [
    { mint: "MintC", bondingCurve: "CurveC" },
  ]);
});

test("re-records a mint after it has aged out of the FIFO, instead of leaving it stuck as absent", () => {
  const index = new DeployerIndex(1);
  index.record({ deployer: "Deployer1", mint: "MintA", bondingCurve: "CurveA" });
  // Pushes the FIFO past its size-1 cap, evicting MintA.
  index.record({ deployer: "Deployer1", mint: "MintB", bondingCurve: "CurveB" });
  assert.deepEqual(index.getPriorLaunches("Deployer1", "CurrentMint"), [
    { mint: "MintB", bondingCurve: "CurveB" },
  ]);

  // Recording MintA again must make it visible again (the eviction deleted
  // it from byDeployer, so mints.has() on the live map correctly sees it as
  // new rather than mistaking it for something already tracked).
  index.record({ deployer: "Deployer1", mint: "MintA", bondingCurve: "CurveA2" });
  assert.deepEqual(index.getPriorLaunches("Deployer1", "CurrentMint"), [
    { mint: "MintA", bondingCurve: "CurveA2" },
  ]);
});
