// Scratch, not meant to be committed. Session 59: a second live data point
// for RESCORE_DELAY_MS (session 47's only measurement so far: 62 mints
// tracked, 3 traded, first-trade delays 15.4s/16.0s/54.4s). Same
// methodology: watch real launches, trackMint each one, record the delay
// from launch-discovery to first onTrade, over a live window.
import { loadConfig } from "./src/config.js";
import { SolanaRpcClient } from "./src/rpc.js";
import { LaunchWatcher, deriveWsUrl } from "./src/wsDiscovery.js";

const config = loadConfig();
const wsUrl = config.wsUrl ?? deriveWsUrl(config.discoveryRpcUrl);
const rpc = new SolanaRpcClient(config.discoveryRpcUrl, fetch, { maxConcurrent: 2 });

const WINDOW_MS = 150_000;
const launchedAt = new Map<string, number>();
const firstTradeDelay = new Map<string, number>();

const watcher = new LaunchWatcher(wsUrl, rpc, {
  onLaunch: (launch) => {
    launchedAt.set(launch.mint, Date.now());
    watcher.trackMint(launch.mint, launch.bondingCurve);
  },
  onTrade: (trade) => {
    if (firstTradeDelay.has(trade.mint)) return;
    const start = launchedAt.get(trade.mint);
    if (start === undefined) return;
    firstTradeDelay.set(trade.mint, Date.now() - start);
  },
  onError: (err) => console.error("watcher error:", err instanceof Error ? err.message : err),
});

watcher.start();
console.log(`watching for ${WINDOW_MS / 1000}s...`);

setTimeout(() => {
  for (const mint of launchedAt.keys()) watcher.untrackMint(mint);
  watcher.stop();
  const delays = [...firstTradeDelay.values()];
  console.log(`tracked ${launchedAt.size} mints, ${delays.length} saw a trade within the window`);
  console.log("first-trade delays (ms):", delays.sort((a, b) => a - b));
  process.exit(0);
}, WINDOW_MS);
