import { safeGetTransaction } from "../rpc.js";
import type { ParsedTransaction, SolanaRpcClient } from "../rpc.js";
import type { EarlyBuy } from "../signals/bundledBuys.js";

type BuysFetcher = Pick<SolanaRpcClient, "getSignaturesForAddress" | "getTransaction">;

export interface FetchBundledBuysOptions {
  windowSeconds?: number;
  // How many recent signatures to scan, both for the bonding curve and for
  // each buyer's own history when looking for their funding source. A real
  // wallet's true first-ever transaction could be older than this limit —
  // in that case the funding source is reported as unknown rather than wrong.
  signatureLimit?: number;
}

const DEFAULT_WINDOW_SECONDS = 300;
const DEFAULT_SIGNATURE_LIMIT = 50;

export async function fetchBundledBuysInput(
  rpc: BuysFetcher,
  mint: string,
  bondingCurveAddress: string,
  launchTimestampSec: number,
  options: FetchBundledBuysOptions = {},
): Promise<EarlyBuy[]> {
  const windowSeconds = options.windowSeconds ?? DEFAULT_WINDOW_SECONDS;
  const signatureLimit = options.signatureLimit ?? DEFAULT_SIGNATURE_LIMIT;

  const signatures = await rpc.getSignaturesForAddress(bondingCurveAddress, signatureLimit);
  const early = signatures.filter((sig) => {
    if (sig.blockTime === null) return false;
    const delta = sig.blockTime - launchTimestampSec;
    return delta >= 0 && delta <= windowSeconds;
  });

  // Resolve every early signature's transaction concurrently rather than one
  // at a time: the RPC client (rpc.ts) already caps in-flight requests at its
  // own maxConcurrent, so firing these together lets it keep that many slots
  // busy instead of a backoff delay on signature N blocking signature N+1
  // from even starting (confirmed live — see README's "Known limitations").
  const resolved = await Promise.all(
    early.map(async (sig) => {
      const tx = await safeGetTransaction(rpc, sig.signature);
      if (!tx) return null;
      const buyer = findTokenReceiver(tx, mint);
      if (!buyer) return null;
      return { buyer, secondsAfterLaunch: (sig.blockTime as number) - launchTimestampSec };
    }),
  );
  const found = resolved.filter((r): r is NonNullable<typeof r> => r !== null);

  // Look up each distinct buyer's funding source once, also concurrently,
  // instead of per-occurrence — same dedup intent as the old fundingCache,
  // just resolved as one parallel batch rather than built up sequentially.
  const uniqueBuyers = [...new Set(found.map((f) => f.buyer))];
  const fundingEntries = await Promise.all(
    uniqueBuyers.map(async (buyer): Promise<[string, string | null]> => [
      buyer,
      await findFundingSource(rpc, buyer, signatureLimit),
    ]),
  );
  const fundingMap = new Map(fundingEntries);

  return found.map((f) => ({
    buyer: f.buyer,
    fundedBy: fundingMap.get(f.buyer) ?? null,
    secondsAfterLaunch: f.secondsAfterLaunch,
  }));
}

// The buyer is whichever owner's balance of `mint` went up in this transaction.
function findTokenReceiver(tx: ParsedTransaction, mint: string): string | null {
  const pre = tx.meta?.preTokenBalances ?? [];
  const post = tx.meta?.postTokenBalances ?? [];

  for (const entry of post) {
    if (entry.mint !== mint || !entry.owner) continue;
    const preEntry = pre.find((e) => e.accountIndex === entry.accountIndex);
    const preAmount = preEntry ? BigInt(preEntry.uiTokenAmount.amount) : 0n;
    const postAmount = BigInt(entry.uiTokenAmount.amount);
    if (postAmount > preAmount) {
      return entry.owner;
    }
  }
  return null;
}

// Walk back to the buyer's earliest known transaction (within signatureLimit)
// and find who sent them SOL there — a rough proxy for "who funded this wallet".
async function findFundingSource(
  rpc: BuysFetcher,
  buyer: string,
  signatureLimit: number,
): Promise<string | null> {
  const signatures = await rpc.getSignaturesForAddress(buyer, signatureLimit);
  if (signatures.length === 0) return null;

  // getSignaturesForAddress returns newest-first, so the last entry is the
  // oldest one visible within our limit.
  const earliest = signatures[signatures.length - 1];
  const tx = await safeGetTransaction(rpc, earliest.signature);
  if (!tx) return null;

  return findSolSender(tx, buyer);
}

// The sender is whichever other account's lamport balance dropped the most
// while the recipient's balance rose, in a transaction touching both.
function findSolSender(tx: ParsedTransaction, recipient: string): string | null {
  const keys = tx.transaction.message.accountKeys;
  const preBalances = tx.meta?.preBalances;
  const postBalances = tx.meta?.postBalances;
  if (!preBalances || !postBalances) return null;

  const recipientIndex = keys.findIndex((k) => k.pubkey === recipient);
  if (recipientIndex === -1) return null;
  if (postBalances[recipientIndex] <= preBalances[recipientIndex]) return null;

  let senderIndex = -1;
  let largestDecrease = 0n;
  for (let i = 0; i < keys.length; i++) {
    if (i === recipientIndex) continue;
    const decrease = BigInt(preBalances[i]) - BigInt(postBalances[i]);
    if (decrease > largestDecrease) {
      largestDecrease = decrease;
      senderIndex = i;
    }
  }

  return senderIndex === -1 ? null : keys[senderIndex].pubkey;
}
