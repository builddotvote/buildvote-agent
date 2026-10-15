import test from "node:test";
import assert from "node:assert/strict";
import { handleDiscoveredLaunch } from "./watcherOnLaunch.js";
import { LiveFeed } from "./feed.js";
import { ScoringGate } from "./scoringGate.js";
import { ScoringInFlight } from "./scoringInFlight.js";
import type { DiscoveredLaunch } from "./discovery.js";

const LAUNCH: DiscoveredLaunch = {
  mint: "Mint1111111111111111111111111111111111111",
  deployer: "Deployer111111111111111111111111111111111",
  bondingCurve: "BondingCurve11111111111111111111111111111",
  createdAt: 1700000000,
  signature: "sigCreate",
};

function bondingCurveAccountData(): [string, string] {
  const buf = Buffer.alloc(8 + 5 * 8 + 1 + 32);
  return [buf.toString("base64"), "base64"];
}

function fakeScoringRpc() {
  return {
    async getTokenSupply() {
      return { amount: "1000000000", decimals: 6, uiAmount: 1000, uiAmountString: "1000" };
    },
    async getTokenLargestAccounts() {
      return [{ address: LAUNCH.bondingCurve, amount: "500000000", decimals: 6, uiAmount: 500, uiAmountString: "500" }];
    },
    async getAccountInfo() {
      return {
        data: bondingCurveAccountData(),
        executable: false,
        lamports: 1,
        owner: "11111111111111111111111111111111111111111",
        rentEpoch: 0,
      };
    },
    async getSignaturesForAddress() {
      return [];
    },
    async getTransaction() {
      return null;
    },
  };
}

// scoreLaunch's own RPC calls below all resolve on an already-settled
// promise, so one microtask-queue drain (no real timers) is enough to let
// handleDiscoveredLaunch's internal .then()/.finally() chain run to completion.
async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

test("scores a new launch into the feed and fires onScored", async () => {
  const feed = new LiveFeed();
  const scored: string[] = [];

  handleDiscoveredLaunch(LAUNCH, {
    feed,
    scoringRpc: fakeScoringRpc(),
    onScored: (launch) => scored.push(launch.mint),
  });
  await flushMicrotasks();

  assert.equal(feed.list().length, 1);
  assert.equal(feed.list()[0].mint, LAUNCH.mint);
  assert.deepEqual(scored, [LAUNCH.mint]);
});

test("a launch already in the feed is skipped without any scoring call", async () => {
  const feed = new LiveFeed();
  feed.add({ mint: LAUNCH.mint, score: 10, signals: [{ name: "liquidity", score: 10, reasons: ["seeded"] }] });
  let scoringCalls = 0;
  const rpc = fakeScoringRpc();
  const countingRpc = {
    ...rpc,
    async getAccountInfo(...args: Parameters<typeof rpc.getAccountInfo>) {
      scoringCalls++;
      return rpc.getAccountInfo(...args);
    },
  };

  handleDiscoveredLaunch(LAUNCH, { feed, scoringRpc: countingRpc });
  await flushMicrotasks();

  assert.equal(scoringCalls, 0);
  assert.equal(feed.list()[0].score, 10);
});

test("a full scoring gate drops the launch instead of scoring it", async () => {
  const feed = new LiveFeed();
  const gate = new ScoringGate(0);

  handleDiscoveredLaunch(LAUNCH, { feed, scoringRpc: fakeScoringRpc(), scoringGate: gate });
  await flushMicrotasks();

  assert.deepEqual(feed.list(), []);
});

test("a mint already claimed by the poller's in-flight score is skipped, not re-scored", async () => {
  const feed = new LiveFeed();
  const gate = new ScoringGate(1);
  const inFlight = new ScoringInFlight();
  // Simulates the poller having already claimed this mint and still being
  // mid-score (not yet in the feed) when the watcher sees the same launch.
  inFlight.tryAcquire(LAUNCH.mint);
  let scoringCalls = 0;
  const rpc = fakeScoringRpc();
  const countingRpc = {
    ...rpc,
    async getAccountInfo(...args: Parameters<typeof rpc.getAccountInfo>) {
      scoringCalls++;
      return rpc.getAccountInfo(...args);
    },
  };

  handleDiscoveredLaunch(LAUNCH, {
    feed,
    scoringRpc: countingRpc,
    scoringGate: gate,
    scoringInFlight: inFlight,
  });
  await flushMicrotasks();

  assert.equal(scoringCalls, 0);
  assert.deepEqual(feed.list(), []);
  // The gate slot was never touched, since the in-flight check short-circuits first.
  assert.equal(gate.tryAcquire(), true);
});

test("the scoring gate slot and in-flight claim are both released after scoring", async () => {
  const feed = new LiveFeed();
  const gate = new ScoringGate(1);
  const inFlight = new ScoringInFlight();

  handleDiscoveredLaunch(LAUNCH, {
    feed,
    scoringRpc: fakeScoringRpc(),
    scoringGate: gate,
    scoringInFlight: inFlight,
  });
  await flushMicrotasks();

  assert.equal(feed.list().length, 1);
  assert.equal(gate.tryAcquire(), true);
  assert.equal(inFlight.tryAcquire(LAUNCH.mint), true);
});

// scoreLaunch itself never rejects (each signal's fetch is caught
// internally, see pipeline.ts's safeSignal) — an all-429 launch surfaces as
// a resolved zero-signal score, not a rejection. This is the realistic
// shape of "scoring this launch didn't work out", so it's what exercises
// handleDiscoveredLaunch's cleanup path, not a synthetic throw.
test("a launch where every signal fails releases the gate/in-flight claim and never fires onScored", async () => {
  const feed = new LiveFeed();
  const gate = new ScoringGate(1);
  const inFlight = new ScoringInFlight();
  const allFailingScoringRpc = {
    async getSignaturesForAddress(): Promise<never> {
      throw new Error("429");
    },
    async getTokenSupply(): Promise<never> {
      throw new Error("429");
    },
    async getTokenLargestAccounts(): Promise<never> {
      throw new Error("429");
    },
    async getAccountInfo(): Promise<never> {
      throw new Error("429");
    },
    async getTransaction(): Promise<never> {
      throw new Error("429");
    },
  };
  let scoredCalls = 0;

  handleDiscoveredLaunch(LAUNCH, {
    feed,
    scoringRpc: allFailingScoringRpc,
    scoringGate: gate,
    scoringInFlight: inFlight,
    onScored: () => scoredCalls++,
  });
  await flushMicrotasks();

  assert.deepEqual(feed.list(), []);
  assert.equal(scoredCalls, 0);
  assert.equal(gate.tryAcquire(), true);
  assert.equal(inFlight.tryAcquire(LAUNCH.mint), true);
});
