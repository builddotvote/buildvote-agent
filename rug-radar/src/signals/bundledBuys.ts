import type { SignalResult } from "../types.js";

export interface EarlyBuy {
  buyer: string;
  // The wallet that funded this buyer's first SOL shortly before the buy,
  // or null if no funding source could be traced.
  fundedBy: string | null;
  secondsAfterLaunch: number;
}

export interface BundledBuysInput {
  earlyBuys: EarlyBuy[];
  // Only buys within this many seconds of launch count as "early". Default 5 minutes.
  windowSeconds?: number;
}

const DEFAULT_WINDOW_SECONDS = 300;
const HIGH_RISK_SHARE = 0.5;
const MODERATE_RISK_SHARE = 0.3;
const MIN_BUNDLE_SIZE = 2;

export function scoreBundledBuys(input: BundledBuysInput): SignalResult {
  const windowSeconds = input.windowSeconds ?? DEFAULT_WINDOW_SECONDS;
  const early = input.earlyBuys.filter((b) => b.secondsAfterLaunch <= windowSeconds);

  if (early.length === 0) {
    return {
      name: "bundled-buys",
      score: 0,
      reasons: ["no early buy data available"],
    };
  }

  // Distinct buyers, not buy events: a single wallet buying early more than
  // once must not inflate the denominator below (that would let a bundled
  // wallet dilute its own detected share just by repeat-buying small amounts).
  const uniqueBuyerCount = new Set(early.map((b) => b.buyer)).size;

  const bySource = new Map<string, Set<string>>();
  for (const buy of early) {
    if (!buy.fundedBy) continue;
    const buyers = bySource.get(buy.fundedBy) ?? new Set<string>();
    buyers.add(buy.buyer);
    bySource.set(buy.fundedBy, buyers);
  }

  let largestSource: string | null = null;
  let largestCount = 0;
  for (const [source, buyers] of bySource) {
    if (buyers.size > largestCount) {
      largestCount = buyers.size;
      largestSource = source;
    }
  }

  if (!largestSource || largestCount < MIN_BUNDLE_SIZE) {
    return {
      name: "bundled-buys",
      score: 0,
      reasons: [`no common funding source among ${uniqueBuyerCount} early buyer(s)`],
    };
  }

  const share = largestCount / uniqueBuyerCount;
  const sharePct = (share * 100).toFixed(1);
  const label = `${largestCount} of ${uniqueBuyerCount} early buyers were funded from one wallet (${sharePct}%) within ${windowSeconds}s of launch`;

  if (share >= HIGH_RISK_SHARE) {
    return { name: "bundled-buys", score: 90, reasons: [`${label} (>= 50%)`] };
  }
  if (share >= MODERATE_RISK_SHARE) {
    return { name: "bundled-buys", score: 55, reasons: [`${label} (30-50%)`] };
  }
  return {
    name: "bundled-buys",
    score: Math.round(share * 100),
    reasons: [label],
  };
}
