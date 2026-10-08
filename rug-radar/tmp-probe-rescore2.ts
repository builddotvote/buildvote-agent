// Scratch probe for session 36 — deleted before the session ends.
// Goal: find a real mint that gets both an observed buy *and* a later sell
// within the tracking window, then confirm rescoreHolderConcentrationFromIndex
// returns a non-empty, positive-balance holder list from it (not just that
// trades reach BalanceIndex at all — session 35 already confirmed that part).
import { loadConfig } from "./src/config.js";
import { SolanaRpcClient } from "./src/rpc.js";
import { LaunchWatcher, deriveWsUrl } from "./src/wsDiscovery.js";
import { BalanceIndex } from "./src/balanceIndex.js";
import { rescoreHolderConcentrationFromIndex } from "./src/rescore.js";
import type { DiscoveredLaunch } from "./src/discovery.js";

const config = loadConfig();
const discoveryRpc = new SolanaRpcClient(config.discoveryRpcUrl, fetch, { maxConcurrent: 2 });
const scoringRpc = new SolanaRpcClient(config.rpcUrl, fetch, { maxConcurrent: 2 });
const balanceIndex = new BalanceIndex();
const launches = new Map<string, DiscoveredLaunch>();
const tradeCounts = new Map<string, { buys: number; sells: number }>();

const WINDOW_MS = 90_000;
const RUN_MS = 150_000;

const wsUrl = config.wsUrl ?? deriveWsUrl(config.discoveryRpcUrl);
const watcher = new LaunchWatcher(wsUrl, discoveryRpc, {
  onLaunch: (launch) => {
    if (launches.has(launch.mint)) return;
    launches.set(launch.mint, launch);
    tradeCounts.set(launch.mint, { buys: 0, sells: 0 });
    watcher.trackMint(launch.mint, launch.bondingCurve);
    console.log(`tracking ${launch.mint}`);
    setTimeout(() => {
      watcher.untrackMint(launch.mint);
      const counts = tradeCounts.get(launch.mint)!;
      const holders = balanceIndex.getHolders(launch.mint, [launch.bondingCurve]);
      console.log(
        `[${launch.mint}] window closed: ${counts.buys} buys, ${counts.sells} sells, ` +
          `${holders.length} positive-balance holders: ${JSON.stringify(holders, (_k, v) => (typeof v === "bigint" ? v.toString() : v))}`,
      );
      rescoreHolderConcentrationFromIndex(scoringRpc, launch, balanceIndex)
        .then((signal) => {
          if (!signal) {
            console.log(`[${launch.mint}] rescore: null (no holders or bonding curve fetch failed)`);
            return;
          }
          console.log(`[${launch.mint}] rescore OK: ${JSON.stringify(signal)}`);
        })
        .catch((err) => console.error(`[${launch.mint}] rescore threw:`, err));
    }, WINDOW_MS);
  },
  onTrade: (trade) => {
    balanceIndex.recordTrade(trade);
    const counts = tradeCounts.get(trade.mint);
    if (counts) {
      if (trade.kind === "buy") counts.buys++;
      else counts.sells++;
    }
    console.log(`[trade] ${trade.kind} mint=${trade.mint} user=${trade.user} amount=${trade.amount}`);
  },
  onError: (err) => console.error("watcher error:", err instanceof Error ? err.message : err),
});

watcher.start();
console.log(`probe running for ${RUN_MS}ms, window ${WINDOW_MS}ms, discovery=${config.discoveryRpcUrl}, scoring=${config.rpcUrl}`);

setTimeout(() => {
  watcher.stop();
  console.log("probe done");
  process.exit(0);
}, RUN_MS);
