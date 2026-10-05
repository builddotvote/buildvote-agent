import type { SolanaRpcClient } from "../rpc.js";
import type { BondingCurveAccount } from "../pumpfun.js";
import type { LiquidityInput } from "../signals/liquidity.js";
import { fetchBondingCurveAccount } from "./bondingCurve.js";

type AccountInfoFetcher = Pick<SolanaRpcClient, "getAccountInfo">;

export async function fetchLiquidityInput(
  rpc: AccountInfoFetcher,
  bondingCurveAddress: string,
  // Pass an already-fetched curve (e.g. from pipeline.ts, shared with
  // holder-concentration) to skip fetching it again here.
  knownCurve?: BondingCurveAccount,
): Promise<LiquidityInput> {
  const curve = knownCurve ?? (await fetchBondingCurveAccount(rpc, bondingCurveAddress));
  return {
    complete: curve.complete,
    realSolReserves: curve.realSolReserves,
  };
}
