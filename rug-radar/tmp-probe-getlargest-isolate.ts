// Narrows down tmp-probe-getlargest-slow.ts's 100%-429-at-any-rate result:
// is it the method (getTokenLargestAccounts), the specific mint (USDC, a
// huge/expensive-to-rank token), or neither (maybe this IP/session is just
// cooling down from the earlier burst)? Tries: a cheaper indexed method
// (getTokenSupply) on the same mint, getTokenLargestAccounts on a different,
// much smaller mint, and getSlot (session 42's known-good baseline) as a
// sanity check that this isn't a total IP block.
const RPC_URL = "https://api.mainnet-beta.solana.com";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

async function call(method: string, params: unknown[]): Promise<number> {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return res.status;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log("getSlot (known-good baseline, session 42):", await call("getSlot", []));
  await sleep(3000);
  console.log("getTokenSupply(USDC):", await call("getTokenSupply", [USDC]));
  await sleep(3000);
  console.log("getTokenLargestAccounts(USDC):", await call("getTokenLargestAccounts", [USDC]));
  await sleep(3000);
  console.log("getAccountInfo(USDC mint):", await call("getAccountInfo", [USDC, { encoding: "base64" }]));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
