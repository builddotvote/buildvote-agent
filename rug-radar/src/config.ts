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
  // Optional override for the discovery websocket host. When unset,
  // server.ts defaults to the official endpoint (api.mainnet-beta.solana.com)
  // rather than deriving one from discoveryRpcUrl — live-tested (session
  // 109): discoveryRpcUrl's default host acks every logsSubscribe but never
  // pushes a notification, while the official endpoint does. See server.ts
  // for the full finding and tradeoffs.
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
  // Must be a valid TCP port (1-65535): Number.isFinite alone lets through
  // negative/zero/out-of-range values that reach server.listen and throw a
  // synchronous RangeError instead of falling back cleanly.
  const validPort = Number.isInteger(port) && port > 0 && port <= 65535;
  return { rpcUrl, discoveryRpcUrl, wsUrl, port: validPort ? port : 8787 };
}
