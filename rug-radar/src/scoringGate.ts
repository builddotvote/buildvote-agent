// Caps how many launches can be scoring at once. A launch beyond the cap is
// dropped, not queued — queuing would just grow an unbounded backlog against
// a rate-limited scoring RPC (confirmed live, session 20: with no cap, a
// burst of launches from the websocket watcher all started scoring at once,
// all contending for the scoring client's maxConcurrent:2 HTTP slots, and
// none completed within a 100s window). The live feed already tolerates a
// missed launch, so dropping is a safe failure mode here.
export class ScoringGate {
  private inFlight = 0;

  constructor(private readonly maxConcurrent: number) {}

  // Returns true if the caller should proceed with scoring (a slot was
  // reserved); false if the gate is full and this launch should be skipped.
  // Every true result must be paired with a later release() call.
  tryAcquire(): boolean {
    if (this.inFlight >= this.maxConcurrent) return false;
    this.inFlight++;
    return true;
  }

  release(): void {
    this.inFlight--;
  }
}
