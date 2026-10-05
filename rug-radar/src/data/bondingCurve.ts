import type { SolanaRpcClient } from "../rpc.js";
import { decodeBondingCurve, type BondingCurveAccount } from "../pumpfun.js";

type AccountInfoFetcher = Pick<SolanaRpcClient, "getAccountInfo">;

// Shared by liquidity and holder-concentration: both need the bonding
// curve's decoded account data (liquidity for complete/realSolReserves,
// holder-concentration for tokenTotalSupply, avoiding a separate
// getTokenSupply call — see pipeline.ts). Fetched once per launch and
// passed to both instead of each signal fetching it independently.
export async function fetchBondingCurveAccount(
  rpc: AccountInfoFetcher,
  bondingCurveAddress: string,
): Promise<BondingCurveAccount> {
  const account = await rpc.getAccountInfo(bondingCurveAddress, "base64");
  if (!account) {
    throw new Error(`bonding curve account not found: ${bondingCurveAddress}`);
  }

  const [base64Data] = account.data as [string, string];
  return decodeBondingCurve(base64Data);
}
