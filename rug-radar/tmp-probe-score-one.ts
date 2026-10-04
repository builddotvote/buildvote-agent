import { SolanaRpcClient } from "./src/rpc.js";

async function main() {
  const rpc = new SolanaRpcClient("https://api.mainnet-beta.solana.com", fetch, { maxConcurrent: 2 });
  const start = Date.now();
  try {
    const supply = await rpc.getTokenSupply("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
    console.log("getTokenSupply ok in", Date.now() - start, "ms", supply);
  } catch (err) {
    console.log("getTokenSupply failed in", Date.now() - start, "ms:", err instanceof Error ? err.message : err);
  }
}
main();
