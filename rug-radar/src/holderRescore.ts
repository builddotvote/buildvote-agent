// server.ts's scheduleHolderRescore, pulled out into its own function so
// it's testable without a real timer/socket — same reason pollOnce
// (poller.ts) and handleDiscoveredLaunch (watcherOnLaunch.ts) are standalone
// functions rather than inline in server.ts. Waits RESCORE_DELAY_MS after a
// launch is scored, then re-scores just holder-concentration from trades
// BalanceIndex observed via the watcher's per-mint subscription, and updates
// the feed entry in place. See rescore.ts for why only that one signal.

import type { LiveFeed } from "./feed.js";
import type { BalanceIndex } from "./balanceIndex.js";
import type { DiscoveredLaunch } from "./discovery.js";
import { rescoreHolderConcentrationFromIndex, type RescoreRpc } from "./rescore.js";
import { combineSignals } from "./scorer.js";

export interface HolderRescoreWatcher {
  trackMint(mint: string, bondingCurve: string): void;
  untrackMint(mint: string): void;
}

export interface HolderRescoreDeps {
  feed: LiveFeed;
  scoringRpc: RescoreRpc;
  balanceIndex: BalanceIndex;
  watcher: HolderRescoreWatcher;
  delayMs: number;
  // Injectable so tests can fire the rescore synchronously instead of
  // waiting delayMs on a real timer.
  setTimeoutFn?: (callback: () => void, ms: number) => unknown;
}

export function scheduleHolderRescore(launch: DiscoveredLaunch, deps: HolderRescoreDeps): void {
  const { feed, scoringRpc, balanceIndex, watcher, delayMs, setTimeoutFn = setTimeout } = deps;

  // Seed the index with the dev's bundled buy (see discovery.ts) before
  // subscribing for further trades — trackMint only sees activity from here
  // on, so without this the mint's actual first holder is invisible to it.
  if (launch.bundledBuy) balanceIndex.recordTrade(launch.bundledBuy);
  watcher.trackMint(launch.mint, launch.bondingCurve);

  setTimeoutFn(() => {
    // The feed is bounded (LiveFeed's maxSize, see feed.ts) and this fires
    // delayMs after the launch was added — a burst of newer launches can
    // have aged this one out of the feed by now. Check before, not just in
    // the .then() below: rescoreHolderConcentrationFromIndex spends a real
    // getAccountInfo call against the scarce scoring RPC, and that call
    // happens regardless of whether anything will use its result.
    if (!feed.has(launch.mint)) {
      watcher.untrackMint(launch.mint);
      return;
    }
    rescoreHolderConcentrationFromIndex(scoringRpc, launch, balanceIndex)
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
  }, delayMs);
}
