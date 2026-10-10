import test from "node:test";
import assert from "node:assert/strict";
import { SolanaRpcClient, RpcError, RequestPacer, safeGetTransaction, type FetchLike } from "./rpc.js";

// All fixtures below mirror real Solana JSON-RPC response shapes
// (https://solana.com/docs/rpc/http). No live network calls happen here.

function fixtureFetch(result: unknown, opts: { error?: { code: number; message: string }; status?: number } = {}): FetchLike {
  return (async () => {
    const payload = opts.error
      ? { jsonrpc: "2.0", id: 1, error: opts.error }
      : { jsonrpc: "2.0", id: 1, result };
    return new Response(JSON.stringify(payload), {
      status: opts.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  }) as FetchLike;
}

interface RecordedCall {
  url: string;
  body: { jsonrpc: string; id: number; method: string; params: unknown[] };
}

function recordingFetch(inner: FetchLike): { fetch: FetchLike; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fetch: FetchLike = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return inner(url, init);
  }) as FetchLike;
  return { fetch, calls };
}

test("getTokenSupply parses the token amount", async () => {
  const client = new SolanaRpcClient(
    "https://example.test/rpc",
    fixtureFetch({
      context: { slot: 123 },
      value: { amount: "1000000000000", decimals: 6, uiAmount: 1000000, uiAmountString: "1000000" },
    }),
  );

  const supply = await client.getTokenSupply("MintAddress1111111111111111111111111111111");
  assert.equal(supply.amount, "1000000000000");
  assert.equal(supply.decimals, 6);
});

test("getTokenLargestAccounts parses the holder list and sends the mint", async () => {
  const { fetch, calls } = recordingFetch(
    fixtureFetch({
      context: { slot: 123 },
      value: [
        { address: "Holder1", amount: "500000000000", decimals: 6, uiAmount: 500000, uiAmountString: "500000" },
        { address: "Holder2", amount: "200000000000", decimals: 6, uiAmount: 200000, uiAmountString: "200000" },
      ],
    }),
  );
  const client = new SolanaRpcClient("https://example.test/rpc", fetch);

  const holders = await client.getTokenLargestAccounts("Mint1");
  assert.equal(holders.length, 2);
  assert.equal(holders[0].address, "Holder1");
  assert.equal(calls[0].body.method, "getTokenLargestAccounts");
  assert.deepEqual(calls[0].body.params, ["Mint1"]);
});

test("getAccountInfo returns null for a nonexistent account", async () => {
  const client = new SolanaRpcClient("https://example.test/rpc", fixtureFetch({ context: { slot: 1 }, value: null }));
  const info = await client.getAccountInfo("Nowhere1111111111111111111111111111111111");
  assert.equal(info, null);
});

test("getAccountInfo returns account data", async () => {
  const client = new SolanaRpcClient(
    "https://example.test/rpc",
    fixtureFetch({
      context: { slot: 1 },
      value: {
        data: ["base64data==", "base64"],
        executable: false,
        lamports: 2039280,
        owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
        rentEpoch: 361,
      },
    }),
  );
  const info = await client.getAccountInfo("Account1111111111111111111111111111111111");
  assert.ok(info);
  assert.equal(info?.owner, "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
});

test("getSignaturesForAddress returns signature history", async () => {
  const client = new SolanaRpcClient(
    "https://example.test/rpc",
    fixtureFetch([
      { signature: "sig1", slot: 100, err: null, memo: null, blockTime: 1700000000, confirmationStatus: "finalized" },
      { signature: "sig2", slot: 90, err: null, memo: null, blockTime: 1699999000, confirmationStatus: "finalized" },
    ]),
  );
  const sigs = await client.getSignaturesForAddress("Deployer111111111111111111111111111111111");
  assert.equal(sigs.length, 2);
  assert.equal(sigs[0].signature, "sig1");
});

test("getSignaturesForAddress sends an until cursor when given one, and omits it otherwise", async () => {
  const { fetch, calls } = recordingFetch(fixtureFetch([]));
  const client = new SolanaRpcClient("https://example.test/rpc", fetch);

  await client.getSignaturesForAddress("Program1111111111111111111111111111111111", 50, "sigCursor");
  assert.deepEqual(calls[0].body.params, [
    "Program1111111111111111111111111111111111",
    { limit: 50, until: "sigCursor" },
  ]);

  await client.getSignaturesForAddress("Program1111111111111111111111111111111111", 50);
  assert.deepEqual(calls[1].body.params, ["Program1111111111111111111111111111111111", { limit: 50 }]);
});

test("getTransaction returns token balance changes", async () => {
  const client = new SolanaRpcClient(
    "https://example.test/rpc",
    fixtureFetch({
      slot: 100,
      blockTime: 1700000000,
      transaction: { signatures: ["sig1"], message: {} },
      meta: {
        err: null,
        fee: 5000,
        preBalances: [1000000, 0],
        postBalances: [995000, 5000],
        preTokenBalances: [],
        postTokenBalances: [
          {
            accountIndex: 1,
            mint: "Mint1",
            owner: "Buyer1",
            uiTokenAmount: { amount: "1000000", decimals: 6, uiAmount: 1, uiAmountString: "1" },
          },
        ],
      },
    }),
  );
  const tx = await client.getTransaction("sig1");
  assert.ok(tx?.meta);
  assert.equal(tx?.meta?.postTokenBalances?.[0]?.owner, "Buyer1");
});

test("throws RpcError on an RPC-level error response", async () => {
  const client = new SolanaRpcClient(
    "https://example.test/rpc",
    fixtureFetch(undefined, { error: { code: -32602, message: "Invalid param: not a valid pubkey" } }),
  );
  await assert.rejects(
    () => client.getTokenSupply("not-a-real-mint"),
    (err: unknown) => err instanceof RpcError && err.code === -32602,
  );
});

test("throws on an HTTP-level error with no retries configured", async () => {
  const client = new SolanaRpcClient("https://example.test/rpc", fixtureFetch(undefined, { status: 429 }), {
    maxRetries: 0,
  });
  await assert.rejects(() => client.getTokenSupply("Mint1"), /RPC HTTP error 429/);
});

test("retries on 429 and succeeds once the rate limit clears", async () => {
  let call = 0;
  const fetchImpl: FetchLike = (async () => {
    call++;
    if (call <= 2) {
      return new Response("", { status: 429 });
    }
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: { context: { slot: 1 }, value: { amount: "1", decimals: 0, uiAmount: 1, uiAmountString: "1" } },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as FetchLike;

  const delays: number[] = [];
  const client = new SolanaRpcClient("https://example.test/rpc", fetchImpl, {
    sleep: async (ms) => {
      delays.push(ms);
    },
  });

  const supply = await client.getTokenSupply("Mint1");
  assert.equal(supply.amount, "1");
  assert.equal(call, 3);
  assert.deepEqual(delays, [300, 600]);
});

test("gives up after maxRetries consecutive 429s and throws", async () => {
  let call = 0;
  const fetchImpl: FetchLike = (async () => {
    call++;
    return new Response("", { status: 429 });
  }) as FetchLike;

  const client = new SolanaRpcClient("https://example.test/rpc", fetchImpl, {
    maxRetries: 2,
    sleep: async () => {},
  });

  await assert.rejects(() => client.getTokenSupply("Mint1"), /RPC HTTP error 429/);
  assert.equal(call, 3); // initial attempt + 2 retries
});

test("caps the number of in-flight requests at maxConcurrent", async () => {
  let active = 0;
  let maxActive = 0;
  const releasers: Array<() => void> = [];
  const fetchImpl: FetchLike = (async () => {
    active++;
    maxActive = Math.max(maxActive, active);
    await new Promise<void>((resolve) => releasers.push(resolve));
    active--;
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: { context: { slot: 1 }, value: { amount: "1", decimals: 0, uiAmount: 1, uiAmountString: "1" } },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as FetchLike;

  const client = new SolanaRpcClient("https://example.test/rpc", fetchImpl, { maxConcurrent: 2 });

  const calls = Promise.all([
    client.getTokenSupply("Mint1"),
    client.getTokenSupply("Mint2"),
    client.getTokenSupply("Mint3"),
    client.getTokenSupply("Mint4"),
  ]);

  // Let the first batch's fetches actually start before releasing any.
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(active, 2);
  releasers.shift()?.();
  releasers.shift()?.();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(active, 2);
  releasers.shift()?.();
  releasers.shift()?.();

  await calls;
  assert.equal(maxActive, 2);
});

test("minIntervalMs spaces consecutive request starts by at least that much", async () => {
  // Uses the real default sleep/clock (not an injected fake): a shared fake
  // "clock" variable bumped synchronously by a fake sleep can't faithfully
  // model concurrent real time (bumping it is an instant side effect, not an
  // actual wait), so asserting on which call landed at which fake timestamp
  // is order-dependent on microtask interleaving, not on pacing being
  // correct. Measuring real elapsed time for a small, fixed interval instead
  // sidesteps that: it only takes tens of ms, well within an offline test's
  // budget, and still fails if pacing is removed or broken.
  let calls = 0;
  const fetchImpl: FetchLike = (async () => {
    calls++;
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: { context: { slot: 1 }, value: { amount: "1", decimals: 0, uiAmount: 1, uiAmountString: "1" } },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as FetchLike;

  const client = new SolanaRpcClient("https://example.test/rpc", fetchImpl, { minIntervalMs: 25 });

  const start = Date.now();
  await Promise.all([
    client.getTokenSupply("Mint1"),
    client.getTokenSupply("Mint2"),
    client.getTokenSupply("Mint3"),
    client.getTokenSupply("Mint4"),
  ]);
  const elapsed = Date.now() - start;

  assert.equal(calls, 4);
  // 4 calls spaced >=25ms apart means >=3 gaps; allow slack for scheduling jitter.
  assert.ok(elapsed >= 70, `expected >=70ms elapsed from pacing, got ${elapsed}ms`);
});

test("minIntervalMs of 0 (the default) does not space requests at all", async () => {
  let calls = 0;
  const fetchImpl: FetchLike = (async () => {
    calls++;
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: { context: { slot: 1 }, value: { amount: "1", decimals: 0, uiAmount: 1, uiAmountString: "1" } },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as FetchLike;

  const client = new SolanaRpcClient("https://example.test/rpc", fetchImpl);
  await Promise.all([client.getTokenSupply("Mint1"), client.getTokenSupply("Mint2")]);
  assert.equal(calls, 2);
});

test("a shared RequestPacer paces two SolanaRpcClient instances to one combined rate", async () => {
  // Same real-timer reasoning as the minIntervalMs test above. Two clients
  // each with their own independent minIntervalMs would combine to roughly
  // double the paced rate (session 42's gap); sharing one RequestPacer
  // instance between them should hold the *combined* call rate to one
  // spacing budget instead.
  let calls = 0;
  const fetchImpl: FetchLike = (async () => {
    calls++;
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: { context: { slot: 1 }, value: { amount: "1", decimals: 0, uiAmount: 1, uiAmountString: "1" } },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as FetchLike;

  const pacer = new RequestPacer(25);
  const clientA = new SolanaRpcClient("https://example.test/rpc", fetchImpl, { pacer });
  const clientB = new SolanaRpcClient("https://example.test/rpc", fetchImpl, { pacer });

  const start = Date.now();
  await Promise.all([
    clientA.getTokenSupply("Mint1"),
    clientB.getTokenSupply("Mint2"),
    clientA.getTokenSupply("Mint3"),
    clientB.getTokenSupply("Mint4"),
  ]);
  const elapsed = Date.now() - start;

  assert.equal(calls, 4);
  // 4 calls spaced >=25ms apart across BOTH clients combined means >=3 gaps —
  // if each client paced independently instead, the combined rate would need
  // only >=2 gaps (2 calls per client) to pass, so this threshold is only
  // reachable if the pacer is actually shared.
  assert.ok(elapsed >= 70, `expected >=70ms elapsed from shared pacing, got ${elapsed}ms`);
});

test("safeGetTransaction returns the transaction on success", async () => {
  const rpc = { getTransaction: async () => ({ ok: true }) as any };
  const result = await safeGetTransaction(rpc, "sig1");
  assert.deepEqual(result, { ok: true });
});

test("safeGetTransaction returns null instead of throwing when getTransaction fails", async () => {
  const rpc = {
    getTransaction: async () => {
      throw new Error("Transaction version (1) is not supported by the requesting client");
    },
  };
  const result = await safeGetTransaction(rpc, "sig1");
  assert.equal(result, null);
});
