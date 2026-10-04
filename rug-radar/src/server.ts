import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { loadConfig } from "./config.js";
import { SolanaRpcClient } from "./rpc.js";
import { LiveFeed } from "./feed.js";
import { pollOnce, type PollState } from "./poller.js";
import { scoreLaunch } from "./pipeline.js";
import { LaunchWatcher, deriveWsUrl } from "./wsDiscovery.js";
import { DeployerIndex } from "./deployerIndex.js";
import { ScoringGate } from "./scoringGate.js";

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

// Four clients, not one: discovery (finding/resolving launches — high
// volume, needs config.discoveryRpcUrl) and scoring (each launch's four
// signals — needs config.rpcUrl for token methods discoveryRpcUrl's free
// tier blocks, see config.ts) are split per discovery path, each
// maxConcurrent: 2. This preserves session 11's fairness fix (the watcher's
// latency-sensitive calls no longer queue behind the backstop poller's bursts,
// or vice versa) while also keeping the two endpoints' traffic separate.
const watcherDiscoveryRpc = new SolanaRpcClient(config.discoveryRpcUrl, fetch, { maxConcurrent: 2 });
const watcherScoringRpc = new SolanaRpcClient(config.rpcUrl, fetch, { maxConcurrent: 2 });
const pollDiscoveryRpc = new SolanaRpcClient(config.discoveryRpcUrl, fetch, { maxConcurrent: 2 });
const pollScoringRpc = new SolanaRpcClient(config.rpcUrl, fetch, { maxConcurrent: 2 });

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
      .then((score) => feed.add(score))
      .catch((err) => {
        console.error(`failed to score launch ${launch.mint}:`, err instanceof Error ? err.message : err);
      })
      .finally(() => scoringGate.release());
  },
  onError: (err) => {
    console.error("launch watcher error:", err instanceof Error ? err.message : err);
  },
});

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
