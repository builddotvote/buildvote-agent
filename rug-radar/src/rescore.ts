// Re-scores a launch's holder-concentration signal using trades observed
// live via BalanceIndex, instead of the rate-limited getTokenLargestAccounts
// call signals/holderConcentration.ts normally depends on (see README's
// "Known limitations"). Meant to be called some time after a launch's
// initial score, once LaunchWatcher.trackMint has had a chance to observe
// some buys/sells for that mint (see server.ts for the delay and wiring).
//
// Deliberately re-scores only holder-concentration, not the whole launch:
// re-running the other three signals here would add calls against the same
// rate-limited scoring RPC this exists to avoid, for signals BalanceIndex
// has no data for anyway.

import { fetchBondingCurveAccount } from "./data/bondingCurve.js";
import { scoreHolderConcentration } from "./signals/holderConcentration.js";
import { KNOWN_PROGRAM_ACCOUNT_ADDRESSES } from "./knownAccounts.js";
import type { SolanaRpcClient } from "./rpc.js";
import type { DiscoveredLaunch } from "./discovery.js";
import type { BalanceIndex } from "./balanceIndex.js";
import type { SignalResult } from "./types.js";

type RescoreRpc = Pick<SolanaRpcClient, "getAccountInfo">;

// Returns null when there's nothing worth replacing the existing signal
// with: no trades observed yet for this mint, or the bonding curve account
// (needed for total supply) can't be read.
export async function rescoreHolderConcentrationFromIndex(
  rpc: RescoreRpc,
  launch: DiscoveredLaunch,
  balanceIndex: BalanceIndex,
): Promise<SignalResult | null> {
  const holders = balanceIndex.getHolders(launch.mint, [
    launch.bondingCurve,
    ...KNOWN_PROGRAM_ACCOUNT_ADDRESSES,
  ]);
  if (holders.length === 0) return null;

  const curve = await fetchBondingCurveAccount(rpc, launch.bondingCurve).catch(() => undefined);
  if (!curve) return null;

  return scoreHolderConcentration({
    totalSupply: curve.tokenTotalSupply,
    holders: holders.map((h) => ({ address: h.address, amount: h.balance })),
    excludedAddresses: [],
  });
}
