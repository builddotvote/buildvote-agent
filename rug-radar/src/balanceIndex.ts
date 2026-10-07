// Tracks each mint's per-wallet token balance, built up live from observed
// buy/sell trades (see pumpfun.ts's decodeTradeInstruction and
// wsLogParser.ts's detectTradeInstruction) — not from any indexed RPC call.
//
// Why this exists: holder concentration (signals/holderConcentration.ts)
// currently depends on getTokenLargestAccounts, which the live-RPC checks in
// README's "Known limitations" found hits the official endpoint's rate limit
// on most attempts, and no free/keyless alternative was found (session 28).
// This index is a step toward an alternative source fed by the websocket
// watcher's own already-subscribed trade instructions instead of another
// indexed call. Not wired into holderConcentration yet — only tracks
// balances here; deciding how/whether the signal should prefer this over the
// RPC call is a separate step.
//
// Necessarily incomplete, same caveat as deployerIndex.ts: only reflects
// trades observed since the process started (not a mint's full history), and
// only buy/sell — a plain SPL transfer between wallets (not through
// pump.fun's own instructions) isn't observed, so a wallet's true balance
// could be higher or lower than what this records. A sell that takes a
// wallet's tracked balance below zero (e.g. it bought before this process
// started watching) is clamped to zero rather than going negative.
//
// Bounded like DeployerIndex: a single FIFO across every (mint, wallet) pair
// ever seen, so a long-running process doesn't grow this forever.

export interface WalletBalance {
  address: string;
  balance: bigint;
}

const DEFAULT_MAX_ENTRIES = 20000;

export class BalanceIndex {
  private readonly byMint = new Map<string, Map<string, bigint>>();
  private readonly order: Array<{ mint: string; wallet: string }> = [];

  constructor(private readonly maxEntries: number = DEFAULT_MAX_ENTRIES) {}

  recordTrade(trade: { kind: "buy" | "sell"; mint: string; user: string; amount: bigint }): void {
    let wallets = this.byMint.get(trade.mint);
    if (!wallets) {
      wallets = new Map();
      this.byMint.set(trade.mint, wallets);
    }

    const isNewEntry = !wallets.has(trade.user);
    const current = wallets.get(trade.user) ?? 0n;
    const delta = trade.kind === "buy" ? trade.amount : -trade.amount;
    const next = current + delta;
    wallets.set(trade.user, next < 0n ? 0n : next);

    if (isNewEntry) {
      this.order.push({ mint: trade.mint, wallet: trade.user });
      if (this.order.length > this.maxEntries) {
        const oldest = this.order.shift();
        if (oldest) {
          const oldestWallets = this.byMint.get(oldest.mint);
          oldestWallets?.delete(oldest.wallet);
          if (oldestWallets && oldestWallets.size === 0) this.byMint.delete(oldest.mint);
        }
      }
    }
  }

  // Wallets with a positive observed balance for this mint, excluding the
  // given addresses (e.g. the bonding curve itself, same exclusion list
  // holderConcentration already uses). Wallets that sold out to zero are
  // left out — they aren't holders anymore.
  getHolders(mint: string, excludeAddresses: string[] = []): WalletBalance[] {
    const wallets = this.byMint.get(mint);
    if (!wallets) return [];

    const excluded = new Set(excludeAddresses);
    const result: WalletBalance[] = [];
    for (const [address, balance] of wallets) {
      if (excluded.has(address)) continue;
      if (balance <= 0n) continue;
      result.push({ address, balance });
    }
    return result;
  }
}
