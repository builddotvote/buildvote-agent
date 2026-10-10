import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { loadConfig } from "./config.js";
import { SolanaRpcClient, RequestPacer } from "./rpc.js";
import { LiveFeed } from "./feed.js";
import { pollOnce, type PollState } from "./poller.js";
import { scoreLaunch } from "./pipeline.js";
import { LaunchWatcher, deriveWsUrl } from "./wsDiscovery.js";
import { DeployerIndex } from "./deployerIndex.js";
import { ScoringGate } from "./scoringGate.js";
import { BalanceIndex } from "./balanceIndex.js";
import { rescoreHolderConcentrationFromIndex } from "./rescore.js";
import { combineSignals } from "./scorer.js";
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
const scoringPacer = new RequestPacer(400);
const watcherDiscoveryRpc = new SolanaRpcClient(config.discoveryRpcUrl, fetch, { maxConcurrent: 2 });
const watcherScoringRpc = new SolanaRpcClient(config.rpcUrl, fetch, { maxConcurrent: 2, pacer: scoringPacer });
const pollDiscoveryRpc = new SolanaRpcClient(config.discoveryRpcUrl, fetch, { maxConcurrent: 2 });
const pollScoringRpc = new SolanaRpcClient(config.rpcUrl, fetch, { maxConcurrent: 2, pacer: scoringPacer });

// Primary discovery is the websocket watcher (near-instant, sees every
// create as it happens). The poller below stays on as a backstop for
// launches created while the socket is down (startup, or a reconnect gap).
const wsUrl = config.wsUrl ?? deriveWsUrl(config.discoveryRpcUrl);
const watcher = new LaunchWatcher(wsUrl, watcherDiscoveryRpc, {
  onLaunch: (launch) => {
    if (feed.has(launch.mint)) return;
    if (!scoringGate.tryAcquire()) {
      console.error(`skipping launch ${launch.mint}: too many pending scores`);
      return;
    }
    scoreLaunch(watcherScoringRpc, launch, deployerIndex)
      .then((score) => {
        feed.add(score);
        scheduleHolderRescore(launch);
      })
      .catch((err) => {
        console.error(`failed to score launch ${launch.mint}:`, err instanceof Error ? err.message : err);
      })
      .finally(() => scoringGate.release());
  },
  onTrade: (trade) => balanceIndex.recordTrade(trade),
  onError: (err) => {
    console.error("launch watcher error:", err instanceof Error ? err.message : err);
  },
});

// How long to let a mint's own trade subscription (trackMint) collect buys/
// sells before re-scoring holder-concentration from BalanceIndex and giving
// up the subscription — a starting point, not yet tuned against how fast
// real launches accumulate trades (see README).
const RESCORE_DELAY_MS = 20_000;

// Tracks the mint's own bonding-curve trades (see wsDiscovery.ts's
// trackMint), waits RESCORE_DELAY_MS for BalanceIndex to accumulate some,
// then re-scores just the holder-concentration signal from it and updates
// the feed entry in place. Always untracks afterward so a long-running
// process doesn't leak subscriptions for launches it's done watching.
function scheduleHolderRescore(launch: DiscoveredLaunch): void {
  // Seed the index with the dev's bundled buy (see discovery.ts) before
  // subscribing for further trades — trackMint only sees activity from here
  // on, so without this the mint's actual first holder is invisible to it.
  if (launch.bundledBuy) balanceIndex.recordTrade(launch.bundledBuy);
  watcher.trackMint(launch.mint, launch.bondingCurve);
  setTimeout(() => {
    rescoreHolderConcentrationFromIndex(watcherScoringRpc, launch, balanceIndex)
      .then((signal) => {
        if (!signal) return;
        const existing = feed.get(launch.mint);
        if (!existing) return;
        const signals = existing.signals.filter((s) => s.name !== "holder-concentration");
        signals.push(signal);
        feed.update(combineSignals(launch.mint, signals));
        console.log(`rescored holder-concentration for ${launch.mint} from observed trades: ${signal.reasons[0]}`);
      })
      .catch((err) => {
        console.error(
          `holder-concentration rescore failed for ${launch.mint}:`,
          err instanceof Error ? err.message : err,
        );
      })
      .finally(() => watcher.untrackMint(launch.mint));
  }, RESCORE_DELAY_MS);
}

// How often the backstop poll checks the pump.fun program for new launches
// the watcher missed. Public RPCs rate limit aggressively, so this is a slow
// safety net, not the main discovery path.
const POLL_INTERVAL_MS = 15_000;

function poll(): void {
  pollOnce(pollDiscoveryRpc, pollScoringRpc, feed, pollState, deployerIndex, scoringGate).catch((err) => {
    console.error("poll failed:", err instanceof Error ? err.message : err);
  });
}

const server = createServer(async (req, res) => {
  if (req.url === "/" || req.url === "/index.html") {
    const html = await readFile(path.join(publicDir, "index.html"), "utf8");
    res.writeHead(200, { "content-type": "text/html" });
    res.end(html);
    return;
  }

  if (req.url === "/api/feed") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ launches: feed.list() }));
    return;
  }

  res.writeHead(404, { "content-type": "text/plain" });
  res.end("not found");
});

server.listen(config.port, () => {
  console.log(`rug-radar listening on http://localhost:${config.port}`);
  console.log(`using data RPC: ${config.rpcUrl}`);
  console.log(`using discovery RPC: ${config.discoveryRpcUrl}`);
  console.log(`using WS: ${wsUrl}`);
  watcher.start();
  poll();
  setInterval(poll, POLL_INTERVAL_MS);
});
