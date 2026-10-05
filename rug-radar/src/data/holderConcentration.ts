import type { SolanaRpcClient } from "../rpc.js";
import type { HolderConcentrationInput } from "../signals/holderConcentration.js";

type SupplyAndLargestAccounts = Pick<SolanaRpcClient, "getTokenSupply" | "getTokenLargestAccounts">;

export async function fetchHolderConcentrationInput(
  rpc: SupplyAndLargestAccounts,
  mint: string,
  excludedAddresses: string[],
  // The bonding curve account already carries token_total_supply (fixed at
  // creation, never changed by buy/sell — see pumpfun.ts), so when the
  // caller already fetched it (pipeline.ts, shared with the liquidity
  // signal) we can skip the separate getTokenSupply call entirely. Falls
  // back to fetching it here when not provided, so this still works
  // standalone.
  knownTotalSupply?: bigint,
): Promise<HolderConcentrationInput> {
  const [totalSupply, largest] = await Promise.all([
    knownTotalSupply !== undefined ? knownTotalSupply : rpc.getTokenSupply(mint).then((s) => BigInt(s.amount)),
    rpc.getTokenLargestAccounts(mint),
  ]);

  return {
    totalSupply,
    holders: largest.map((h) => ({ address: h.address, amount: BigInt(h.amount) })),
    excludedAddresses,
  };
}
