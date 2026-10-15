// The websocket watcher's onLaunch handler (see server.ts), pulled out into
// its own function so it's testable without real timers or a real socket —
// same reason pollOnce (poller.ts) is a standalone function rather than
// inline in server.ts's setInterval callback.

import { scoreLaunch, type PipelineRpc } from "./pipeline.js";
import type { LiveFeed } from "./feed.js";
import type { DeployerIndex } from "./deployerIndex.js";
import type { ScoringGate } from "./scoringGate.js";
import type { ScoringInFlight } from "./scoringInFlight.js";
import type { DiscoveredLaunch } from "./discovery.js";

export interface WatcherOnLaunchDeps {
  feed: LiveFeed;
  scoringRpc: PipelineRpc;
  deployerIndex?: DeployerIndex;
  // Optional: shared with the poller's own scoring calls (see server.ts) so
  // both discovery paths respect one combined cap on how many launches can
  // be scoring at once against the same rate-limited scoring RPC — see
  // scoringGate.ts for why dropping beats queuing here.
  scoringGate?: ScoringGate;
  // Optional: shared with the poller's own scoring calls (see server.ts) so
  // a launch the poller has already started scoring, but not yet added to
  // the feed, isn't also picked up and re-scored here — see
  // scoringInFlight.ts for why feed.has() alone can't catch this case.
  scoringInFlight?: ScoringInFlight;
  // Optional: fires once per launch this call actually kept in the feed
  // (not one feed.add() silently dropped for having zero signals — see
  // feed.ts). server.ts uses this to schedule a holder-concentration
  // rescore from BalanceIndex.
  onScored?: (launch: DiscoveredLaunch) => void;
}

export function handleDiscoveredLaunch(launch: DiscoveredLaunch, deps: WatcherOnLaunchDeps): void {
  const { feed, scoringRpc, deployerIndex, scoringGate, scoringInFlight, onScored } = deps;

  if (feed.has(launch.mint)) return;
  if (scoringInFlight && !scoringInFlight.tryAcquire(launch.mint)) {
    console.error(`skipping launch ${launch.mint}: already being scored by another discovery path`);
    return;
  }
  if (scoringGate && !scoringGate.tryAcquire()) {
    console.error(`skipping launch ${launch.mint}: too many pending scores`);
    scoringInFlight?.release(launch.mint);
    return;
  }

  scoreLaunch(scoringRpc, launch, deployerIndex)
    .then((score) => {
      feed.add(score);
      if (feed.has(launch.mint)) onScored?.(launch);
    })
    .catch((err) => {
      console.error(`failed to score launch ${launch.mint}:`, err instanceof Error ? err.message : err);
    })
    .finally(() => {
      scoringGate?.release();
      scoringInFlight?.release(launch.mint);
    });
}
