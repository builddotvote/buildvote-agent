import test from "node:test";
import assert from "node:assert/strict";
import { LaunchWatcher, deriveWsUrl } from "./wsDiscovery.js";
import type { WebSocketLike } from "./wsDiscovery.js";
import type { ParsedTransaction } from "./rpc.js";
import { base58Encode } from "./base58.js";

const PUMP_FUN_PROGRAM_ID = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";

const CREATE_V2_LOGS = [
  "Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P invoke [1]",
  "Program log: Instruction: CreateV2",
  "Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P success",
];

const BUY_ONLY_LOGS = [
  "Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P invoke [1]",
  "Program log: Instruction: BuyV2",
  "Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P success",
];

class FakeWebSocket implements WebSocketLike {
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  sent: string[] = [];
  closed = false;

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
    this.onclose?.({ code: 1000 });
  }

  emitOpen(): void {
    this.onopen?.();
  }

  emitMessage(data: unknown): void {
    this.onmessage?.({ data });
  }

  emitDrop(): void {
    this.onclose?.({ code: 1006 });
  }
}

function subscribeAckFor(ws: FakeWebSocket, sentIndex = 0, subscriptionId = 12345): unknown {
  const req = JSON.parse(ws.sent[sentIndex]);
  return { jsonrpc: "2.0", id: req.id, result: subscriptionId };
}

function logsNotification(
  signature: string,
  logs: string[],
  err: unknown | null = null,
  subscriptionId = 12345,
) {
  return {
    jsonrpc: "2.0",
    method: "logsNotification",
    params: { subscription: subscriptionId, result: { context: { slot: 1 }, value: { signature, err, logs } } },
  };
}

function fakeRpc(getTransactionImpl: (signature: string) => Promise<ParsedTransaction | null>) {
  return { getTransaction: getTransactionImpl };
}

async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function fixtureTx(signature: string) {
  return {
    slot: 1,
    blockTime: 1_700_000_000,
    transaction: {
      signatures: [signature],
      message: {
        accountKeys: [],
        instructions: [
          {
            programId: PUMP_FUN_PROGRAM_ID,
            accounts: [
              "Mint1111111111111111111111111111111111111",
              "Acc2",
              "BondingCurve111111111111111111111111111111",
              "Acc4",
              "Acc5",
              "Acc6",
              "Acc7",
              "Deployer11111111111111111111111111111111111",
            ],
            // base58Encode([24,30,200,40,5,28,7,119]) — the "create" discriminator, no args
            data: "52zoRTfx1nE",
          },
        ],
      },
    },
    meta: { err: null, fee: 5000, preBalances: [], postBalances: [] },
  };
}

test("subscribes with the pump.fun mentions filter on open", () => {
  const sockets: FakeWebSocket[] = [];
  const watcher = new LaunchWatcher("wss://fake", fakeRpc(async () => null), {
    onLaunch: () => {},
    wsFactory: (url) => {
      const ws = new FakeWebSocket();
      sockets.push(ws);
      return ws;
    },
  });

  watcher.start();
  sockets[0].emitOpen();

  const req = JSON.parse(sockets[0].sent[0]);
  assert.equal(req.method, "logsSubscribe");
  assert.deepEqual(req.params[0], { mentions: [PUMP_FUN_PROGRAM_ID] });
  watcher.stop();
});

test("resolves a create notification into onLaunch", async () => {
  const sockets: FakeWebSocket[] = [];
  const launches: unknown[] = [];
  const watcher = new LaunchWatcher(
    "wss://fake",
    fakeRpc(async (sig) => fixtureTx(sig)),
    {
      onLaunch: (l) => launches.push(l),
      wsFactory: (url) => {
        const ws = new FakeWebSocket();
        sockets.push(ws);
        return ws;
      },
    },
  );

  watcher.start();
  const ws = sockets[0];
  ws.emitOpen();
  ws.emitMessage(JSON.stringify(subscribeAckFor(ws)));
  ws.emitMessage(JSON.stringify(logsNotification("sig-create-1", CREATE_V2_LOGS)));

  await flushMicrotasks();

  assert.equal(launches.length, 1);
  assert.deepEqual(launches[0], {
    mint: "Mint1111111111111111111111111111111111111",
    deployer: "Deployer11111111111111111111111111111111111",
    bondingCurve: "BondingCurve111111111111111111111111111111",
    createdAt: 1_700_000_000,
    signature: "sig-create-1",
  });
  watcher.stop();
});

test("ignores non-create notifications without calling getTransaction", async () => {
  const sockets: FakeWebSocket[] = [];
  const launches: unknown[] = [];
  let getTransactionCalls = 0;
  const watcher = new LaunchWatcher(
    "wss://fake",
    fakeRpc(async (sig) => {
      getTransactionCalls++;
      return fixtureTx(sig);
    }),
    {
      onLaunch: (l) => launches.push(l),
      wsFactory: (url) => {
        const ws = new FakeWebSocket();
        sockets.push(ws);
        return ws;
      },
    },
  );

  watcher.start();
  const ws = sockets[0];
  ws.emitOpen();
  ws.emitMessage(JSON.stringify(subscribeAckFor(ws)));
  ws.emitMessage(JSON.stringify(logsNotification("sig-buy-1", BUY_ONLY_LOGS)));

  await flushMicrotasks();

  assert.equal(launches.length, 0);
  assert.equal(getTransactionCalls, 0);
  watcher.stop();
});

test("skips a notification with a transaction-level error", async () => {
  const sockets: FakeWebSocket[] = [];
  const launches: unknown[] = [];
  const watcher = new LaunchWatcher("wss://fake", fakeRpc(async (sig) => fixtureTx(sig)), {
    onLaunch: (l) => launches.push(l),
    wsFactory: (url) => {
      const ws = new FakeWebSocket();
      sockets.push(ws);
      return ws;
    },
  });

  watcher.start();
  const ws = sockets[0];
  ws.emitOpen();
  ws.emitMessage(JSON.stringify(subscribeAckFor(ws)));
  ws.emitMessage(JSON.stringify(logsNotification("sig-failed", CREATE_V2_LOGS, { InstructionError: [0, {}] })));

  await flushMicrotasks();

  assert.equal(launches.length, 0);
  watcher.stop();
});

test("deduplicates a signature seen twice (e.g. redelivered after resubscribe)", async () => {
  const sockets: FakeWebSocket[] = [];
  const launches: unknown[] = [];
  let getTransactionCalls = 0;
  const watcher = new LaunchWatcher(
    "wss://fake",
    fakeRpc(async (sig) => {
      getTransactionCalls++;
      return fixtureTx(sig);
    }),
    {
      onLaunch: (l) => launches.push(l),
      wsFactory: (url) => {
        const ws = new FakeWebSocket();
        sockets.push(ws);
        return ws;
      },
    },
  );

  watcher.start();
  const ws = sockets[0];
  ws.emitOpen();
  ws.emitMessage(JSON.stringify(subscribeAckFor(ws)));
  ws.emitMessage(JSON.stringify(logsNotification("sig-dup", CREATE_V2_LOGS)));
  ws.emitMessage(JSON.stringify(logsNotification("sig-dup", CREATE_V2_LOGS)));

  await flushMicrotasks();

  assert.equal(launches.length, 1);
  assert.equal(getTransactionCalls, 1);
  watcher.stop();
});

test("retries a transiently not-found transaction (RPC replication lag) before resolving", async () => {
  const sockets: FakeWebSocket[] = [];
  const launches: unknown[] = [];
  const sleeps: number[] = [];
  let getTransactionCalls = 0;
  const watcher = new LaunchWatcher(
    "wss://fake",
    fakeRpc(async (sig) => {
      getTransactionCalls++;
      return getTransactionCalls < 3 ? null : fixtureTx(sig);
    }),
    {
      onLaunch: (l) => launches.push(l),
      resolveBaseDelayMs: 25,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      wsFactory: (url) => {
        const ws = new FakeWebSocket();
        sockets.push(ws);
        return ws;
      },
    },
  );

  watcher.start();
  const ws = sockets[0];
  ws.emitOpen();
  ws.emitMessage(JSON.stringify(subscribeAckFor(ws)));
  ws.emitMessage(JSON.stringify(logsNotification("sig-lagged", CREATE_V2_LOGS)));

  await flushMicrotasks();

  assert.equal(getTransactionCalls, 3);
  assert.deepEqual(sleeps, [25, 50]); // exponential backoff: 25*2^0, 25*2^1
  assert.equal(launches.length, 1);
  watcher.stop();
});

test("reconnects and resubscribes after the connection drops", async () => {
  const sockets: FakeWebSocket[] = [];
  const sleeps: number[] = [];
  const watcher = new LaunchWatcher("wss://fake", fakeRpc(async () => null), {
    onLaunch: () => {},
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    reconnectBaseDelayMs: 100,
    wsFactory: (url) => {
      const ws = new FakeWebSocket();
      sockets.push(ws);
      return ws;
    },
  });

  watcher.start();
  sockets[0].emitOpen();
  sockets[0].emitDrop();
  await flushMicrotasks();

  assert.equal(sleeps.length, 1);
  assert.equal(sleeps[0], 100);
  assert.equal(sockets.length, 2, "should have opened a second socket after the drop");

  sockets[1].emitOpen();
  const req = JSON.parse(sockets[1].sent[0]);
  assert.equal(req.method, "logsSubscribe");
  watcher.stop();
});

test("does not reconnect after stop() is called", async () => {
  const sockets: FakeWebSocket[] = [];
  const watcher = new LaunchWatcher("wss://fake", fakeRpc(async () => null), {
    onLaunch: () => {},
    wsFactory: (url) => {
      const ws = new FakeWebSocket();
      sockets.push(ws);
      return ws;
    },
  });

  watcher.start();
  sockets[0].emitOpen();
  watcher.stop();

  assert.equal(sockets[0].closed, true);
  assert.equal(sockets.length, 1, "stop() should not trigger a reconnect");
});

test("deriveWsUrl swaps https for wss and http for ws", () => {
  assert.equal(deriveWsUrl("https://api.mainnet-beta.solana.com"), "wss://api.mainnet-beta.solana.com/");
  assert.equal(deriveWsUrl("http://localhost:8899"), "ws://localhost:8899/");
});

// Encodes discriminator + amount (u64 LE) + trailing filler, matching
// pumpfun.test.ts's own helper for the same real instruction data layout.
function tradeInstructionData(discriminator: number[], amount: bigint, trailingBytes = 9): string {
  const buf = Buffer.alloc(discriminator.length + 8 + trailingBytes);
  Buffer.from(discriminator).copy(buf, 0);
  buf.writeBigUInt64LE(amount, discriminator.length);
  return base58Encode(buf);
}

const BUY_DISCRIMINATOR = [102, 6, 61, 18, 1, 218, 235, 234];

function tradeFixtureTx(signature: string, mint: string, bondingCurve: string, user: string, amount: bigint) {
  return {
    slot: 1,
    blockTime: 1_700_000_001,
    transaction: {
      signatures: [signature],
      message: {
        accountKeys: [],
        instructions: [
          {
            programId: PUMP_FUN_PROGRAM_ID,
            // TRADE_ACCOUNT_INDEX (pumpfun.ts): mint at 2, bondingCurve at 3, user at 6.
            accounts: ["Acc0", "Acc1", mint, bondingCurve, "Acc4", "Acc5", user],
            data: tradeInstructionData(BUY_DISCRIMINATOR, amount),
          },
        ],
      },
    },
    meta: { err: null, fee: 5000, preBalances: [], postBalances: [] },
  };
}

test("trackMint subscribes to the mint's own bonding curve once connected", () => {
  const sockets: FakeWebSocket[] = [];
  const watcher = new LaunchWatcher("wss://fake", fakeRpc(async () => null), {
    onLaunch: () => {},
    wsFactory: (url) => {
      const ws = new FakeWebSocket();
      sockets.push(ws);
      return ws;
    },
  });

  watcher.start();
  sockets[0].emitOpen();
  watcher.trackMint("Mint1", "BondingCurve1");

  assert.equal(sockets[0].sent.length, 2);
  const req = JSON.parse(sockets[0].sent[1]);
  assert.equal(req.method, "logsSubscribe");
  assert.deepEqual(req.params[0], { mentions: ["BondingCurve1"] });
  watcher.stop();
});

test("mints tracked before connecting are subscribed alongside the program on open", () => {
  const sockets: FakeWebSocket[] = [];
  const watcher = new LaunchWatcher("wss://fake", fakeRpc(async () => null), {
    onLaunch: () => {},
    wsFactory: (url) => {
      const ws = new FakeWebSocket();
      sockets.push(ws);
      return ws;
    },
  });

  watcher.trackMint("Mint1", "BondingCurve1");
  watcher.start();
  sockets[0].emitOpen();

  assert.equal(sockets[0].sent.length, 2);
  assert.deepEqual(JSON.parse(sockets[0].sent[0]).params[0], { mentions: [PUMP_FUN_PROGRAM_ID] });
  assert.deepEqual(JSON.parse(sockets[0].sent[1]).params[0], { mentions: ["BondingCurve1"] });
  watcher.stop();
});

test("resolves a trade notification for a tracked mint into onTrade", async () => {
  const sockets: FakeWebSocket[] = [];
  const trades: unknown[] = [];
  const mint = "Mint11111111111111111111111111111111111111";
  const bondingCurve = "BondingCurve111111111111111111111111111111";
  const user = "Buyer111111111111111111111111111111111111";
  const watcher = new LaunchWatcher(
    "wss://fake",
    fakeRpc(async (sig) => tradeFixtureTx(sig, mint, bondingCurve, user, 123n)),
    {
      onLaunch: () => {},
      onTrade: (t) => trades.push(t),
      wsFactory: (url) => {
        const ws = new FakeWebSocket();
        sockets.push(ws);
        return ws;
      },
    },
  );

  watcher.start();
  const ws = sockets[0];
  ws.emitOpen();
  ws.emitMessage(JSON.stringify(subscribeAckFor(ws, 0, 12345)));
  watcher.trackMint(mint, bondingCurve);
  ws.emitMessage(JSON.stringify(subscribeAckFor(ws, 1, 67890)));
  ws.emitMessage(JSON.stringify(logsNotification("sig-buy-1", BUY_ONLY_LOGS, null, 67890)));

  await flushMicrotasks();

  assert.equal(trades.length, 1);
  assert.deepEqual(trades[0], { kind: "buy", mint, bondingCurve, user, amount: 123n });
  watcher.stop();
});

test("a trade is still resolved when the program-wide subscription sees the same signature first", async () => {
  // Regression test (found live, session 35): a buy/sell transaction
  // mentions both the program and the mint's own bonding curve, so the real
  // server pushes it on *both* subscriptions. The program-wide one arrives
  // here first and is checked for a create (it isn't one, so nothing
  // happens) — that must not block the mint-specific notification for the
  // same signature from still reaching onTrade.
  const sockets: FakeWebSocket[] = [];
  const trades: unknown[] = [];
  const mint = "Mint11111111111111111111111111111111111111";
  const bondingCurve = "BondingCurve111111111111111111111111111111";
  const user = "Buyer111111111111111111111111111111111111";
  const watcher = new LaunchWatcher(
    "wss://fake",
    fakeRpc(async (sig) => tradeFixtureTx(sig, mint, bondingCurve, user, 123n)),
    {
      onLaunch: () => {},
      onTrade: (t) => trades.push(t),
      wsFactory: (url) => {
        const ws = new FakeWebSocket();
        sockets.push(ws);
        return ws;
      },
    },
  );

  watcher.start();
  const ws = sockets[0];
  ws.emitOpen();
  ws.emitMessage(JSON.stringify(subscribeAckFor(ws, 0, 12345)));
  watcher.trackMint(mint, bondingCurve);
  ws.emitMessage(JSON.stringify(subscribeAckFor(ws, 1, 67890)));
  ws.emitMessage(JSON.stringify(logsNotification("sig-both", BUY_ONLY_LOGS, null, 12345)));
  ws.emitMessage(JSON.stringify(logsNotification("sig-both", BUY_ONLY_LOGS, null, 67890)));

  await flushMicrotasks();

  assert.equal(trades.length, 1);
  assert.deepEqual(trades[0], { kind: "buy", mint, bondingCurve, user, amount: 123n });
  watcher.stop();
});

test("a create-only notification on a tracked mint's subscription does not call onTrade", async () => {
  const sockets: FakeWebSocket[] = [];
  const trades: unknown[] = [];
  let getTransactionCalls = 0;
  const mint = "Mint11111111111111111111111111111111111111";
  const bondingCurve = "BondingCurve111111111111111111111111111111";
  const watcher = new LaunchWatcher(
    "wss://fake",
    fakeRpc(async (sig) => {
      getTransactionCalls++;
      return tradeFixtureTx(sig, mint, bondingCurve, "User1", 1n);
    }),
    {
      onLaunch: () => {},
      onTrade: (t) => trades.push(t),
      wsFactory: (url) => {
        const ws = new FakeWebSocket();
        sockets.push(ws);
        return ws;
      },
    },
  );

  watcher.start();
  const ws = sockets[0];
  ws.emitOpen();
  ws.emitMessage(JSON.stringify(subscribeAckFor(ws, 0, 12345)));
  watcher.trackMint(mint, bondingCurve);
  ws.emitMessage(JSON.stringify(subscribeAckFor(ws, 1, 67890)));
  ws.emitMessage(JSON.stringify(logsNotification("sig-create", CREATE_V2_LOGS, null, 67890)));

  await flushMicrotasks();

  assert.equal(trades.length, 0);
  assert.equal(getTransactionCalls, 0);
  watcher.stop();
});

test("untrackMint unsubscribes and stops routing further notifications for that mint", async () => {
  const sockets: FakeWebSocket[] = [];
  const trades: unknown[] = [];
  const mint = "Mint11111111111111111111111111111111111111";
  const bondingCurve = "BondingCurve111111111111111111111111111111";
  const watcher = new LaunchWatcher(
    "wss://fake",
    fakeRpc(async (sig) => tradeFixtureTx(sig, mint, bondingCurve, "User1", 1n)),
    {
      onLaunch: () => {},
      onTrade: (t) => trades.push(t),
      wsFactory: (url) => {
        const ws = new FakeWebSocket();
        sockets.push(ws);
        return ws;
      },
    },
  );

  watcher.start();
  const ws = sockets[0];
  ws.emitOpen();
  ws.emitMessage(JSON.stringify(subscribeAckFor(ws, 0, 12345)));
  watcher.trackMint(mint, bondingCurve);
  ws.emitMessage(JSON.stringify(subscribeAckFor(ws, 1, 67890)));

  watcher.untrackMint(mint);

  const unsubReq = JSON.parse(ws.sent[2]);
  assert.equal(unsubReq.method, "logsUnsubscribe");
  assert.deepEqual(unsubReq.params, [67890]);

  ws.emitMessage(JSON.stringify(logsNotification("sig-after-untrack", BUY_ONLY_LOGS, null, 67890)));
  await flushMicrotasks();

  assert.equal(trades.length, 0);
  watcher.stop();
});

test("resubscribes tracked mints after a reconnect", async () => {
  const sockets: FakeWebSocket[] = [];
  const watcher = new LaunchWatcher("wss://fake", fakeRpc(async () => null), {
    onLaunch: () => {},
    sleep: async () => {},
    reconnectBaseDelayMs: 100,
    wsFactory: (url) => {
      const ws = new FakeWebSocket();
      sockets.push(ws);
      return ws;
    },
  });

  watcher.start();
  sockets[0].emitOpen();
  sockets[0].emitMessage(JSON.stringify(subscribeAckFor(sockets[0], 0, 12345)));
  watcher.trackMint("Mint1", "BondingCurve1");
  sockets[0].emitDrop();
  await flushMicrotasks();

  sockets[1].emitOpen();
  assert.equal(sockets[1].sent.length, 2);
  assert.deepEqual(JSON.parse(sockets[1].sent[0]).params[0], { mentions: [PUMP_FUN_PROGRAM_ID] });
  assert.deepEqual(JSON.parse(sockets[1].sent[1]).params[0], { mentions: ["BondingCurve1"] });
  watcher.stop();
});
