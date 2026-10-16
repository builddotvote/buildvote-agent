import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { loadConfig } from "./config.js";
import { SolanaRpcClient, RequestPacer } from "./rpc.js";
import { LiveFeed } from "./feed.js";
import { pollOnce, type PollState } from "./poller.js";
import { LaunchWatcher, deriveWsUrl } from "./wsDiscovery.js";
import { DeployerIndex } from "./deployerIndex.js";
import { ScoringGate } from "./scoringGate.js";
import { ScoringInFlight } from "./scoringInFlight.js";
import { handleDiscoveredLaunch } from "./watcherOnLaunch.js";
import { BalanceIndex } from "./balanceIndex.js";
import { scheduleHolderRescore as scheduleHolderRescoreFromIndex } from "./holderRescore.js";
import { createRequestHandler } from "./requestHandler.js";
import type { DiscoveredLaunch } from "./discovery.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "..", "public");

const config = loadConfig();
const feed = new LiveFeed();
const pollState: PollState = { sinceBlockTime: null };
// Shared across both discovery paths so a deployer's launch is "seen" for
// deployer-history scoring regardless of which path found it — see
// deployerIndex.ts for why this exists.
const deployerIndex = new DeployerIndex();
// Shared across both discovery paths: caps how many launches can be scoring
// at once against the scoring RPC, since a burst of launches contending for
// its own maxConcurrent:2 HTTP slots was confirmed live (session 20) to
// never drain within a 100s window. A launch beyond the cap is dropped, not
// queued — see scoringGate.ts.
const scoringGate = new ScoringGate(3);
// Shared across both discovery paths: closes the gap `feed.has()` alone
// leaves open — a launch the other path has already started scoring, but
// not yet added to the feed, is claimed here before either path's first RPC
// call for it, instead of both paths redundantly running all four signals
// and only discovering the duplicate at feed.add() time. See
// scoringInFlight.ts.
const scoringInFlight = new ScoringInFlight();
// Per-mint observed balances, fed by the websocket watcher's per-mint trade
// subscriptions (see trackMint/onTrade below) — see balanceIndex.ts and
// rescore.ts for why: an alternative to the rate-limited
// getTokenLargestAccounts call, built from trades this process has already
// subscribed to for free rather than another indexed RPC call.
const balanceIndex = new BalanceIndex();

// Four clients, not one: discovery (finding/resolving launches — high
// volume, needs config.discoveryRpcUrl) and scoring (each launch's four
// signals — needs config.rpcUrl for token methods discoveryRpcUrl's free
// tier blocks, see config.ts) are split per discovery path, each
// maxConcurrent: 2. This preserves session 11's fairness fix (the watcher's
// latency-sensitive calls no longer queue behind the backstop poller's bursts,
// or vice versa) while also keeping the two endpoints' traffic separate.
//
// The two scoring clients both hit config.rpcUrl (the official endpoint).
// Session 42 measured its actual sustained-rate ceiling directly (getSlot,
// no indexed methods, so the result isn't confounded by the already-known
// token-method blocking): ~2.5 req/sec ran 40s with zero 429s, 5 req/sec
// degraded to ~27% 429 over a sustained 15s window, 7+ req/sec was worse —
// a sustained-average-rate ceiling, not just a burst-size one, so reactive
// retry-after-429 alone (every caller firing immediately and backing off
// together) can't avoid it. Session 42 first paced each scoring client
// independently (minIntervalMs: 400 each), which left a gap it flagged but
// didn't fix: two independently-paced clients combine to ~5 req/sec against
// the ~2.5 req/sec-safe ceiling, double the measured-safe rate. Session 43
// closed that gap: one shared RequestPacer(400) between both scoring
// clients enforces a single combined ~2.5 req/sec ceiling across whichever
// one is calling, instead of each getting its own budget.
//
// Session 43's own live check then found getTransaction taking 37 of 39
// 429s at that shared 400ms rate, far more than getTokenLargestAccounts (2).
// Session 44 measured getTransaction specifically (same paced-probe shape as
// session 42's getSlot measurement, against real signatures): at 2.5 req/sec
// (the rate that ran getSlot 40s with zero 429s) getTransaction hit 90% 429;
// its own safe rate is closer to 0.5 req/sec (2000ms, 0% 429 over 30s; 1
// req/sec already showed 6.7%). getTransaction is throttled far more
// strictly than cheap/other calls at the same request rate, so it gets its
// own slower lane on the shared pacer instead of the 400ms default every
// other scoring call (getTokenLargestAccounts, getAccountInfo,
// getSignaturesForAddress) still uses.
//
// Session 45 measured getTokenLargestAccounts itself the same way (a
// dedicated paced probe, varying rate and mint): unlike getTransaction, no
// rate tried got even one success — 100% 429 at 2.5 req/sec (75 calls), 1
// req/sec (20 calls), and 10 isolated single calls 10s apart after a 30s
// cooldown wait, while getSlot/getTokenSupply/getAccountInfo against the
// same endpoint in the same window all returned 200. A slower lane (session
// 44's fix for getTransaction) assumes a slow-enough rate eventually
// succeeds; this method never did at any rate tried, so pacing it slower
// wouldn't help — it would just add latency for the same 429. The real cost
// right now is the default 4 retries' exponential backoff (~4.5s) spent on
// a call confirmed to fail regardless, so each scoring client below caps
// its retries instead (methodMaxRetries, see rpc.ts) rather than getting
// its own pacing lane.
const scoringPacer = new RequestPacer(400, { methodIntervalsMs: { getTransaction: 2000 } });
const scoringMethodMaxRetries = { getTokenLargestAccounts: 1 };
const watcherDiscoveryRpc = new SolanaRpcClient(config.discoveryRpcUrl, fetch, { maxConcurrent: 2 });
const watcherScoringRpc = new SolanaRpcClient(config.rpcUrl, fetch, {
  maxConcurrent: 2,
  pacer: scoringPacer,
  methodMaxRetries: scoringMethodMaxRetries,
});
const pollDiscoveryRpc = new SolanaRpcClient(config.discoveryRpcUrl, fetch, { maxConcurrent: 2 });
const pollScoringRpc = new SolanaRpcClient(config.rpcUrl, fetch, {
  maxConcurrent: 2,
  pacer: scoringPacer,
  methodMaxRetries: scoringMethodMaxRetries,
});

// Primary discovery is the websocket watcher (near-instant, sees every
// create as it happens). The poller below stays on as a backstop for
// launches created while the socket is down (startup, or a reconnect gap).
const wsUrl = config.wsUrl ?? deriveWsUrl(config.discoveryRpcUrl);
const watcher = new LaunchWatcher(wsUrl, watcherDiscoveryRpc, {
  // handleDiscoveredLaunch (watcherOnLaunch.ts) is the exact same
  // dedup/gate/score/rescore wiring pollOnce uses for the backstop poller —
  // pulled out so it's unit-testable without a real socket, the same reason
  // pollOnce is its own function rather than inline in setInterval below.
  onLaunch: (launch) =>
    handleDiscoveredLaunch(launch, {
      feed,
      scoringRpc: watcherScoringRpc,
      deployerIndex,
      scoringGate,
      scoringInFlight,
      // feed.add() drops a zero-signal score (see feed.ts) instead of
      // keeping it — handleDiscoveredLaunch only calls onScored for a
      // launch actually kept, so a rescore is never scheduled for one that
      // would spend rescoreHolderConcentrationFromIndex's getAccountInfo
      // call 45s from now on a launch that will never be shown.
      onScored: scheduleHolderRescore,
    }),
  onTrade: (trade) => balanceIndex.recordTrade(trade),
  onError: (err) => {
    console.error("launch watcher error:", err instanceof Error ? err.message : err);
  },
});

// How long to let a mint's own trade subscription (trackMint) collect buys/
// sells before re-scoring holder-concentration from BalanceIndex and giving
// up the subscription. Session 47 measured this directly: across two live
// 150s windows (62 mints tracked total), only 3 ever saw a trade at all —
// most mints simply never trade in-window, so the delay's length doesn't
// change their outcome either way. Of the 3 that did trade, first-trade
// delays were 15.4s, 16.0s, and 54.4s — the old 20s value would have missed
// the 54.4s case entirely (1 of 3 observed, not a rare tail). Raised to 45s
// to cover it, since holding the free per-mint websocket subscription open
// longer costs nothing for the ~95% of mints that stay quiet regardless.
const RESCORE_DELAY_MS = 45_000;

// Tracks the mint's own bonding-curve trades (see wsDiscovery.ts's
// trackMint), waits RESCORE_DELAY_MS for BalanceIndex to accumulate some,
// then re-scores just the holder-concentration signal from it and updates
// the feed entry in place. Always untracks afterward so a long-running
// process doesn't leak subscriptions for launches it's done watching.
// holderRescore.ts (see there for the logic itself) takes the watcher,
// feed, scoring RPC, balance index, and delay as dependencies so it's
// unit-testable without a real timer — same reason pollOnce (poller.ts) and
// handleDiscoveredLaunch (watcherOnLaunch.ts) are standalone functions.
function scheduleHolderRescore(launch: DiscoveredLaunch): void {
  scheduleHolderRescoreFromIndex(launch, {
    feed,
    scoringRpc: watcherScoringRpc,
    balanceIndex,
    watcher,
    delayMs: RESCORE_DELAY_MS,
  });
}

// How often the backstop poll checks the pump.fun program for new launches
// the watcher missed. Public RPCs rate limit aggressively, so this is a slow
// safety net, not the main discovery path.
const POLL_INTERVAL_MS = 15_000;

function poll(): void {
  // onScored: without this, a launch the backstop poller finds (the
  // websocket was down, or this is a reconnect gap) never got the
  // holder-concentration rescore below — only launches the primary
  // websocket path discovers did, since scheduleHolderRescore lived solely
  // in the watcher's onLaunch handler until now.
  pollOnce(
    pollDiscoveryRpc,
    pollScoringRpc,
    feed,
    pollState,
    deployerIndex,
    scoringGate,
    scoringInFlight,
    scheduleHolderRescore,
  ).catch((err) => {
    console.error("poll failed:", err instanceof Error ? err.message : err);
  });
}

const handleRequest = createRequestHandler({
  feed,
  readIndexHtml: () => readFile(path.join(publicDir, "index.html"), "utf8"),
});
const server = createServer(handleRequest);

server.listen(config.port, () => {
  console.log(`rug-radar listening on http://localhost:${config.port}`);
  console.log(`using data RPC: ${config.rpcUrl}`);
  console.log(`using discovery RPC: ${config.discoveryRpcUrl}`);
  console.log(`using WS: ${wsUrl}`);
  watcher.start();
  poll();
  setInterval(poll, POLL_INTERVAL_MS);
});
