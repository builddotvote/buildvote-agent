// Dedupes a launch across the two discovery paths (websocket watcher and
// backstop poller) while it is still being scored, not just after. Session
// 51 added a `feed.has()` check to both paths for the case where one path
// had already *finished* scoring a launch the other also discovered within
// its lookback window — but that check can't see a launch the other path
// has started scoring and not yet added to the feed, since feed.add() only
// runs once scoring completes. In that window both paths still ran all four
// signals' RPC calls against the same mint, wasting the already-strained
// scoring RPC budget on a result that was always going to lose to
// feed.add()'s existing first-one-wins dedup. This set closes that gap by
// marking a mint "claimed" the instant either path decides to score it,
// before any RPC call for it is made.
export class ScoringInFlight {
  private readonly mints = new Set<string>();

  // Returns true if this call claimed the mint (the caller should proceed
  // with scoring); false if another in-flight score already claimed it.
  // Every true result must be paired with a later release() call.
  tryAcquire(mint: string): boolean {
    if (this.mints.has(mint)) return false;
    this.mints.add(mint);
    return true;
  }

  release(mint: string): void {
    this.mints.delete(mint);
  }
}
