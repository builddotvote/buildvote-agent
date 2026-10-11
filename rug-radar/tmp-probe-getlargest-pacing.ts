// Throwaway probe (deleted after use, not part of the app): measures
// getTokenLargestAccounts's own safe sustained rate against the real
// official endpoint, same shape as session 44's getTransaction probe
// (tmp-probe-gettx-pacing.ts). Session 44 found getTokenLargestAccounts is
// now the dominant 429 source once getTransaction got its own slower lane
// (5 429s in a 112s live run, all on getTokenLargestAccounts) but never
// measured its safe rate directly the way getTransaction and getSlot were.
//
// Real, public, well-known SPL mints (USDC, BONK, wrapped SOL) — no keys,
// no private data, cycled through so the probe isn't hammering one mint's
// cached response over and over.
const MINTS = [
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", // BONK
  "So11111111111111111111111111111111111111112", // wrapped SOL
];

const RPC_URL = "https://api.mainnet-beta.solana.com";

async function callGetTokenLargestAccounts(mint: string): Promise<{ ok: boolean; status: number }> {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getTokenLargestAccounts",
      params: [mint],
    }),
  });
  return { ok: res.status !== 429, status: res.status };
}

async function runAtRate(label: string, intervalMs: number, durationMs: number): Promise<void> {
  const start = Date.now();
  let total = 0;
  let rateLimited = 0;
  let i = 0;
  while (Date.now() - start < durationMs) {
    const mint = MINTS[i % MINTS.length]!;
    i++;
    const callStart = Date.now();
    try {
      const { ok, status } = await callGetTokenLargestAccounts(mint);
      total++;
      if (!ok) rateLimited++;
      if (!ok) console.log(`  [${label}] #${total} status=${status}`);
    } catch (err) {
      total++;
      console.log(`  [${label}] #${total} error=${err instanceof Error ? err.message : err}`);
    }
    const elapsed = Date.now() - callStart;
    const wait = intervalMs - elapsed;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }
  const pct = total > 0 ? ((rateLimited / total) * 100).toFixed(1) : "0.0";
  console.log(`[${label}] rate=${(1000 / intervalMs).toFixed(2)}req/s total=${total} 429s=${rateLimited} (${pct}%)`);
}

async function main() {
  // 2.5 req/sec: the rate that ran getSlot 40s with zero 429s (session 42)
  // and getTokenLargestAccounts's own share of the 400ms default lane
  // (session 43/44's live checks never isolated it at this exact rate).
  await runAtRate("2.5req/s-400ms", 400, 30_000);
  // 1 req/sec: midpoint probe, same as getTransaction's narrowing step.
  await runAtRate("1req/s-1000ms", 1000, 20_000);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
