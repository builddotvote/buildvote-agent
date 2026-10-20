import test from "node:test";
import assert from "node:assert/strict";
import { pollOnce } from "./poller.js";
import { LiveFeed } from "./feed.js";
import { ScoringGate } from "./scoringGate.js";
import { ScoringInFlight } from "./scoringInFlight.js";
import { PUMP_FUN_PROGRAM_ID } from "./pumpfun.js";
import { base58Encode } from "./base58.js";
import type { ParsedTransaction, SignatureInfo } from "./rpc.js";

const CREATE_DISCRIMINATOR = [24, 30, 200, 40, 5, 28, 7, 119];
const MINT = "Mint1111111111111111111111111111111111111";
const BONDING_CURVE = "BondingCurve11111111111111111111111111111";
const DEPLOYER = "Deployer111111111111111111111111111111111";

const CREATE_ACCOUNTS = [
  MINT,
  "Filler1Program11111111111111111111111111",
  BONDING_CURVE,
  "Filler3Program11111111111111111111111111",
  "Filler4Program11111111111111111111111111",
  "Filler5Program11111111111111111111111111",
  "Filler6Program11111111111111111111111111",
  DEPLOYER,
];

function createTx(): ParsedTransaction {
  const data = base58Encode(Buffer.concat([Buffer.from(CREATE_DISCRIMINATOR), Buffer.alloc(4)]));
  return {
    slot: 1,
    blockTime: 1700000100,
    transaction: {
      signatures: ["sigCreate"],
      message: {
        accountKeys: CREATE_ACCOUNTS.map((pubkey) => ({ pubkey, signer: false, writable: true })),
        instructions: [{ programId: PUMP_FUN_PROGRAM_ID, accounts: CREATE_ACCOUNTS, data }],
      },
    },
    meta: { err: null, fee: 5000, preBalances: [], postBalances: [] },
  };
}

function bondingCurveAccountData(): [string, string] {
  const buf = Buffer.alloc(8 + 5 * 8 + 1 + 32);
  return [buf.toString("base64"), "base64"];
}

// Serves both the discovery poll (address = pump.fun program) and the
// per-signal lookups (address = deployer / bonding curve), keyed by address.
function fakeRpc(programSignatures: SignatureInfo[]) {
  return {
    async getTokenSupply() {
      return { amount: "1000000000", decimals: 6, uiAmount: 1000, uiAmountString: "1000" };
    },
    async getTokenLargestAccounts() {
      return [{ address: BONDING_CURVE, amount: "500000000", decimals: 6, uiAmount: 500, uiAmountString: "500" }];
    },
    async getAccountInfo() {
      return {
        data: bondingCurveAccountData(),
        executable: false,
        lamports: 1,
        owner: PUMP_FUN_PROGRAM_ID,
        rentEpoch: 0,
      };
    },
    async getSignaturesForAddress(address: string, limit: number) {
      if (address === PUMP_FUN_PROGRAM_ID) return programSignatures.slice(0, limit);
      return [];
    },
    async getTransaction(signature: string) {
      return signature === "sigCreate" ? createTx() : null;
    },
  };
}

test("first poll seeds the watermark and scores nothing", async () => {
  const signatures: SignatureInfo[] = [
    { signature: "sigNewest", slot: 1, err: null, memo: null, blockTime: 1700000000 },
  ];
  const feed = new LiveFeed();
  const state = { sinceBlockTime: null };

  await pollOnce(fakeRpc(signatures), fakeRpc(signatures), feed, state);

  assert.equal(state.sinceBlockTime, 1700000000);
  assert.deepEqual(feed.list(), []);
});

test("a later poll scores newly discovered launches into the feed", async () => {
  const signatures: SignatureInfo[] = [
    { signature: "sigCreate", slot: 2, err: null, memo: null, blockTime: 1700000100 },
  ];
  const feed = new LiveFeed();
  const state = { sinceBlockTime: 1700000000 };

  await pollOnce(fakeRpc(signatures), fakeRpc(signatures), feed, state);

  assert.equal(state.sinceBlockTime, 1700000100);
  assert.equal(feed.list().length, 1);
  assert.equal(feed.list()[0].mint, MINT);
});

test("a full scoring gate drops the launch instead of scoring it", async () => {
  const signatures: SignatureInfo[] = [
    { signature: "sigCreate", slot: 2, err: null, memo: null, blockTime: 1700000100 },
  ];
  const feed = new LiveFeed();
  const state = { sinceBlockTime: 1700000000 };
  const gate = new ScoringGate(0);

  await pollOnce(fakeRpc(signatures), fakeRpc(signatures), feed, state, undefined, gate);

  assert.equal(state.sinceBlockTime, 1700000100);
  assert.deepEqual(feed.list(), []);
});

test("a launch already in the feed (e.g. scored by the watcher) is skipped, not re-scored", async () => {
  const signatures: SignatureInfo[] = [
    { signature: "sigCreate", slot: 2, err: null, memo: null, blockTime: 1700000100 },
  ];
  const feed = new LiveFeed();
  const state = { sinceBlockTime: 1700000000 };
  const gate = new ScoringGate(1);
  let scoringCalls = 0;
  const rpc = fakeRpc(signatures);
  const countingRpc = {
    ...rpc,
    async getAccountInfo(...args: Parameters<typeof rpc.getAccountInfo>) {
      scoringCalls++;
      return rpc.getAccountInfo(...args);
    },
  };
  feed.add({ mint: MINT, score: 10, signals: [{ name: "liquidity", score: 10, reasons: ["seeded"] }] });

  await pollOnce(fakeRpc(signatures), countingRpc, feed, state, undefined, gate);

  assert.equal(scoringCalls, 0);
  assert.equal(feed.list().length, 1);
  assert.equal(feed.list()[0].score, 10);
  // The gate slot was never touched, so it's still free for a real new launch.
  assert.equal(gate.tryAcquire(), true);
});

test("a scoring gate with room releases its slot after scoring", async () => {
  const signatures: SignatureInfo[] = [
    { signature: "sigCreate", slot: 2, err: null, memo: null, blockTime: 1700000100 },
  ];
  const feed = new LiveFeed();
  const state = { sinceBlockTime: 1700000000 };
  const gate = new ScoringGate(1);

  await pollOnce(fakeRpc(signatures), fakeRpc(signatures), feed, state, undefined, gate);

  assert.equal(feed.list().length, 1);
  // Slot released after use: a second cycle with a new launch still scores.
  assert.equal(gate.tryAcquire(), true);
});

test("a launch already claimed by the watcher's in-flight score is skipped, not re-scored", async () => {
  const signatures: SignatureInfo[] = [
    { signature: "sigCreate", slot: 2, err: null, memo: null, blockTime: 1700000100 },
  ];
  const feed = new LiveFeed();
  const state = { sinceBlockTime: 1700000000 };
  const gate = new ScoringGate(1);
  const inFlight = new ScoringInFlight();
  // Simulates the watcher having already claimed this mint and still being
  // mid-score (not yet in the feed) when the poller's own scan finds it too.
  inFlight.tryAcquire(MINT);
  let scoringCalls = 0;
  const rpc = fakeRpc(signatures);
  const countingRpc = {
    ...rpc,
    async getAccountInfo(...args: Parameters<typeof rpc.getAccountInfo>) {
      scoringCalls++;
      return rpc.getAccountInfo(...args);
    },
  };

  await pollOnce(fakeRpc(signatures), countingRpc, feed, state, undefined, gate, inFlight);

  assert.equal(scoringCalls, 0);
  assert.deepEqual(feed.list(), []);
  // The gate slot was never touched, since the in-flight check short-circuits first.
  assert.equal(gate.tryAcquire(), true);
});

test("a mint released from in-flight by another path can be scored on a later poll", async () => {
  const signatures: SignatureInfo[] = [
    { signature: "sigCreate", slot: 2, err: null, memo: null, blockTime: 1700000100 },
  ];
  const feed = new LiveFeed();
  const state = { sinceBlockTime: 1700000000 };
  const inFlight = new ScoringInFlight();
  inFlight.tryAcquire(MINT);
  inFlight.release(MINT);

  await pollOnce(fakeRpc(signatures), fakeRpc(signatures), feed, state, undefined, undefined, inFlight);

  assert.equal(feed.list().length, 1);
  // The poller releases its own claim after scoring, so the mint isn't left stuck.
  assert.equal(inFlight.tryAcquire(MINT), true);
});

test("onScored fires with the launch once it's actually kept in the feed", async () => {
  const signatures: SignatureInfo[] = [
    { signature: "sigCreate", slot: 2, err: null, memo: null, blockTime: 1700000100 },
  ];
  const feed = new LiveFeed();
  const state = { sinceBlockTime: 1700000000 };
  const scored: string[] = [];

  await pollOnce(fakeRpc(signatures), fakeRpc(signatures), feed, state, undefined, undefined, undefined, (launch) =>
    scored.push(launch.mint),
  );

  assert.deepEqual(scored, [MINT]);
});

test("an overlapping pollOnce call on the same state is dropped, not run concurrently", async () => {
  const signatures: SignatureInfo[] = [
    { signature: "sigCreate", slot: 2, err: null, memo: null, blockTime: 1700000100 },
  ];
  const feed = new LiveFeed();
  const state = { sinceBlockTime: 1700000000 };
  const rpc = fakeRpc(signatures);
  let getSignaturesCalls = 0;
  let resolveSignatures!: (value: SignatureInfo[]) => void;
  // Simulates server.ts's setInterval firing the next poll() tick before the
  // first call's findNewLaunches has resolved — e.g. a slow
  // resolve-with-retry chain on one signature (discovery.ts). The first
  // call's getSignaturesForAddress is deliberately left unresolved so the
  // second call has every chance to race it if the guard didn't exist.
  const gatedRpc = {
    ...rpc,
    async getSignaturesForAddress(): Promise<SignatureInfo[]> {
      getSignaturesCalls++;
      return new Promise((resolve) => {
        resolveSignatures = resolve;
      });
    },
  };

  const first = pollOnce(gatedRpc, rpc, feed, state);
  const second = pollOnce(gatedRpc, rpc, feed, state);
  await second;

  // The overlapping call returned immediately without touching the RPC or
  // the watermark at all — not a second, independent scan.
  assert.equal(getSignaturesCalls, 1);
  assert.equal(state.sinceBlockTime, 1700000000);

  resolveSignatures(signatures);
  await first;

  // The first call's own result is unaffected by the dropped overlap.
  assert.equal(state.sinceBlockTime, 1700000100);
  assert.equal(feed.list().length, 1);
});

test("the in-flight guard clears after a call finishes, so a later poll still runs", async () => {
  const signatures: SignatureInfo[] = [
    { signature: "sigCreate", slot: 2, err: null, memo: null, blockTime: 1700000100 },
  ];
  const feed = new LiveFeed();
  const state = { sinceBlockTime: 1700000000 };

  await pollOnce(fakeRpc(signatures), fakeRpc(signatures), feed, state);
  assert.equal(feed.list().length, 1);

  // Same signature, newer blockTime: resolves without a retry-on-not-found
  // (fakeRpc's getTransaction already knows "sigCreate"), and feed.has()
  // skips it as already-scored — this call only needs to prove the
  // watermark still advances, i.e. the guard isn't stuck "true" forever.
  const moreSignatures: SignatureInfo[] = [
    { signature: "sigCreate", slot: 3, err: null, memo: null, blockTime: 1700000200 },
  ];
  await pollOnce(fakeRpc(moreSignatures), fakeRpc(moreSignatures), feed, state);

  assert.equal(state.sinceBlockTime, 1700000200);
});

test("onScored does not fire for a launch feed.add() dropped (zero signals)", async () => {
  const signatures: SignatureInfo[] = [
    { signature: "sigCreate", slot: 2, err: null, memo: null, blockTime: 1700000100 },
  ];
  const feed = new LiveFeed();
  const state = { sinceBlockTime: 1700000000 };
  // Every call the four signals' data-fetchers depend on (besides the
  // discovery scan/resolve, which uses the separate discoveryRpc below and
  // must keep succeeding to find the launch at all) fails — so every signal
  // fails to fetch and scoreLaunch returns zero signals, same as a real
  // all-429 launch (see feed.ts's "add() drops a zero-signal launch" test).
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

  await pollOnce(
    fakeRpc(signatures),
    allFailingScoringRpc,
    feed,
    state,
    undefined,
    undefined,
    undefined,
    () => scoredCalls++,
  );

  assert.deepEqual(feed.list(), []);
  assert.equal(scoredCalls, 0);
});
