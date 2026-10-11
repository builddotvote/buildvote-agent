const RPC_URL = "https://api.mainnet-beta.solana.com";
const MINTS = [
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
  "So11111111111111111111111111111111111111112",
];
async function call(mint: string): Promise<number> {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTokenLargestAccounts", params: [mint] }),
  });
  const body = await res.text();
  return res.status;
}
function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
async function main() {
  for (let i = 0; i < 6; i++) {
    const mint = MINTS[i % MINTS.length];
    const status = await call(mint);
    console.log(`attempt ${i+1} mint=${mint.slice(0,6)} status=${status}`);
    await sleep(5000);
  }
}
main();
