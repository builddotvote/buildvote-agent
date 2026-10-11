// Follow-up to tmp-probe-getlargest-pacing.ts: that probe hit 100% 429 at
// both 2.5req/s and 1req/s, unlike getSlot's 0% at 2.5req/s (session 42) or
// getTransaction's 0% at 0.5req/s (session 44). Two possible explanations:
// (a) getTokenLargestAccounts really is throttled far more strictly than
// even getTransaction, or (b) the first probe's own 75-call burst at
// 2.5req/s triggered a temporary cooldown that was still active during the
// second phase. This checks (b) by waiting, then trying a single call, then
// a very slow sustained rate (0.1 req/s) to see if it ever clears.
const RPC_URL = "https://api.mainnet-beta.solana.com";
const MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"; // USDC

async function call(): Promise<number> {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTokenLargestAccounts", params: [MINT] }),
  });
  return res.status;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log("waiting 30s for any cooldown to clear...");
  await sleep(30_000);
  for (let i = 0; i < 10; i++) {
    const status = await call();
    console.log(`single call #${i + 1} (10s apart): status=${status}`);
    await sleep(10_000);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
