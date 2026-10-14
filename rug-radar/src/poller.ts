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
import type { ScoringInFlight } from "./scoringInFlight.js";
import type { DiscoveredLaunch } from "./discovery.js";

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
  // Optional: shared with the websocket watcher's own scoring calls (see
  // server.ts) so a launch the watcher has already started scoring, but not
  // yet added to the feed, isn't also picked up and re-scored here — see
  // scoringInFlight.ts for why feed.has() alone can't catch this case.
  scoringInFlight?: ScoringInFlight,
  // Optional: fires once per launch this cycle actually kept in the feed
  // (not one feed.add() silently dropped for having zero signals — see
  // feed.ts). The websocket watcher's onLaunch handler uses the same signal
  // in server.ts to schedule a holder-concentration rescore from
  // BalanceIndex; without this, a launch the backstop poller finds (the
  // websocket was down, or this is a reconnect gap) never got that rescore
  // at all, unlike every launch the primary path discovers.
  onScored?: (launch: DiscoveredLaunch) => void,
): Promise<void> {
  const { launches, newestBlockTime } = await findNewLaunches(discoveryRpc, state.sinceBlockTime);
  state.sinceBlockTime = newestBlockTime;

  for (const launch of launches) {
    // The watcher runs concurrently and can have already scored this exact
    // launch within the same window findNewLaunches just rescanned (its
    // cursor is time-based, not feed-based) — without this check every such
    // overlap re-ran all four signals' RPC calls against the already-strained
    // scoring RPC only to have feed.add() silently drop the duplicate at the
    // very end, wasting the gate slot and the calls for nothing.
    if (feed.has(launch.mint)) continue;
    if (scoringInFlight && !scoringInFlight.tryAcquire(launch.mint)) {
      console.error(`skipping launch ${launch.mint}: already being scored by another discovery path`);
      continue;
    }
    if (scoringGate && !scoringGate.tryAcquire()) {
      console.error(`skipping launch ${launch.mint}: too many pending scores`);
      scoringInFlight?.release(launch.mint);
      continue;
    }
    try {
      feed.add(await scoreLaunch(scoringRpc, launch, deployerIndex));
      if (feed.has(launch.mint)) onScored?.(launch);
    } catch (err) {
      console.error(`failed to score launch ${launch.mint}:`, err instanceof Error ? err.message : err);
    } finally {
      scoringGate?.release();
      scoringInFlight?.release(launch.mint);
    }
  }
}
