// Thin client for the public Solana JSON-RPC API. No keys, no private endpoints —
// just the standard methods documented at https://solana.com/docs/rpc/http.

export type FetchLike = typeof fetch;

export class RpcError extends Error {
  constructor(message: string, public readonly code: number) {
    super(message);
    this.name = "RpcError";
  }
}

export interface RpcTokenAmount {
  amount: string;
  decimals: number;
  uiAmount: number | null;
  uiAmountString: string;
}

export interface TokenLargestAccount extends RpcTokenAmount {
  address: string;
}

export interface AccountInfoValue {
  data: [string, string] | { program: string; parsed: unknown; space: number };
  executable: boolean;
  lamports: number;
  owner: string;
  rentEpoch: number;
}

export interface SignatureInfo {
  signature: string;
  slot: number;
  err: unknown | null;
  memo: string | null;
  blockTime: number | null;
  confirmationStatus?: string;
}

export interface TokenBalanceEntry {
  accountIndex: number;
  mint: string;
  owner?: string;
  uiTokenAmount: RpcTokenAmount;
}

export interface ParsedTransactionMeta {
  err: unknown | null;
  fee: number;
  preBalances: number[];
  postBalances: number[];
  preTokenBalances?: TokenBalanceEntry[];
  postTokenBalances?: TokenBalanceEntry[];
  logMessages?: string[];
}

export interface ParsedAccountKey {
  pubkey: string;
  signer: boolean;
  writable: boolean;
  source?: string;
}

// An instruction from an unrecognized program (e.g. pump.fun): the RPC can't
// decode its contents, so it's returned as a raw programId + account list +
// base58 instruction data.
export interface PartiallyDecodedInstruction {
  programId: string;
  accounts: string[];
  data: string;
}

// An instruction from a program the RPC knows how to decode (System, Token, ...).
export interface KnownProgramInstruction {
  programId: string;
  program: string;
  parsed: unknown;
}

export type MessageInstruction = PartiallyDecodedInstruction | KnownProgramInstruction;

export interface ParsedTransaction {
  slot: number;
  blockTime: number | null;
  transaction: {
    signatures: string[];
    message: {
      accountKeys: ParsedAccountKey[];
      instructions?: MessageInstruction[];
    };
  };
  meta: ParsedTransactionMeta | null;
}

interface RpcResponse<T> {
  jsonrpc: string;
  id: number;
  result?: T;
  error?: { code: number; message: string };
}

// The public RPC's rate limit is tight enough that back-to-back calls (e.g.
// discovery's getTransaction per signature) routinely hit HTTP 429 — observed
// against real mainnet-beta, not a hypothetical. Retrying with backoff turns
// that into a short delay instead of a dropped transaction.
export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  // Caps how many requests this client has in flight at once. Per-call retry
  // alone isn't enough against the public RPC: a burst of concurrent calls
  // (e.g. the ws watcher resolving several creates at once, or the pipeline's
  // four signals fetching in parallel) all land on the rate limiter together
  // and all back off on roughly the same schedule, so they keep colliding
  // instead of draining (observed live). Queuing them here, one client-wide
  // limit shared by every caller, spaces requests out instead.
  maxConcurrent?: number;
  // Minimum spacing, in ms, between the *start* of consecutive requests from
  // this client — reactive retry-after-429 alone still lets every caller fire
  // at once and then all back off together. Measured live against the
  // official endpoint (session 42, getSlot, no indexed methods): a sustained
  // ~2.5 req/sec (400ms spacing) ran 40s with zero 429s, while 5 req/sec
  // degraded to ~27% 429 over a sustained 15s window and 7+ req/sec was worse
  // — the ceiling is a sustained average rate, not just burst size. Disabled
  // (0) by default so every existing caller/test is unaffected; callers that
  // hit the rate-limited endpoint should opt in explicitly. Ignored if `pacer`
  // is also given.
  minIntervalMs?: number;
  // Injectable clock for minIntervalMs's spacing math, same reasoning as the
  // injectable `sleep` above: keeps pacing tests instant and deterministic
  // instead of depending on real elapsed wall-clock time. Ignored if `pacer`
  // is also given (the pacer carries its own clock).
  now?: () => number;
  // Share one RequestPacer across multiple SolanaRpcClient instances that hit
  // the *same* rate-limited endpoint. Each client pacing independently via
  // minIntervalMs still lets their combined rate exceed the measured-safe
  // ceiling — e.g. two 400ms-paced clients combine to ~5 req/sec against a
  // ~2.5 req/sec-safe endpoint (session 42's gap, closed session 43). Takes
  // priority over minIntervalMs/now when given.
  pacer?: RequestPacer;
  // Per-method override of minIntervalMs. Measured live (session 44): at the
  // same 2.5 req/sec rate that ran getSlot 40s with zero 429s (session 42),
  // getTransaction hit 90% 429 — its own safe rate is closer to 0.5 req/sec
  // (2000ms spacing, 0% 429 over 30s; 1 req/sec already showed 6.7% 429).
  // getTransaction is evidently throttled far more strictly than cheap calls
  // at the same request rate, so pacing every method to one shared interval
  // either starves getTransaction (too fast) or needlessly slows everything
  // else (too slow). A method listed here gets its own independent pacing
  // lane (and its own last-call timestamp) instead of sharing the default
  // bucket every other method uses. Ignored if `pacer` is also given — pass
  // this to the RequestPacer constructor directly in that case.
  methodIntervalsMs?: Record<string, number>;
  // Per-method override of maxRetries. Measured live (session 45): unlike
  // every other scoring call, getTokenLargestAccounts hit HTTP 429 on
  // *every* attempt against the official endpoint — 100% across 75 calls at
  // 2.5 req/sec, 20 at 1 req/sec, and 10 isolated single calls 10s apart
  // (still 100% after a 30s cooldown wait) — while getSlot/getTokenSupply/
  // getAccountInfo against the same endpoint in the same window all
  // returned 200. Not a pacing problem (no rate tried was slow enough to
  // get a single success) and not specific to one mint or a general IP
  // block (other methods on the same mint succeeded). Retrying this method
  // at the default maxRetries (4, exponential backoff) burns ~4.5s per
  // launch on a call that's confirmed to fail regardless of how long it
  // waits between attempts. A method listed here gets its own retry budget
  // instead of the client-wide maxRetries every other method uses.
  methodMaxRetries?: Record<string, number>;
}

const DEFAULT_MAX_RETRIES = 4;
const DEFAULT_BASE_DELAY_MS = 300;
const DEFAULT_MAX_CONCURRENT = 4;
const DEFAULT_MIN_INTERVAL_MS = 0;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// One independently-paced lane: requests reserved through the same bucket are
// spaced at least intervalMs apart; different buckets don't wait on each
// other at all.
interface PacerBucket {
  lastRequestStartedAt: number;
  chain: Promise<void>;
}

// Reserves request-start slots at least minIntervalMs apart. Standalone (not
// private to one SolanaRpcClient) so several clients hitting the same
// rate-limited endpoint can share a single instance and get one combined
// rate ceiling instead of each pacing independently — see RetryOptions.pacer.
// A method named in methodIntervalsMs gets its own lane at its own interval
// (see RetryOptions.methodIntervalsMs for why); every other method shares one
// default lane at minIntervalMs, same behavior as before per-method lanes
// existed.
export class RequestPacer {
  private readonly buckets = new Map<string, PacerBucket>();
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly methodIntervalsMs: Record<string, number>;

  constructor(
    private readonly minIntervalMs: number,
    opts: {
      now?: () => number;
      sleep?: (ms: number) => Promise<void>;
      methodIntervalsMs?: Record<string, number>;
    } = {},
  ) {
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? defaultSleep;
    this.methodIntervalsMs = opts.methodIntervalsMs ?? {};
  }

  // Chained (not just read-then-write) so concurrent callers of the same
  // lane queue for a slot in call order instead of racing on
  // lastRequestStartedAt and under-spacing each other. `method` is optional
  // so RequestPacer still works standalone (e.g. in tests) without naming one.
  reserve(method?: string): Promise<void> {
    const hasOwnLane = method !== undefined && method in this.methodIntervalsMs;
    const intervalMs = hasOwnLane ? this.methodIntervalsMs[method!] : this.minIntervalMs;
    if (intervalMs <= 0) return Promise.resolve();

    const bucketKey = hasOwnLane ? method! : "__default__";
    let bucket = this.buckets.get(bucketKey);
    if (!bucket) {
      bucket = { lastRequestStartedAt: -Infinity, chain: Promise.resolve() };
      this.buckets.set(bucketKey, bucket);
    }
    const ticket = bucket.chain.then(async () => {
      const wait = bucket!.lastRequestStartedAt + intervalMs - this.now();
      if (wait > 0) await this.sleep(wait);
      bucket!.lastRequestStartedAt = this.now();
    });
    // The chain itself must never reject: it's also the queue every later
    // caller on this lane waits on. If `ticket` rejects (e.g. an injected
    // `sleep`/`now` throws) and bucket.chain were set to `ticket` directly,
    // every subsequent reserve() on this lane would chain off a rejected
    // promise and immediately reject too, with that same stale error,
    // forever — one failed reservation would permanently wedge the lane.
    // The caller that issued this reservation still sees its own rejection
    // via the returned `ticket`.
    bucket.chain = ticket.catch(() => {});
    return ticket;
  }
}

export class SolanaRpcClient {
  private nextId = 1;
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxConcurrent: number;
  private activeCount = 0;
  private readonly waiters: Array<() => void> = [];
  private readonly pacer: RequestPacer;
  private readonly methodMaxRetries: Record<string, number>;

  constructor(
    private readonly url: string,
    private readonly fetchImpl: FetchLike = fetch,
    retry: RetryOptions = {},
  ) {
    this.maxRetries = retry.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.methodMaxRetries = retry.methodMaxRetries ?? {};
    this.baseDelayMs = retry.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
    this.sleep = retry.sleep ?? defaultSleep;
    this.maxConcurrent = retry.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
    this.pacer =
      retry.pacer ??
      new RequestPacer(retry.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS, {
        now: retry.now,
        sleep: this.sleep,
        methodIntervalsMs: retry.methodIntervalsMs,
      });
  }

  private acquireSlot(): Promise<void> {
    if (this.activeCount < this.maxConcurrent) {
      this.activeCount++;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  private releaseSlot(): void {
    const next = this.waiters.shift();
    if (next) {
      next();
    } else {
      this.activeCount--;
    }
  }

  private async request<T>(method: string, params: unknown[]): Promise<T> {
    // acquireSlot before pacer.reserve: reserving a pacing slot first would
    // timestamp "request started" at reserve-resolution time, not at the
    // actual fetch call below. Under concurrency contention (acquireSlot has
    // to queue because maxConcurrent is already in use), a batch of requests
    // can all have their pacer reservations resolve on schedule while they
    // wait for a slot, then all fire their real fetch back-to-back the
    // moment slots free up — a burst, exactly what minIntervalMs/pacer exists
    // to prevent. Acquiring the concurrency slot first means pacer.reserve()
    // always resolves immediately before the real fetch call, so its spacing
    // reflects actual request-send time.
    //
    // pacer.reserve() is inside this try/finally (not just the fetch loop)
    // so that if it ever rejects, the slot acquireSlot() already handed out
    // is still released — otherwise a rejected reservation would leak a
    // concurrency slot permanently, and after maxConcurrent such leaks every
    // future call would hang in acquireSlot() forever.
    await this.acquireSlot();
    try {
      const maxRetries = this.methodMaxRetries[method] ?? this.maxRetries;
      for (let attempt = 0; ; attempt++) {
        // Reserved every attempt, not just once before the loop: a 429 retry
        // is still a real request hitting the same rate-limited endpoint, so
        // it must respect the lane's own measured-safe spacing too — reserving
        // only on the first attempt let retries fire back-to-back at whatever
        // the exponential backoff happened to allow (as little as baseDelayMs),
        // ignoring a lane tuned to need far more (e.g. getTransaction's 2000ms,
        // see methodIntervalsMs above), which hammers the endpoint again right
        // when it just told us to slow down (observed live: a 2000ms lane's
        // own retries landed 300-600ms apart instead).
        await this.pacer.reserve(method);
        const res = await this.fetchImpl(this.url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: this.nextId++, method, params }),
        });

        if (res.status === 429 && attempt < maxRetries) {
          await this.sleep(this.baseDelayMs * 2 ** attempt);
          continue;
        }

        if (!res.ok) {
          throw new Error(`RPC HTTP error ${res.status} for ${method}`);
        }

        const body = (await res.json()) as RpcResponse<T>;
        if (body.error) {
          throw new RpcError(body.error.message, body.error.code);
        }
        return body.result as T;
      }
    } finally {
      this.releaseSlot();
    }
  }

  async getTokenSupply(mint: string): Promise<RpcTokenAmount> {
    const { value } = await this.request<{ value: RpcTokenAmount }>("getTokenSupply", [mint]);
    return value;
  }

  async getTokenLargestAccounts(mint: string): Promise<TokenLargestAccount[]> {
    const { value } = await this.request<{ value: TokenLargestAccount[] }>(
      "getTokenLargestAccounts",
      [mint],
    );
    return value;
  }

  async getAccountInfo(
    address: string,
    encoding: "base64" | "jsonParsed" = "base64",
  ): Promise<AccountInfoValue | null> {
    const { value } = await this.request<{ value: AccountInfoValue | null }>("getAccountInfo", [
      address,
      { encoding },
    ]);
    return value;
  }

  async getSignaturesForAddress(
    address: string,
    limit = 25,
    until?: string,
  ): Promise<SignatureInfo[]> {
    const config: { limit: number; until?: string } = { limit };
    if (until) config.until = until;
    return this.request<SignatureInfo[]>("getSignaturesForAddress", [address, config]);
  }

  async getTransaction(signature: string): Promise<ParsedTransaction | null> {
    // 1, not 0: live mainnet-beta now rejects every current transaction with
    // "Transaction version (1) is not supported by the requesting client"
    // when this was 0 (observed live — most/all recent transactions use
    // version 1, not legacy or v0). Bump again if a future version appears.
    return this.request<ParsedTransaction | null>("getTransaction", [
      signature,
      { encoding: "jsonParsed", maxSupportedTransactionVersion: 1 },
    ]);
  }
}

// The public RPC cluster is multiple nodes behind a load balancer: a
// signature returned by one node's getSignaturesForAddress can briefly 404 on
// getTransaction against another, and some historical transactions use a
// version this client doesn't request support for. Callers that scan many
// signatures (discovery, deployer history, bundled buys) should skip a
// failure like this rather than aborting the whole scan over one transaction.
export async function safeGetTransaction(
  rpc: Pick<SolanaRpcClient, "getTransaction">,
  signature: string,
): Promise<ParsedTransaction | null> {
  try {
    return await rpc.getTransaction(signature);
  } catch (err) {
    console.error(`getTransaction failed for ${signature}:`, err instanceof Error ? err.message : err);
    return null;
  }
}
