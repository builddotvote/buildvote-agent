# rug radar

Live risk scoring for new pump.fun token launches on Solana, built from public
on-chain data only. Watches new launches, scores each one from a handful of
signals, and serves a small live feed page.

Status: all five steps of `../TASK.md` are built — data layer, all four
signals, the combined score, launch discovery, and the live feed page — and
have been sanity-checked against live mainnet-beta, not just offline
fixtures. Discovery now runs primarily over a websocket (real-time, not
polling-and-missing-most-of-it) with the old signature poller kept as a
backstop, and (session 20) over a second public RPC endpoint that isn't
rate-limited into uselessness like the official one currently is. See
`../PROGRESS.md` for the full history and "Known limitations" below for
what's still rough (now mainly: the *data/scoring* RPC's rate limit, since
discovery itself works).

## Data layer

`src/rpc.ts` is a thin client for the public Solana JSON-RPC API
(`getTokenSupply`, `getTokenLargestAccounts`, `getAccountInfo`,
`getSignaturesForAddress`, `getTransaction`). It takes the RPC URL from env
and never touches keys. Tests mock `fetch` with recorded response fixtures —
no live calls.

`src/knownAccounts.ts` lists well-known Solana program addresses (token
program, associated token program, system program) that signals exclude
when looking at real holders.

`src/base58.ts` is a small base58 codec (no dependency) used to turn raw
pubkey bytes from account data back into the addresses everyone recognizes.

`src/pumpfun.ts` has the pump.fun program ID, the bonding curve account
layout (`decodeBondingCurve`), and the `create`/`create_v2` instruction
layout (`decodeCreateInstruction`), per the program's public Anchor IDL at
[pump-fun/pump-public-docs](https://github.com/pump-fun/pump-public-docs)
(`idl/pump.json`). The bonding curve is a PDA per mint (seeds
`["bonding-curve", mint]`); rather than re-deriving it, both the liquidity
signal and deployer history read the address straight out of the relevant
transaction (the bonding curve account itself, or the `create` instruction's
account list).

## Signals

1. **Deployer history** — how many tokens this wallet launched before and how
   they ended. **Built:** `src/signals/deployerHistory.ts` (pure scoring
   function) + `src/data/deployerHistory.ts` (scans the deployer's
   transaction history for past pump.fun `create`/`create_v2` instructions,
   then checks each prior mint's bonding curve for whether it migrated).
   Supplemented by `src/deployerIndex.ts`, a shared in-memory index that both
   discovery paths (websocket watcher and backstop poller, see `server.ts`)
   record every launch into as they see it live; `fetchDeployerHistoryInput`
   merges this live-observed history in alongside its own retroactive scan.
   See "Known limitations" below for why the retroactive scan alone wasn't
   enough, and what this does and doesn't fix.
2. **Bundled buys** — wallets funded from one source that bought in the first
   minutes. **Built:** `src/signals/bundledBuys.ts` (pure scoring function) +
   `src/data/bundledBuys.ts` (finds early buyers of the mint from the bonding
   curve's transaction history, then traces each buyer's earliest known
   transaction to find who funded them with SOL).
3. **Holder concentration** — top 10 holder share, excluding the bonding
   curve and known program accounts. **Built:** `src/signals/holderConcentration.ts`
   (pure scoring function) + `src/data/holderConcentration.ts` (gathers the
   input via `rpc.ts`).
4. **Liquidity and migration status** — real SOL reserves still backing the
   bonding curve, and whether it has graduated to an AMM. **Built:**
   `src/signals/liquidity.ts` (pure scoring function) + `src/data/liquidity.ts`
   (fetches the bonding curve account via `rpc.ts` and decodes it with
   `pumpfun.ts`).

Each signal lives in its own module under `src/signals/` with offline tests
using recorded sample data — no live network calls in tests. Data-gathering
helpers that call the RPC layer live in `src/data/`, kept separate from the
pure scoring logic so the scoring can be tested without any network mocking.

## Score

`src/scorer.ts` combines a launch's `SignalResult[]` into one `LaunchScore`:
a weighted average (0-100, higher is riskier) with every signal's reasons
attached so the number is never shown without its "why". Liquidity and
holder concentration — the most direct rug-pull indicators — carry double
the weight of wallet-behavior signals like bundled buys; any signal not
listed defaults to a weight of 1, so the combiner doesn't need updating
every time a new signal lands.

## Live feed

Two discovery paths feed the same pipeline:

- **`src/wsDiscovery.ts`** (primary) — `LaunchWatcher` opens a websocket
  `logsSubscribe` with a `mentions` filter on the pump.fun program ID. Every
  push includes the transaction's log lines for free; `src/wsLogParser.ts`
  checks those client-side for a `create`/`create_v2` instruction (confirmed
  against real traffic — `mentions` matches every instruction type, not just
  creates, so this check is what keeps most pushes from costing an RPC call)
  before calling `getTransaction` on the rare subset that matches. Reconnects
  with exponential backoff on a dropped connection. Needs Node's
  `--experimental-websocket` flag (Node 20 doesn't expose `WebSocket`
  globally without it) — already wired into the `dev`/`start` scripts via
  `NODE_OPTIONS`.
- **`src/discovery.ts`** (backstop) — the original signature-polling
  approach, kept running on a 15s interval so a launch created during
  startup or a reconnect gap isn't lost. `resolveLaunchFromSignature` (used
  by both paths) is shared so they decode a `create` the same way.

`resolveLaunchFromSignature` retries a `getTransaction` call that comes back
"not found" with exponential backoff (5 retries, 750ms base, ~23s budget)
before giving up — confirmed live that the public RPC's multi-node cluster
can take several seconds (one measured sample: ~8.5s) to make a signature
the websocket watcher just saw visible to `getTransaction`. Without the
retry, that launch was silently dropped forever (a "not found" result isn't
an exception, so nothing surfaced the loss). A transaction that resolves but
isn't a create instruction is never retried — only the "doesn't exist yet"
case is transient. **A thrown error (e.g. a 429 that exhausted `rpc.ts`'s own
retries) is not retried either** (fixed session 19, see "Known limitations"):
it used to be swallowed to the same `null` as "not found yet" and retried
identically, which meant a rate-limit exhaustion triggered up to 5 more
rounds of `rpc.ts`'s own 4-retry backoff — amplifying load on an endpoint
that had just asked for a slower pace, instead of backing off from it.

`src/pipeline.ts` turns one discovered launch into a full `LaunchScore` by
running all four signals' data-fetch + score functions (a signal that fails
to fetch — e.g. too early for holder data to settle — is dropped rather than
failing the whole launch). `src/feed.ts` is a bounded in-memory list, newest
first, deduplicated by mint (`has()`/`add()`) so the same launch landing via
both the watcher and the backstop poll only scores once. `src/server.ts`
wires both discovery paths into the feed and serves it from `GET /api/feed`.
`public/index.html` polls that endpoint every 10s and renders each launch's
score and per-signal reasons.

`src/rpc.ts` retries calls with backoff on HTTP 429, caps how many requests
are in flight at once per client (`maxConcurrent`), and requests
`maxSupportedTransactionVersion: 1` (mainnet-beta now rejects `0` for most
current transactions) — all three confirmed against live traffic, not
guessed.

**Two public RPC endpoints, not one (session 20).** `config.ts`'s
`discoveryRpcUrl` (env `SOLANA_DISCOVERY_RPC_URL`, defaults to
`solana-rpc.publicnode.com`) is used only for *discovery* — the websocket
watcher's `logsSubscribe`/`getTransaction` and the backstop poller's
`getSignaturesForAddress` scan. `rpcUrl` (env `SOLANA_RPC_URL`, unchanged
default `api.mainnet-beta.solana.com`) is used only for *scoring* — each
launch's four signals, including deployer-history/bundled-buys' own
`getTransaction` scans. Why split: a live check found the official
endpoint's rate limit tight enough that discovery's `getTransaction` volume
hit HTTP 429 on effectively every call (172/172 in a 90s check) and resolved
**zero** launches; the same 90s check against `solana-rpc.publicnode.com`
resolved 37-42 launches with **zero** 429s. It can't fully replace the
official endpoint, though — its free tier blocks "indexed" token methods
(`getTokenSupply`, `getTokenLargestAccounts`, both needed by holder
concentration) behind a personal-token signup, which isn't a bare public
endpoint in the same sense. Hence the split rather than a full swap.
`src/server.ts` builds four `SolanaRpcClient`s (discovery × 2 paths, scoring
× 2 paths), each `maxConcurrent: 2` — same fairness reasoning as before
(session 11): the websocket watcher's resolve is latency-sensitive, the
backstop poller's scans run in bursts, and splitting a budget per-path stops
one from starving the other's share, now applied per endpoint instead of
one shared endpoint.

### Known limitations

- **Discovery's rate-limit wall (sessions 8-19) is fixed by pointing
  discovery at a different public endpoint (session 20) — but fixing it
  exposed a new bottleneck on the scoring side.** The official endpoint
  (`api.mainnet-beta.solana.com`) was confirmed live to resolve **zero**
  launches over a 3-minute `LaunchWatcher` check (session 19) and a 90s
  re-check this session (172/172 `getTransaction` calls hit 429). Switching
  discovery's RPC to `solana-rpc.publicnode.com` (see "Live feed" above)
  resolved 37-42 launches with zero 429s in the same 90s window — discovery
  now actually works. Booting the real server end-to-end afterward, though,
  found that discovery *working* now pushes far more launches into scoring
  than before (previously there was almost nothing to score), and scoring
  still runs over the official, rate-limited endpoint (`rpcUrl`, needed for
  `getTokenSupply`/`getTokenLargestAccounts` that the discovery endpoint
  blocks — see "Live feed" above). A 100-second live boot saw 18 signal
  failures (mostly `getTokenLargestAccounts` 429s) and zero launches land in
  `/api/feed` — not a hang (an isolated, single `getTokenSupply` call against
  the same endpoint at the same time succeeded in 157ms), but a queue of
  scoring work arriving faster than `maxConcurrent: 2` can drain against a
  rate-limited endpoint. This is a new, concrete finding, not yet fixed:
  worth either a backpressure mechanism (cap how many launches can be
  pending scoring at once, dropping/skipping the rest — the feed already
  tolerates missed launches) or accepting slower, lower-coverage scoring as
  inherent to combining "free discovery endpoint" with "free data endpoint
  with different limits," same category of tradeoff as the rate limit itself.
- Previously documented here (session 19): a thrown 429 error (after
  `rpc.ts`'s own 4 retries were exhausted) used to be swallowed by
  `safeGetTransaction` to the same `null` as a genuine "not found yet"
  result, so `resolveLaunchFromSignature`'s not-found retry loop retried a
  rate-limit exhaustion exactly like replication lag — up to 5 more rounds,
  each re-running `rpc.ts`'s own 4-retry backoff. Fixed in
  `resolveLaunchFromSignature` (`src/discovery.ts`): a thrown error now gives
  up immediately instead of entering the not-found retry loop (see
  `src/discovery.test.ts`'s "does not retry a thrown error" test). Still
  correct and unaffected by this session's endpoint split.
- The old signature-polling path (`src/discovery.ts`) under-samples on its
  own — confirmed live, the pump.fun program sees roughly 500 tx/second
  across every instruction type combined, so 1000 signatures from
  `getSignaturesForAddress` span only ~2 seconds. This is why it's now the
  backstop rather than the primary path; the websocket watcher above doesn't
  have this problem since it's push-based, not sampled.
- **Deployer history's retroactive scan alone under-counted badly for the
  exact wallets it most needs to catch** (confirmed live: a real deployer
  creating a mint roughly every 1-2 seconds still showed only 0-1 "prior
  launches" within `fetchDeployerHistoryInput`'s default 100-signature scan —
  a false-negative scoring `0`, the lowest possible risk, for one of the most
  prolific creators seen during testing). **Partially fixed:**
  `src/deployerIndex.ts` now builds a running `deployer -> prior mints` index
  from every launch either discovery path (websocket watcher or backstop
  poller) observes live, and `fetchDeployerHistoryInput` merges it in
  alongside the retroactive scan. This stops under-counting a repeat offender
  *going forward* once the process has seen them create twice. It does not
  help a deployer's pre-existing (pre-startup) history — that's still bounded
  by the retroactive scan's lookback limit, which raising doesn't fix cheaply
  (more signatures scanned means more `getTransaction` calls, i.e. worse
  429s) since creates are such a small fraction of a prolific wallet's own
  signature history. **Live-confirmed:** watching the same prolific deployer
  (`4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf`) create several mints in a
  row, the live-observed index caught the pattern the retroactive scan alone
  missed — the signal's score rose from `40` ("too few prior tokens") to `90`
  ("4 of 4 prior tokens from this deployer never migrated") by its 4th
  observed launch in the same process, using only the index (a 1-signature
  retroactive scan limit was used in the check, to isolate the index's
  contribution from the scan's).
- `findFundingSource` (in `src/data/bundledBuys.ts`) has the same style of
  lookback-limit cap (default 50 signatures) for a buyer's funding source —
  still not live-checked against a real long-history wallet. Blocked in
  sessions 16/19 because discovery couldn't resolve a live launch to test
  against at all; that's now fixed (see the top entry above), but
  `findFundingSource` itself calls `getSignaturesForAddress`/`getTransaction`
  on the scoring (official, rate-limited) endpoint, so it still needs the
  scoring-side backlog above to be manageable enough to get a result back
  before it can be checked.

## Setup

Requires Node 20+.

```bash
npm install
cp .env.example .env
```

Edit `.env` if you want different public RPC endpoints than the defaults —
`SOLANA_RPC_URL` (scoring, default `https://api.mainnet-beta.solana.com`) and
`SOLANA_DISCOVERY_RPC_URL` (discovery, default
`https://solana-rpc.publicnode.com`), see "Live feed" above for why they
differ. No API keys are needed or used for either.

## Run

```bash
npm run dev     # start the web feed with auto-reload
npm start        # start it once, no reload
```

Then open http://localhost:8787 (or your configured `PORT`).

## Test

```bash
npm test
```

Tests run offline against recorded sample data, not live RPC calls.

## Other scripts

```bash
npm run typecheck   # type-check without emitting
npm run build        # compile to dist/
```
