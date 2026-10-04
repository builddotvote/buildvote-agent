import { decodeBondingCurve, decodeCreateInstruction, PUMP_FUN_PROGRAM_ID } from "../pumpfun.js";
import { safeGetTransaction } from "../rpc.js";
import type { ParsedTransaction, SolanaRpcClient } from "../rpc.js";
import type { PriorLaunch } from "../signals/deployerHistory.js";

type HistoryFetcher = Pick<
  SolanaRpcClient,
  "getSignaturesForAddress" | "getTransaction" | "getAccountInfo"
>;

export interface FetchDeployerHistoryOptions {
  // How many of the deployer's most recent signatures to scan for past
  // pump.fun "create" instructions. A prolific deployer with more history
  // than this limit will be under-counted rather than scanned exhaustively
  // (confirmed live — see README's "Known limitations": a prolific
  // deployer's creates are a tiny fraction of its own signature history, so
  // this scan alone badly under-counts them regardless of the limit).
  signatureLimit?: number;
  // Mints this deployer is already known to have created, observed live by
  // the websocket watcher/poller rather than found by this scan (see
  // DeployerIndex). Supplements the scan above, deduped by mint — this is
  // what actually catches a prolific deployer in practice, since it doesn't
  // depend on their creates showing up densely enough in a signature window.
  observedPriorLaunches?: { mint: string; bondingCurve: string }[];
}

const DEFAULT_SIGNATURE_LIMIT = 100;

export async function fetchDeployerHistoryInput(
  rpc: HistoryFetcher,
  deployer: string,
  currentMint: string,
  options: FetchDeployerHistoryOptions = {},
): Promise<PriorLaunch[]> {
  const signatureLimit = options.signatureLimit ?? DEFAULT_SIGNATURE_LIMIT;
  const signatures = await rpc.getSignaturesForAddress(deployer, signatureLimit);

  // Resolve every signature's transaction concurrently rather than one at a
  // time: the RPC client (rpc.ts) already caps in-flight requests at its own
  // maxConcurrent, so firing these together lets it keep that many slots busy
  // instead of a backoff delay on signature N blocking signature N+1 from even
  // starting (same fix and reasoning as bundledBuys.ts's data fetch).
  const candidates = await Promise.all(
    signatures.map(async (sig) => {
      if (sig.err) return null;
      const tx = await safeGetTransaction(rpc, sig.signature);
      if (!tx) return null;
      return findCreatedMint(tx, deployer);
    }),
  );

  const seenMints = new Set<string>([currentMint]);
  const uniqueCreated: { mint: string; bondingCurve: string }[] = [];
  for (const created of candidates) {
    if (!created || seenMints.has(created.mint)) continue;
    seenMints.add(created.mint);
    uniqueCreated.push(created);
  }

  const uniqueObserved = (options.observedPriorLaunches ?? []).filter((observed) => {
    if (seenMints.has(observed.mint)) return false;
    seenMints.add(observed.mint);
    return true;
  });

  const [scannedMigrated, observedMigrated] = await Promise.all([
    Promise.all(uniqueCreated.map((c) => wasMigrated(rpc, c.bondingCurve))),
    Promise.all(uniqueObserved.map((o) => wasMigrated(rpc, o.bondingCurve))),
  ]);

  return [
    ...uniqueCreated.map((c, i) => ({ mint: c.mint, migrated: scannedMigrated[i] })),
    ...uniqueObserved.map((o, i) => ({ mint: o.mint, migrated: observedMigrated[i] })),
  ];
}

// Looks for a pump.fun create/create_v2 instruction in this transaction that
// this deployer signed as the "user" account, and returns the mint + bonding
// curve it created.
function findCreatedMint(
  tx: ParsedTransaction,
  deployer: string,
): { mint: string; bondingCurve: string } | null {
  const instructions = tx.transaction.message.instructions ?? [];
  for (const ix of instructions) {
    if (ix.programId !== PUMP_FUN_PROGRAM_ID || !("data" in ix)) continue;
    const decoded = decodeCreateInstruction(ix.data, ix.accounts);
    if (decoded && decoded.user === deployer) {
      return { mint: decoded.mint, bondingCurve: decoded.bondingCurve };
    }
  }
  return null;
}

async function wasMigrated(rpc: HistoryFetcher, bondingCurveAddress: string): Promise<boolean> {
  const account = await rpc.getAccountInfo(bondingCurveAddress);
  if (!account || !Array.isArray(account.data)) return false;
  try {
    return decodeBondingCurve(account.data[0]).complete;
  } catch {
    // Account exists but isn't a readable bonding curve (e.g. already closed) —
    // treat as "not migrated" rather than failing the whole lookup.
    return false;
  }
}
