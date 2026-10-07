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
layout (`decodeBondingCurve`), the `create`/`create_v2` instruction layout
(`decodeCreateInstruction`), and the `buy`/`sell`/`buy_v2`/`sell_v2`
instruction layout (`decodeTradeInstruction`, session 29/30) — all per the
program's public Anchor IDL at
[pump-fun/pump-public-docs](https://github.com/pump-fun/pump-public-docs)
(`idl/pump.json`). The bonding curve is a PDA per mint (seeds
`["bonding-curve", mint]`); rather than re-deriving it, both the liquidity
signal and deployer history read the address straight out of the relevant
transaction (the bonding curve account itself, or the `create` instruction's
account list).

`decodeTradeInstruction` reads the kind (`buy`/`sell`), `mint`/`bondingCurve`/
`user` accounts, and the token `amount` traded out of a buy or sell
instruction — confirmed against the public IDL's discriminators and account
order (not guessed; see session 30 below for a case where a webfetch summary
of this same IDL *was* effectively a guess and had to be caught). Not wired
into anything yet: it's groundwork for the self-built holder/balance index
floated in session 28's "Known limitations" as an alternative to the
rate-limited `getTokenLargestAccounts` call — that index (tracking per-wallet
balances from live buy/sell log lines, same shape as `deployerIndex.ts` but
for balances instead of launch counts) is a bigger change than one session
and hasn't been started beyond this decoder.

Session 30 found that `buy`/`sell` alone cover only part of real trade
traffic: the program's IDL also defines `buy_v2`/`sell_v2`, a separate pair
of instructions with their own discriminators and an unrelated account
layout (`mint` is `base_mint` at account index 1, `bonding_curve` at 10,
`user` at 13, vs. 2/3/6 for `buy`/`sell`). This isn't a rarely-used variant:
`wsLogParser.test.ts`'s `REAL_CREATE_V2_LOGS` fixture, captured live in
session 5, already contains `"Program log: Instruction: BuyV2"` from a real
create_v2 launch's own bundled dev buy — session 29's decoder would have
silently returned `null` for it (discriminator mismatch), not a crash, but a
quiet gap that would have undercounted real trades once wired into the
balance index. `decodeTradeInstruction` now matches all four discriminators
and picks the right account layout per match. Caught via IDL fetching: the
first webfetch summary of `idl/pump.json` reported a `sell` discriminator of
`[51, 230, 139, 6, 167, 200, 19, 62]` and a `sell_v2` of
`[233, 84, 59, 188, 5, 23, 235, 200]`, both wrong (the summarizing model
fabricated plausible-looking byte arrays); downloading the raw JSON and
parsing it directly gave the real values used in the code
(`sell`: `[51, 230, 133, 164, 1, 127, 131, 173]` — matching what was already
in the code since session 29 — and `sell_v2`:
`[93, 246, 130, 60, 231, 233, 64, 178]`). Lesson for future sessions reading
this IDL (or any other on-chain spec) via a summarizing fetch tool: treat
byte arrays and other exact values from a summary as unverified until
cross-checked against the raw source.

Session 31 added the next piece toward the balance index: `src/wsLogParser.ts`
now also exports `detectTradeInstruction(programId, logs)`, the same
invoke-stack-aware check `detectCreateInstruction` uses but matching
`Buy`/`BuyV2`/`Sell`/`SellV2` log lines instead of `Create`/`CreateV2` (both
share a new internal `ownLogLines()` helper rather than duplicating the stack
walk). Not wired into `wsDiscovery.ts` yet — still only the balance index's
groundwork, same "decoder before index" ordering as `decodeTradeInstruction`
in session 29/30.

Session 32 added the index itself: `src/balanceIndex.ts`'s `BalanceIndex`
tracks a `mint -> wallet -> balance` map, fed by `recordTrade({ kind, mint,
user, amount })` (the shape `decodeTradeInstruction` already returns). A buy
adds to the wallet's balance, a sell subtracts, clamped at zero rather than
going negative (a sell with no observed prior buy just means the wallet
bought before this process started watching — same "only reflects what's
been observed live" caveat as `deployerIndex.ts`). `getHolders(mint,
excludeAddresses?)` returns every wallet with a positive balance, excluding
the given addresses (e.g. the bonding curve), which is close to the shape
`holderConcentration`'s `HolderBalance[]` input already expects. Bounded the
same way as `deployerIndex.ts`: one FIFO across every `(mint, wallet)` pair
ever seen. Still not wired into `wsDiscovery.ts` or the holder-concentration
signal — this session only built and offline-tested the index in isolation
(`src/balanceIndex.test.ts`); deciding how/whether the signal should prefer
this over (or alongside) the rate-limited `getTokenLargestAccounts` call is
the next step, along with actually feeding it from the websocket watcher's
trade notifications.

Session 33 found a real problem with that plan before implementing it:
session 32's sketch was "run `detectTradeInstruction` on the websocket
watcher's existing program-wide `mentions` stream and `getTransaction` every
match." Checked first rather than built: log lines never carry account
addresses (confirmed by reading `wsLogParser.ts`'s own log-line fixtures —
just `Program X invoke/success` and instruction names), so there's no way to
know *which mint* a trade notification is for without already fetching the
transaction. Doing that for every trade on the program-wide stream would
mean a `getTransaction` call for a large share of *all* pump.fun traffic
network-wide (buy/sell volume dwarfs create volume) — far worse for the
rate-limit ceiling (see "Known limitations" below) than the single
`getTokenLargestAccounts` call per launch this is meant to avoid.

Fixed by scoping subscriptions instead of guessing blind: `wsDiscovery.ts`'s
`LaunchWatcher` gained `trackMint(mint, bondingCurve)` / `untrackMint(mint)`,
each opening/closing a *second kind* of `logsSubscribe` — filtered to one
mint's own bonding curve account, not the whole program — over the same
websocket connection. Only that mint's own trades get pushed, so volume
scales with how many launches this process is actively tracking, not the
whole chain. Required actually routing by the pubsub `subscription` id
(previously ignored entirely, since there was only ever one subscription):
subscribe acks are now matched by request id to learn each subscription's
id, and incoming `logsNotification`s are routed to the program-wide create
handler or the right mint's trade handler by that id. Re-subscribes every
tracked mint (fresh ids) alongside the program on every reconnect, same as
the existing create path. A matched trade notification resolves via the new
`resolveTradeFromSignature` (`discovery.ts`, sharing a `resolveWithRetry`
helper with `resolveLaunchFromSignature` — same not-found-vs-thrown-error
retry behavior from session 19, now shared instead of duplicated) and fires
`onTrade`. 11 new offline tests in `wsDiscovery.test.ts` (subscribe-on-track,
pre-connect tracking, trade resolution, a non-trade notification on a
tracked mint's subscription not calling `getTransaction`, untrack stops
routing and sends `logsUnsubscribe`, resubscribe-on-reconnect); 4 existing
tests needed a subscribe-ack emitted first to keep testing real behavior now
that routing depends on it (previously they worked by accident, since
there was only one subscription to route to).

Still not wired into `server.ts` or the holder-concentration signal. Beyond
"not started yet," there's a real design question first: `server.ts` calls
`scoreLaunch` exactly once, immediately in the `onLaunch` callback — before
any trade could have been observed for that mint even if `trackMint` fired
in the same callback. `BalanceIndex` would be empty at the one moment
holder-concentration actually runs, so naively preferring it over
`getTokenLargestAccounts` would never help the common case without also
changing *when* holder-concentration runs for a given launch (e.g. a delayed
or periodic re-score once enough trades have been observed) — a bigger,
separate decision than the subscription plumbing itself, left for a future
session rather than guessed at here.

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
   input via `rpc.ts`). Total supply can be passed in from an already-decoded
   bonding curve account instead of a separate `getTokenSupply` call — see
   `src/data/bondingCurve.ts` below and "Known limitations" (session 27).
4. **Liquidity and migration status** — real SOL reserves still backing the
   bonding curve, and whether it has graduated to an AMM. **Built:**
   `src/signals/liquidity.ts` (pure scoring function) + `src/data/liquidity.ts`
   (fetches the bonding curve account via `rpc.ts` and decodes it with
   `pumpfun.ts`).

`src/data/bondingCurve.ts` (session 27) — `fetchBondingCurveAccount()`: the
`getAccountInfo` + `decodeBondingCurve` pair factored out of liquidity's data
fetch so it can be shared. `pipeline.ts` fetches a launch's bonding curve
account once and passes the decoded result to both `fetchLiquidityInput`
(which needs all of it) and `fetchHolderConcentrationInput` (which only needs
`tokenTotalSupply` from it — the field is fixed at creation and never changed
by buy/sell, per the bonding curve layout in `pumpfun.ts`). This removes one
whole RPC call (`getTokenSupply`) per launch scored, on top of being more
direct than round-tripping through the SPL token program's own supply query.
Both signals still fall back to fetching their own copy if the shared fetch
fails, so one failure doesn't take down both.

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

**A scoring backpressure gate (session 21).** `src/scoringGate.ts`'s
`ScoringGate` caps how many launches can be scoring at once (3), shared by
the websocket watcher's `onLaunch` callback and the backstop poller
(`pollOnce`'s optional `scoringGate` param) in `src/server.ts`, since both
paths' scoring ultimately hits the same rate-limited scoring endpoint. A
launch beyond the cap is dropped (logged as "too many pending scores"), not
queued — queuing was the problem session 20 found (an ever-growing backlog
that never drained). See "Known limitations" below for what this does and
doesn't fix.

### Known limitations

- **Discovery's rate-limit wall (sessions 8-19) is fixed by pointing
  discovery at a different public endpoint (session 20); the scoring side's
  bottleneck it exposed (session 20) now has backpressure (session 21), but
  the underlying scoring-endpoint rate limit is still the binding
  constraint.** The official endpoint (`api.mainnet-beta.solana.com`) was
  confirmed live to resolve **zero** launches over a 3-minute `LaunchWatcher`
  check (session 19) and a 90s re-check (172/172 `getTransaction` calls hit
  429, session 20). Switching discovery's RPC to `solana-rpc.publicnode.com`
  (see "Live feed" above) resolved 37-42 launches with zero 429s in the same
  90s window — discovery now actually works. Booting the real server
  end-to-end afterward (session 20), though, found that discovery *working*
  now pushes far more launches into scoring than before, and scoring still
  runs over the official, rate-limited endpoint (`rpcUrl`, needed for
  `getTokenSupply`/`getTokenLargestAccounts` that the discovery endpoint
  blocks — see "Live feed" above); a 100-second boot saw 18 signal failures
  and zero launches land in `/api/feed`, not a hang but a queue of scoring
  work arriving faster than `maxConcurrent: 2` can drain. **Session 21**
  built the backpressure mechanism session 20 proposed:
  `src/scoringGate.ts`'s `ScoringGate` caps how many launches can be scoring
  at once (3, shared across both the websocket watcher and the backstop
  poller in `src/server.ts`, since both hit the same scoring endpoint); a
  launch beyond the cap is dropped immediately (logged, not queued) rather
  than piling up. Live-confirmed this bounds the backlog as intended (a 60s
  boot logged 23 clean "too many pending scores" skips instead of an
  ever-growing queue, and 429s/signal-failures dropped from session 20's 18
  in 100s to 17+3 in 60s) — but **did not** get a single launch to land in
  `/api/feed` within that 60s window either. The gate fixes "the backlog
  grows forever and nothing ever surfaces why," not "the official endpoint
  can sustain enough throughput to finish scoring a launch." That remaining
  gap needs the same kind of fix discovery got (session 20): a different
  public endpoint for scoring's token methods, or accepting that free,
  keyless scoring against the official endpoint may not keep up with
  real-time discovery at all right now. **Session 22** parallelized the
  independent RPC calls inside `src/data/bundledBuys.ts` and
  `src/data/deployerHistory.ts` (`Promise.all` instead of sequential
  `for`/`await` loops) on the theory that serialized retry/backoff delays
  were compounding the rate limit. That change is real and harmless (tests
  stay green, call order was never load-bearing), but **sessions 23-25 each
  started a live re-check and lost the result to a session boundary before
  reading it** — this repo's sessions run in a fresh sandbox each time, so a
  backgrounded server process and its log file don't survive past the end of
  the session that started them; scheduling a wakeup to "check back later"
  doesn't work for that case here. **Session 26 ran the check synchronously
  in the foreground instead** (85s live boot, parallelization included) and
  got a conclusive answer: discovery still finds launches fine and the
  scoring gate still caps cleanly, but scoring's `getTransaction`/
  `getTokenLargestAccounts` calls against the official endpoint hit 429 on
  nearly every attempt, and **zero launches landed in `/api/feed`** — the
  same result as session 21, confirming the parallelization did not move the
  needle. The bottleneck was never about call ordering; it's the official
  endpoint's rate-limit ceiling itself. The real fix is still what session
  20 used for discovery: a different public endpoint for scoring's
  `getTokenSupply`/`getTokenLargestAccounts`/`getTransaction` calls (not yet
  found — `solana-rpc.publicnode.com` itself blocks the indexed token
  methods scoring needs without a signup, per session 20).
  **Session 27** live-checked 9 more candidate free public endpoints
  (`rpc.ankr.com/solana`, `endpoints.omniatech.io`, `solana.drpc.org`,
  `solana-mainnet.rpc.extrnode.com`, `api.metaplex.solana.com`,
  `solana-api.projectserum.com`, `free.rpcpool.com`, `solana.public-rpc.com`,
  re-confirmed `solana-rpc.publicnode.com`) for `getTokenSupply` support
  without a key or signup: all either require a key/plan upgrade, explicitly
  block indexed token methods, or don't resolve/respond at all. No free,
  keyless alternative to the official endpoint for these token methods was
  found — this avenue looks exhausted for now, worth re-checking later rather
  than repeating immediately. Instead, found and fixed a smaller, real win
  on the call-count side: pump.fun's bonding curve account already carries
  `token_total_supply` (confirmed against the program's public docs — it's
  copied from the `Global` account at creation and never touched by
  buy/sell), so holder concentration's `getTokenSupply` call was redundant
  whenever liquidity's bonding-curve fetch for the same mint already ran.
  `src/data/bondingCurve.ts` factors that fetch out so `pipeline.ts` can run
  it once and hand the result to both signals, cutting one whole RPC call
  per launch scored. Live-verified with a synchronous 85s boot (same
  foreground pattern as session 26, public mainnet-beta, no keys): **one
  launch landed in `/api/feed`** (score 40: deployer-history, bundled-buys,
  and liquidity all present; holder-concentration still failed on a 429 from
  the remaining `getTokenLargestAccounts` call, which this change doesn't
  touch) — the first time since session 20 that a live-boot check in this
  file recorded a non-zero feed. One fewer call per launch does not fix the
  rate-limit ceiling itself (holder-concentration's other call and
  deployer-history/bundled-buys' own scans still hit 429s in the same run),
  but it is a measurable, verified improvement, not just a theoretical one.
  **Session 28** checked the follow-up question session 27 left open —
  whether `getTokenLargestAccounts` itself (the one remaining indexed call in
  holder concentration) could be dropped the same way, approximated from data
  already fetched elsewhere. Confirmed it cannot, from two angles: (1) the
  bonding curve account (`pumpfun.ts`'s `decodeBondingCurve`) only carries
  aggregate reserve totals and `tokenTotalSupply` — no per-holder breakdown
  at all, so there is nothing in it to rank holders by; (2) the early-buy
  data bundled-buys already gathers is a time-windowed, scan-limited *sample*
  of buyers, not a complete, current holder list — using it as a stand-in
  would silently change what the signal measures (who bought early) rather
  than what it claims to measure (who holds the most right now, net of any
  selling). Also live-checked whether `getProgramAccounts` with a `mint`
  memcmp filter (the classic non-indexed way to enumerate a mint's holders)
  could substitute: `solana-rpc.publicnode.com` returns an explicit
  `"RPC call or parameters have been disabled"` (code 410) for it, and the
  official endpoint didn't respond within 20s (consistent with its existing
  severe throttling, not a new finding). **Conclusion: no free, keyless
  substitute exists for this call** with data checked so far — this specific
  avenue is closed, not just unexplored. The scoring-side rate-limit ceiling
  itself (unchanged since sessions 20/21/26) remains the open item; a real
  fix would need either a paid/less-restricted endpoint or a self-built
  holder index from live buy/sell instruction data (a much bigger change,
  same shape as `deployerIndex.ts` but tracking balances instead of launch
  counts — not attempted, would need its own scoped session).
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
