// Reads config from environment only. Never hardcode RPC URLs, keys, or secrets here.

export interface Config {
  // Used for per-signal data fetches (getTokenSupply, getTokenLargestAccounts,
  // getAccountInfo, plus deployer-history/bundled-buys' own signature scans).
  rpcUrl: string;
  // Used for launch *discovery* (the websocket watcher's logsSubscribe +
  // getTransaction, and the backstop poller's getSignaturesForAddress scan).
  // Confirmed live (session 20): api.mainnet-beta.solana.com's rate limit is
  // tight enough that this path's getTransaction volume hit HTTP 429 on
  // effectively every call (172/172 in a 90s check) and resolved zero
  // launches. solana-rpc.publicnode.com handled the same volume with zero
  // 429s (37-42 launches resolved in the same window) and supports
  // logsSubscribe, but its free tier blocks "indexed" token methods
  // (getTokenSupply, getTokenLargestAccounts) behind a personal-token signup
  // — those stay on rpcUrl above. Separate env vars so either can be
  // overridden independently if these numbers change or a provider's limits
  // shift.
  discoveryRpcUrl: string;
  // Optional override for providers whose websocket host differs from their
  // discovery HTTP host. When unset, server.ts derives it from
  // discoveryRpcUrl (see wsDiscovery.ts's deriveWsUrl).
  wsUrl: string | undefined;
  port: number;
}

const DEFAULT_RPC_URL = "https://api.mainnet-beta.solana.com";
const DEFAULT_DISCOVERY_RPC_URL = "https://solana-rpc.publicnode.com";

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const rpcUrl = env.SOLANA_RPC_URL || DEFAULT_RPC_URL;
  const discoveryRpcUrl = env.SOLANA_DISCOVERY_RPC_URL || DEFAULT_DISCOVERY_RPC_URL;
  const wsUrl = env.SOLANA_WS_URL || undefined;
  const port = Number.parseInt(env.PORT ?? "8787", 10);
  return { rpcUrl, discoveryRpcUrl, wsUrl, port: Number.isFinite(port) ? port : 8787 };
}
