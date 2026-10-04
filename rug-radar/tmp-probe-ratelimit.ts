// Scratch probe (session 20): re-check whether the severe rate-limiting
// Session 19 found (zero launches resolved in 3 min) is still happening, and
// whether the backstop poller sees the same wall. Deleted before the session
// ends, same habit as every prior session's scratch probes.
import { loadConfig } from "./src/config.js";
import { SolanaRpcClient } from "./src/rpc.js";
import { LiveFeed } from "./src/feed.js";
import { pollOnce, type PollState } from "./src/poller.js";
import { LaunchWatcher, deriveWsUrl } from "./src/wsDiscovery.js";
import { DeployerIndex } from "./src/deployerIndex.js";
import { scoreLaunch } from "./src/pipeline.js";

const config = loadConfig();

let total = 0;
let rateLimited = 0;
function countingFetch(...args: Parameters<typeof fetch>): ReturnType<typeof fetch> {
  return fetch(...args).then((res) => {
    total++;
    if (res.status === 429) rateLimited++;
    return res;
  });
}

async function checkPoller() {
  console.log("--- backstop poller: one pollOnce() call ---");
  const rpc = new SolanaRpcClient(config.rpcUrl, countingFetch, { maxConcurrent: 2 });
  const feed = new LiveFeed();
  const state: PollState = { sinceBlockTime: null };
  const index = new DeployerIndex();
  // Seed the watermark first (first call always returns launches: []), then
  // wait a bit so there's a real window to scan on the second call.
  await pollOnce(rpc, feed, state, index);
  await new Promise((r) => setTimeout(r, 20_000));
  const before = { total, rateLimited };
  await pollOnce(rpc, feed, state, index);
  console.log(
    `poller: ${feed.list().length} launches scored, ${total - before.total} HTTP calls, ${rateLimited - before.rateLimited} were 429`,
  );
}

async function checkWatcher(durationMs: number) {
  console.log(`--- websocket watcher + full scoring pipeline: ${durationMs / 1000}s ---`);
  const rpc = new SolanaRpcClient(config.rpcUrl, countingFetch, { maxConcurrent: 2 });
  const index = new DeployerIndex();
  let resolved = 0;
  let scored = 0;
  let scoreFailed = 0;
  const before = { total, rateLimited };
  const watcher = new LaunchWatcher(config.wsUrl ?? deriveWsUrl(config.rpcUrl), rpc, {
    onLaunch: (launch) => {
      resolved++;
      scoreLaunch(rpc, launch, index)
        .then(() => {
          scored++;
        })
        .catch((err) => {
          scoreFailed++;
          console.error("score failed:", err instanceof Error ? err.message : err);
        });
    },
    onError: (err) => console.error("watcher error:", err instanceof Error ? err.message : err),
  });
  watcher.start();
  await new Promise((r) => setTimeout(r, durationMs));
  watcher.stop();
  // Let in-flight scoring calls (queued behind maxConcurrent: 2) finish
  // before reporting, instead of cutting them off mid-pipeline.
  await new Promise((r) => setTimeout(r, 15_000));
  console.log(
    `watcher: ${resolved} resolved, ${scored} fully scored, ${scoreFailed} score failures, ${total - before.total} HTTP calls, ${rateLimited - before.rateLimited} were 429`,
  );
}

async function main() {
  await checkPoller();
  await checkWatcher(90_000);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
