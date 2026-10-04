// One poll cycle: find launches newer than the last-seen cursor, score each,
// and add them to the live feed. The caller (server.ts) decides how often to
// call this (setInterval) — kept separate so a single cycle is testable
// without real timers.

import { findNewLaunches } from "./discovery.js";
import { scoreLaunch, type PipelineRpc } from "./pipeline.js";
import type { LiveFeed } from "./feed.js";
import type { SolanaRpcClient } from "./rpc.js";
import type { DeployerIndex } from "./deployerIndex.js";
import type { ScoringGate } from "./scoringGate.js";

export interface PollState {
  sinceBlockTime: number | null;
}

type DiscoveryRpc = Pick<SolanaRpcClient, "getSignaturesForAddress" | "getTransaction">;

// Two separate RPC clients, not one: discoveryRpc (the program's signature
// scan) and scoringRpc (each launch's four signals) point at different public
// endpoints by default — see config.ts's discoveryRpcUrl for why. Keeping
// them as distinct params here (rather than one combined type) means
// server.ts controls which URL each hits.
export async function pollOnce(
  discoveryRpc: DiscoveryRpc,
  scoringRpc: PipelineRpc,
  feed: LiveFeed,
  state: PollState,
  deployerIndex?: DeployerIndex,
  // Optional: shared with the websocket watcher's own scoring calls (see
  // server.ts) so both discovery paths respect one combined cap on how many
  // launches can be scoring at once against the same rate-limited scoring
  // RPC — see scoringGate.ts for why dropping beats queuing here.
  scoringGate?: ScoringGate,
): Promise<void> {
  const { launches, newestBlockTime } = await findNewLaunches(discoveryRpc, state.sinceBlockTime);
  state.sinceBlockTime = newestBlockTime;

  for (const launch of launches) {
    if (scoringGate && !scoringGate.tryAcquire()) {
      console.error(`skipping launch ${launch.mint}: too many pending scores`);
      continue;
    }
    try {
      feed.add(await scoreLaunch(scoringRpc, launch, deployerIndex));
    } catch (err) {
      console.error(`failed to score launch ${launch.mint}:`, err instanceof Error ? err.message : err);
    } finally {
      scoringGate?.release();
    }
  }
}
