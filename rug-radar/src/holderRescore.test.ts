import test from "node:test";
import assert from "node:assert/strict";
import { scheduleHolderRescore } from "./holderRescore.js";
import { LiveFeed } from "./feed.js";
import { BalanceIndex } from "./balanceIndex.js";
import { base58Decode } from "./base58.js";
import type { DiscoveredLaunch } from "./discovery.js";

const LAUNCH: DiscoveredLaunch = {
  mint: "Mint1111111111111111111111111111111111111",
  deployer: "Deployer111111111111111111111111111111111",
  bondingCurve: "BondingCurve11111111111111111111111111111",
  createdAt: 1700000000,
  signature: "sigCreate",
};

function fixtureAccountData(tokenTotalSupply: bigint): [string, string] {
  const buf = Buffer.alloc(8 + 5 * 8 + 1 + 32);
  let offset = 8 + 4 * 8;
  buf.writeBigUInt64LE(tokenTotalSupply, offset); // token_total_supply
  offset += 8;
  buf.writeUInt8(0, offset); // complete
  offset += 1;
  Buffer.from(base58Decode("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")).copy(buf, offset);
  return [buf.toString("base64"), "base64"];
}

function fakeScoringRpc(tokenTotalSupply = 1_000_000n) {
  return {
    getAccountInfo: async () => ({
      data: fixtureAccountData(tokenTotalSupply),
      executable: false,
      lamports: 1,
      owner: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
      rentEpoch: 0,
    }),
  };
}

// Fires the scheduled callback immediately instead of waiting delayMs on a
// real timer, so these tests don't need fake clocks.
function immediateTimeout(): [(callback: () => void, ms: number) => void, number[]] {
  const delays: number[] = [];
  return [
    (callback, ms) => {
      delays.push(ms);
      callback();
    },
    delays,
  ];
}

function fakeWatcher() {
  const tracked: string[] = [];
  const untracked: string[] = [];
  return {
    tracked,
    untracked,
    trackMint: (mint: string) => tracked.push(mint),
    untrackMint: (mint: string) => untracked.push(mint),
  };
}

async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

test("seeds the bundled buy into the balance index before tracking the mint", async () => {
  const feed = new LiveFeed();
  feed.add({ mint: LAUNCH.mint, score: 50, signals: [{ name: "liquidity", score: 50, reasons: ["seeded"] }] });
  const balanceIndex = new BalanceIndex();
  const watcher = fakeWatcher();
  const [setTimeoutFn] = immediateTimeout();
  const launchWithBundledBuy: DiscoveredLaunch = {
    ...LAUNCH,
    bundledBuy: { kind: "buy", mint: LAUNCH.mint, bondingCurve: LAUNCH.bondingCurve, user: "Dev", amount: 1n },
  };

  scheduleHolderRescore(launchWithBundledBuy, {
    feed,
    scoringRpc: fakeScoringRpc(),
    balanceIndex,
    watcher,
    delayMs: 45_000,
    setTimeoutFn,
  });
  await flushMicrotasks();

  // trackMint is called after the seed, so by the time it fires the index
  // already has the dev's bundled buy — observable here because the
  // resulting rescore has a holder to score at all (the "no trades
  // observed" test below confirms it stays null otherwise).
  assert.deepEqual(watcher.tracked, [LAUNCH.mint]);
  assert.deepEqual(watcher.untracked, [LAUNCH.mint]);
  const holderSignal = feed.get(LAUNCH.mint)?.signals.find((s) => s.name === "holder-concentration");
  assert.ok(holderSignal);
  assert.match(holderSignal?.reasons[0] ?? "", /top 1 non-program holder/);
});

test("resolves null and leaves the feed untouched when no trades were observed", async () => {
  const feed = new LiveFeed();
  feed.add({ mint: LAUNCH.mint, score: 50, signals: [{ name: "liquidity", score: 50, reasons: ["seeded"] }] });
  const balanceIndex = new BalanceIndex();
  const watcher = fakeWatcher();
  const [setTimeoutFn] = immediateTimeout();
  let scoringCalls = 0;
  const countingRpc = {
    getAccountInfo: async () => {
      scoringCalls++;
      return fakeScoringRpc().getAccountInfo();
    },
  };

  scheduleHolderRescore(LAUNCH, { feed, scoringRpc: countingRpc, balanceIndex, watcher, delayMs: 45_000, setTimeoutFn });
  await flushMicrotasks();

  // getHolders returns empty before any RPC call happens, so the scoring
  // RPC is never even spent on a launch nothing was observed for.
  assert.equal(scoringCalls, 0);
  assert.equal(feed.get(LAUNCH.mint)?.signals.length, 1);
  assert.deepEqual(watcher.untracked, [LAUNCH.mint]);
});

test("untracks without spending a scoring RPC call once the launch has aged out of the feed", async () => {
  const feed = new LiveFeed();
  const balanceIndex = new BalanceIndex();
  const watcher = fakeWatcher();
  const [setTimeoutFn] = immediateTimeout();
  let scoringCalls = 0;
  const countingRpc = {
    getAccountInfo: async () => {
      scoringCalls++;
      return fakeScoringRpc().getAccountInfo();
    },
  };

  scheduleHolderRescore(LAUNCH, { feed, scoringRpc: countingRpc, balanceIndex, watcher, delayMs: 45_000, setTimeoutFn });
  await flushMicrotasks();

  assert.equal(scoringCalls, 0);
  assert.deepEqual(watcher.untracked, [LAUNCH.mint]);
});

test("replaces the feed entry's holder-concentration signal from observed trades", async () => {
  const feed = new LiveFeed();
  feed.add({
    mint: LAUNCH.mint,
    score: 10,
    signals: [
      { name: "liquidity", score: 10, reasons: ["seeded"] },
      { name: "holder-concentration", score: 5, reasons: ["stale from launch-time RPC"] },
    ],
  });
  const balanceIndex = new BalanceIndex();
  balanceIndex.recordTrade({ kind: "buy", mint: LAUNCH.mint, user: "Whale", amount: 600_000n });
  balanceIndex.recordTrade({ kind: "buy", mint: LAUNCH.mint, user: "Small", amount: 100_000n });
  const watcher = fakeWatcher();
  const [setTimeoutFn] = immediateTimeout();

  scheduleHolderRescore(LAUNCH, {
    feed,
    scoringRpc: fakeScoringRpc(),
    balanceIndex,
    watcher,
    delayMs: 45_000,
    setTimeoutFn,
  });
  await flushMicrotasks();

  const updated = feed.get(LAUNCH.mint);
  assert.ok(updated);
  const holderSignal = updated?.signals.find((s) => s.name === "holder-concentration");
  assert.equal(holderSignal?.score, 90); // 70% of supply in the top holders, >= 50%
  assert.equal(updated?.signals.find((s) => s.name === "liquidity")?.score, 10);
  assert.deepEqual(watcher.untracked, [LAUNCH.mint]);
});

test("a curve account that can't be read resolves null and still untracks, without touching the feed", async () => {
  const feed = new LiveFeed();
  feed.add({ mint: LAUNCH.mint, score: 10, signals: [{ name: "liquidity", score: 10, reasons: ["seeded"] }] });
  const balanceIndex = new BalanceIndex();
  balanceIndex.recordTrade({ kind: "buy", mint: LAUNCH.mint, user: "Whale", amount: 600_000n });
  const watcher = fakeWatcher();
  const [setTimeoutFn] = immediateTimeout();
  const unreadableRpc = { getAccountInfo: async () => null };

  scheduleHolderRescore(LAUNCH, {
    feed,
    scoringRpc: unreadableRpc,
    balanceIndex,
    watcher,
    delayMs: 45_000,
    setTimeoutFn,
  });
  await flushMicrotasks();

  assert.equal(feed.get(LAUNCH.mint)?.signals.length, 1);
  assert.equal(feed.get(LAUNCH.mint)?.signals[0].score, 10);
  assert.deepEqual(watcher.untracked, [LAUNCH.mint]);
});

test("passes delayMs through to the timeout", () => {
  const feed = new LiveFeed();
  const balanceIndex = new BalanceIndex();
  const watcher = fakeWatcher();
  const [setTimeoutFn, delays] = immediateTimeout();

  scheduleHolderRescore(LAUNCH, { feed, scoringRpc: fakeScoringRpc(), balanceIndex, watcher, delayMs: 45_000, setTimeoutFn });

  assert.deepEqual(delays, [45_000]);
});
