// Discovers new pump.fun launches by polling the program account's own
// signature history for "create"/"create_v2" instructions. No websockets or
// private endpoints — just repeated calls to the same public
// getSignaturesForAddress/getTransaction methods the other data/* modules use.

import { decodeCreateInstruction, PUMP_FUN_PROGRAM_ID } from "./pumpfun.js";
import type { ParsedTransaction, SolanaRpcClient } from "./rpc.js";

export interface DiscoveredLaunch {
  mint: string;
  deployer: string;
  bondingCurve: string;
  createdAt: number; // unix seconds, from the transaction's blockTime
  signature: string;
}

type DiscoveryFetcher = Pick<SolanaRpcClient, "getSignaturesForAddress" | "getTransaction">;

export interface FindNewLaunchesOptions {
  // How many of the program's most recent signatures to scan per poll.
  // KNOWN LIMITATION (confirmed live, session 10): the pump.fun program ID
  // sees roughly 500 transactions/second across *all* instruction types
  // (buy/sell/create/migrate combined) — 1000 signatures from
  // getSignaturesForAddress span only ~2 seconds of real traffic. A 15s poll
  // with this default therefore only samples a sliver of each interval and
  // will miss most create instructions, not just "bursts". Raising this
  // doesn't fix coverage (the firehose is way bigger than any sane limit)
  // and makes the 429 problem worse (one getTransaction call per signature
  // against a public, rate-limited RPC). A real fix needs a different
  // discovery mechanism — e.g. a websocket logsSubscribe with a `mentions`
  // filter on the program, parsing "Instruction: Create" out of the log
  // lines that arrive for free with the subscription, instead of polling
  // signatures and fetching each transaction — not attempted yet.
  limit?: number;
  // Passed through to resolveLaunchFromSignature per signature. The poll's
  // own signatures can still be very recent (the firehose above means even
  // a 15s-old poll can surface signatures from moments ago), so the same
  // not-found-yet retry that wsDiscovery.ts's real-time path needs can also
  // matter here — not just a websocket-only concern.
  resolveOptions?: ResolveLaunchOptions;
}

const DEFAULT_LIMIT = 50;

export interface FindNewLaunchesResult {
  launches: DiscoveredLaunch[];
  // Pass this back in as `sinceBlockTime` on the next poll.
  newestBlockTime: number | null;
}

// Finds launches newer than `sinceBlockTime` (exclusive), returned oldest-first.
// Pass `sinceBlockTime: null` on the very first poll — it seeds the watermark
// from whatever's currently at the head of the program's history rather than
// treating that entire initial window as "new" launches to score.
//
// Deliberately timestamp-based rather than using getSignaturesForAddress's
// own `until` signature cursor: against the public multi-node RPC cluster, a
// signature seen by one node can be unknown to whichever node serves the next
// poll, and that node errors on an unrecognized `until` cursor instead of
// falling back gracefully (observed against real mainnet-beta, not just a
// documented edge case). Filtering client-side by blockTime sidesteps that.
export async function findNewLaunches(
  rpc: DiscoveryFetcher,
  sinceBlockTime: number | null,
  options: FindNewLaunchesOptions = {},
): Promise<FindNewLaunchesResult> {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const signatures = await rpc.getSignaturesForAddress(PUMP_FUN_PROGRAM_ID, limit);

  const newestBlockTime = signatures.find((s) => s.blockTime !== null)?.blockTime ?? sinceBlockTime;

  if (sinceBlockTime === null) {
    return { launches: [], newestBlockTime };
  }

  const launches: DiscoveredLaunch[] = [];
  // getSignaturesForAddress returns newest-first; scan oldest-first so the
  // feed fills in launch order.
  for (const sig of [...signatures].reverse()) {
    if (sig.err || sig.blockTime === null || sig.blockTime <= sinceBlockTime) continue;

    const launch = await resolveLaunchFromSignature(rpc, sig.signature, options.resolveOptions);
    if (launch) launches.push(launch);
  }

  return { launches, newestBlockTime };
}

type SignatureFetcher = Pick<SolanaRpcClient, "getTransaction">;

export interface ResolveLaunchOptions {
  // Confirmed live (session 17): right after the websocket watcher sees a
  // create's log notification, getTransaction for that same signature often
  // comes back null — the public RPC is a multi-node cluster and the node
  // serving getTransaction can lag behind whichever node pushed the log
  // notification. Measured directly against real traffic: one sample took
  // ~8.5s to become visible (5 polling attempts at a 2s interval) — not a
  // sub-second blip. Retrying with backoff resolves these; without it, the
  // launch was silently dropped forever (no error, since a "not found"
  // result isn't an exception). Only a null *transaction* is retried — a
  // transaction that resolves but isn't a create instruction won't become
  // one on a retry, so that case returns immediately.
  // Confirmed live (session 19): a thrown getTransaction error (e.g. the
  // public RPC's 429 retries in rpc.ts already exhausted) used to be
  // swallowed to the same `null` as a genuine not-found-yet result via
  // safeGetTransaction, so this retry loop retried a rate-limit exhaustion
  // exactly like replication lag — up to 5 more times, each re-running
  // rpc.ts's own 4-retry backoff, i.e. up to ~20-25 real HTTP calls for one
  // signature. Against an endpoint that just told us to back off, that
  // amplification is the opposite of helpful: it was observed live to stall
  // the watcher to zero resolved launches over several minutes. Only a
  // genuine null (no exception) is replication lag worth retrying; a thrown
  // error gives up immediately instead of hammering harder.
  retries?: number;
  baseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

// Exponential backoff (same `baseDelayMs * 2 ** attempt` shape as rpc.ts's
// 429 retry): 750, 1500, 3000, 6000, 12000ms, ~23.25s cumulative across 5
// retries — comfortably past the ~8.5s lag observed live.
const DEFAULT_RESOLVE_RETRIES = 5;
const DEFAULT_RESOLVE_BASE_DELAY_MS = 750;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Fetches one transaction and, if it contains a pump.fun create/create_v2
// instruction, decodes it into a DiscoveredLaunch. Shared by the polling
// path above and wsDiscovery.ts's real-time path — both end up with just a
// signature and need the same decode.
export async function resolveLaunchFromSignature(
  rpc: SignatureFetcher,
  signature: string,
  options: ResolveLaunchOptions = {},
): Promise<DiscoveredLaunch | null> {
  const retries = options.retries ?? DEFAULT_RESOLVE_RETRIES;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_RESOLVE_BASE_DELAY_MS;
  const sleep = options.sleep ?? defaultSleep;

  for (let attempt = 0; ; attempt++) {
    let tx: ParsedTransaction | null;
    try {
      tx = await rpc.getTransaction(signature);
    } catch (err) {
      console.error(`getTransaction failed for ${signature}:`, err instanceof Error ? err.message : err);
      return null;
    }
    if (tx && tx.blockTime !== null) {
      const created = findCreateInstruction(tx);
      return created ? { ...created, createdAt: tx.blockTime, signature } : null;
    }
    if (attempt >= retries) return null;
    await sleep(baseDelayMs * 2 ** attempt);
  }
}

function findCreateInstruction(
  tx: ParsedTransaction,
): { mint: string; deployer: string; bondingCurve: string } | null {
  const instructions = tx.transaction.message.instructions ?? [];
  for (const ix of instructions) {
    if (ix.programId !== PUMP_FUN_PROGRAM_ID || !("data" in ix)) continue;
    const decoded = decodeCreateInstruction(ix.data, ix.accounts);
    if (decoded) {
      return { mint: decoded.mint, deployer: decoded.user, bondingCurve: decoded.bondingCurve };
    }
  }
  return null;
}
