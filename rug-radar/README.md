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

Session 34 made the design call left open above and wired it in:
`src/rescore.ts`'s `rescoreHolderConcentrationFromIndex(rpc, launch,
balanceIndex)` re-scores *only* the holder-concentration signal from
`BalanceIndex.getHolders()` plus the bonding curve's `tokenTotalSupply` (a
plain `getAccountInfo` call, not the rate-limited indexed methods) —
deliberately not the whole launch, since re-running the other three signals
would add calls against the same rate-limited scoring RPC this exists to
avoid, for signals the balance index has no data for anyway. Returns `null`
(caller leaves the existing signal alone) when no trades have been observed
for the mint yet, or the bonding curve account can't be read.

`src/server.ts` wires the *when*: on a successful initial score, it calls
`watcher.trackMint(launch.mint, launch.bondingCurve)` and schedules a
one-shot re-score `RESCORE_DELAY_MS` (20s, an untuned starting point) later.
That re-score calls `rescoreHolderConcentrationFromIndex`, and if it returns
a signal, replaces the `holder-concentration` entry in the launch's signals
and recombines the score via `src/feed.ts`'s new `update()` (replaces an
entry in place by mint; `get()` added alongside it for the lookup). Either
way, `watcher.untrackMint()` always runs afterward so a long-running process
doesn't leak subscriptions for launches it's done watching. `onTrade` is
wired to `balanceIndex.recordTrade()`. Note `LaunchWatcher`'s per-mint trade
subscriptions resolve over the *discovery* RPC client (the same one passed
into `LaunchWatcher`'s constructor for create resolution), not the
rate-limited scoring one — so trade resolution for the index inherits
whichever endpoint discovery is currently using, independent of the scoring
bottleneck below.

Offline-tested (`src/rescore.test.ts`, `src/feed.test.ts`'s new `get`/
`update` cases) but **not live-confirmed end-to-end**: a synchronous live
boot (public mainnet-beta, no keys, ~90s) only landed one launch in
`/api/feed` during the window (same scoring-gate-capped ceiling as every
session since 20 — most discovered launches get dropped at "too many
pending scores" before `scoreLaunch` ever runs, so `trackMint` is only
called for the rare one that gets through), and that one mint's bonding
curve showed thin liquidity (0.16 SOL) — consistent with too little trading
activity to populate `BalanceIndex` in the 20s window, though a now-also-
elevated 429 rate on the discovery endpoint during that same run (see "Known
limitations") means "no trades observed" and "trade resolution also
throttled" can't be told apart from this one sample. Worth an isolated check
(watch `trackMint`/`onTrade` directly against a busier mint, same approach
session 19 used to isolate `LaunchWatcher`) rather than guessing further from
one data point.

**Session 35 ran that isolated check and found a real bug, not just a
sample-size problem.** A scratch probe tracked every launch `LaunchWatcher`
found directly (bypassing `ScoringGate`, so the sample wasn't capped at ~1)
— 17 launches tracked over 75s, **zero** trades resolved. Root cause: a
buy/sell transaction mentions *both* the pump.fun program and the mint's own
bonding curve, so the public RPC pushes a `logsNotification` for it on
*both* the program-wide subscription and the mint-specific one.
`handleMessage`'s signature dedup set (`seen`/`seenOrder` in
`wsDiscovery.ts`, meant to drop a notification redelivered after a
resubscribe) was keyed on the raw signature only, shared across both
subscription types — so whichever copy arrived first (almost always the
program-wide one, checked for a create and discarded) marked the signature
seen and silently dropped the other copy, the one that actually mattered for
`onTrade`. Fixed by keying the dedup set on `(purpose, signature)` —
`` `create:${signature}` `` vs `` `trade:${signature}` `` — so the two
subscription types no longer collide; redelivery-after-resubscribe within
one type is still deduped as before. Added a regression test ("a trade is
still resolved when the program-wide subscription sees the same signature
first") that fails on the old code and passes on the fix (verified both
ways). Re-ran the same isolated probe after the fix: 23 launches tracked
over 75s, **5 trades resolved** (all sells, logged with wallet/amount) — the
mechanism fires for the first time on record. `BalanceIndex.getHolders()`
still showed 0 holders for every tracked mint in that run, but that's the
documented clamp-to-zero behavior for a sell with no observed prior buy
(the wallets sold tokens they'd bought before this process started
watching), not a new bug — would need a mint with an observed *buy* in the
window to see a positive balance.

**Session 36 got that confirmation — the end-to-end mechanism works.**
Re-ran the same isolated probe (90s per-mint tracking window, 150s total,
bypassing `ScoringGate`) and one mint
(`Bc4XQikcRmkoFQnb1eCqJkxfM2dhziAncifQEuHNc6zE`) saw 3 buys and 10 sells in
its window, producing 2 positive-balance holders in `BalanceIndex`, and
`rescoreHolderConcentrationFromIndex` returned a real signal: `{"name":
"holder-concentration","score":2,"reasons":["top 2 non-program holders hold
1.7% of supply"]}`. Every other tracked mint in the same run still showed 0
trades or sell-only activity, consistent with low per-mint trade volume
being the norm rather than this one mint being special — the mechanism
works when a mint gets enough early activity, it just needs that activity
to exist. This closes the "does it fire and produce a correct result"
question open since session 34.

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
   The scan's signature-limit default is 25, not 100 (lowered session 40,
   see "Known limitations" for the measured RPC-call cost that drove this).
   See "Known limitations" below for why the retroactive scan alone wasn't
   enough, and what this does and doesn't fix.
2. **Bundled buys** — wallets funded from one source that bought in the first
   minutes. **Built:** `src/signals/bundledBuys.ts` (pure scoring function) +
   `src/data/bundledBuys.ts` (finds early buyers of the mint from the bonding
   curve's transaction history, then walks each buyer's known transaction
   history oldest-to-newest to find the first one that actually funded them
   with SOL — see "Known limitations" (session 39) for why it scans more than
   just the single oldest signature). The signature-limit default is 20, not
   50 (lowered session 41, see "Known limitations" for the measured RPC-call
   cost that drove this — same shape as deployer-history's session 40 cut,
   without an index covering the lost recall).
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

**The dev's bundled buy (session 36).** `resolveLaunchFromSignature` also
decodes a `buy`/`buy_v2` instruction bundled into the *same* transaction as
the create itself (pump.fun's "dev buy" — common, not an edge case) into
`DiscoveredLaunch.bundledBuy`, at no extra RPC cost since the transaction is
already fetched to find the create. This matters because it's otherwise
unobservable: `wsDiscovery.ts`'s `trackMint` subscription (see "Known
limitations" below) can only exist once a mint is known, i.e. strictly after
this transaction, so without decoding it here the mint's actual first holder
would never reach `BalanceIndex`. `server.ts`'s `scheduleHolderRescore` seeds
`balanceIndex.recordTrade(launch.bundledBuy)` before calling `trackMint`, so
the dev's own buy counts alongside whatever trades arrive afterward. Confirmed
live this was a real gap, not a theoretical one: every trade `BalanceIndex`
had observed before this fix was a sell (see "Known limitations"'s session
34/35 entries) — sellers of a balance the index never saw bought.

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
  **Sessions 29-33** built that self-built holder index in pieces
  (`decodeTradeInstruction`, `detectTradeInstruction`, `BalanceIndex`,
  `LaunchWatcher.trackMint`/`untrackMint`) without wiring it in — see
  "Live feed" above. **Session 34** wired it in (`src/rescore.ts`,
  `src/server.ts`'s delayed re-score) and live-booted again (90s,
  foreground, same pattern as sessions 26/27): still only **one** launch
  landed in `/api/feed` in the window — the scoring-gate ceiling above is
  unchanged by this session — and a new wrinkle showed up in that same run:
  a visible rate of `getTransaction` 429s against the *discovery* endpoint
  (`solana-rpc.publicnode.com`), which session 20 had found to be 429-free.
  Only one launch ever reached the point where `trackMint` could run (the
  scoring gate drops everything else before `scoreLaunch` is even called),
  and that mint had very thin liquidity (0.16 SOL) — not enough of a sample
  to tell whether the balance index got no trades because there weren't any,
  or because trade resolution hit the same new 429s. If the discovery
  endpoint's throttling has genuinely tightened since session 20 (rather
  than being this run's point-in-time load, the same caveat raised about the
  scoring endpoint in session 19), that would narrow the two endpoints' gap
  and is worth checking on its own before trusting either endpoint's
  behavior as fixed.
  **Session 35** ran the isolated `trackMint`/`onTrade` check session 34 left
  open and found the real reason the balance index had never observed a
  trade: a dedup bug in `wsDiscovery.ts` (see "Live feed" above for the full
  root cause and fix — a cross-subscription dedup collision, not a sample-
  size problem) was silently dropping almost every trade notification before
  it reached `onTrade`. Fixed and live-confirmed (5 trades resolved in a
  75s isolated check, versus 0 before the fix in the same kind of check).
  This does not touch the scoring-endpoint rate-limit ceiling itself — that
  remains unchanged — but it does mean `BalanceIndex`/`rescore.ts`'s
  mechanism, wired in session 34, can now actually receive data once a
  mint is tracked for long enough to see real trading activity, which it
  could not reliably do before this fix regardless of the scoring gate's
  throughput.
  **Session 36** closed the remaining open question (whether the mechanism
  produces a *correct positive-balance* result, not just that trades reach
  `BalanceIndex` at all). While investigating with an isolated probe, it
  found the *real* reason every trade observed so far had been a sell, never
  a buy (noted as an open mystery in the session 35 entry above): the dev's
  own bundled buy, in the same transaction as the create, happens before
  `trackMint` can possibly subscribe — so it was invisible to `BalanceIndex`
  by construction, not by bad luck. Fixed in `src/discovery.ts`/`src/server.ts`
  — see "Live feed" above for the mechanism — with 2 new offline tests in
  `discovery.test.ts`. Re-ran the isolated probe after the fix and got a mint
  with both buys and sells in its window, 2 positive-balance holders, and a
  real `rescoreHolderConcentrationFromIndex` result — see "Live feed" above
  for the numbers. The balance-index feature is now live-confirmed
  end-to-end. **Correction:** the session that ran this live check (logged as
  session-0037, written up above and in PROGRESS.md as part of "Session 36")
  hit its step limit immediately after the fix and never documented it here
  or in PROGRESS.md; the next session inherited the already-fixed code
  without noticing the diff, and wrote up the live numbers as confirming the
  *pre-existing* mechanism rather than this fix. Backfilled now — same
  "step-limit interrupts documentation" pattern as sessions 6-9/17/20/22-25.
  The scoring-endpoint rate-limit ceiling itself (the headline open item
  below) is unchanged by this — the balance index is a workaround for one
  signal's indexed RPC call, not a fix for the ceiling overall.
  **Session 40** measured something none of sessions 20-39's endpoint
  searches had directly checked: how many RPC calls one signal issues per
  launch, not just whether the endpoint rate-limits them. Instrumented the
  real (unmocked) `fetchDeployerHistoryInput`/`fetchBundledBuysInput`/
  `fetchHolderConcentrationInput` against one real launch from a known
  prolific deployer and counted calls directly. Result: deployer-history's
  retroactive scan alone issued **54 `getTransaction` calls, 44 of them
  429s, taking 113 seconds** for that one launch — by far the largest
  contributor measured (bundled-buys: 28 calls/25 429s/88s; holder-
  concentration: 1 call, failed immediately). The scoring gate (session 21)
  bounds how many launches can score *concurrently*, but says nothing about
  how many calls *one* launch's scoring costs — a single deployer-history
  scan alone can cost more calls than the gate's entire concurrency budget,
  which explains why even one launch getting through the gate so often
  still failed to finish. Fixed by lowering `fetchDeployerHistoryInput`'s
  default `signatureLimit` from 100 to 25 (`src/data/deployerHistory.ts`):
  `DeployerIndex` (session 13) already covers the recall this scan would
  otherwise lose for a deployer this process has seen create twice, so the
  retroactive scan's main remaining job is a deployer's pre-existing
  history, not the common repeat-offender case — trading some of that depth
  for a ~4x cut in worst-case calls was the right side of the tradeoff.
  Live-reverified with the same instrumented measurement against a fresh
  launch after the fix: deployer-history dropped to **4 calls, 0 errors,
  297ms**; bundled-buys to **2 calls, 0 errors, 2.5s** (same real deployer,
  different mint, so not an apples-to-apples pair, but the call-count drop
  is a direct, reproducible consequence of scanning fewer signatures, not
  noise). Then live-booted the real server end-to-end (85s, foreground,
  same pattern as sessions 26/27/34): **2 launches landed in `/api/feed`**
  in the window, plus one successful holder-concentration rescore from
  `BalanceIndex` logged — more launches landing in one run than any prior
  session's live check on record (sessions 21/26 got zero; session 27 got
  one). `getTokenLargestAccounts` (holder-concentration's remaining indexed
  call, confirmed un-droppable in session 28) and bundled-buys' own window
  scan still hit 429s in the same run, so the ceiling itself is not gone —
  this is a measured reduction in how hard scoring pushes against it, not a
  fix for the endpoint's own throughput.
  **Session 41** applied the same instrumented-call-count measurement to
  bundled-buys specifically, the item session 40 left open (its window-scan
  `signatureLimit`, default 50, bounded by real early-buy activity rather
  than the limit itself — not touched in session 40). Watched the real
  websocket feed for 90s, then ran the real, unmodified
  `fetchBundledBuysInput` against each discovered launch in turn (12
  processed) with an instrumented scoring RPC counting calls per method.
  Result: the outer bonding-curve scan reached **20, 25, and a full 50/50
  signatures** across different launches in the same run (not bounded by low
  activity the way session 40 speculated — a mint scored even ~90s after
  discovery can already have accumulated enough bonding-curve traffic to hit
  the cap), and the resulting concurrent `getTransaction` resolves against
  the official scoring endpoint hit HTTP 429 on **648 of 658 calls (98.5%)**
  across the 12 launches — worse than session 40's single-launch measurement
  for this same signal (25/28, 89%). Fixed: lowered
  `fetchBundledBuysInput`'s default `signatureLimit` from 50 to 20
  (`src/data/bundledBuys.ts`) — the same tradeoff shape as session 40's
  deployer-history cut, but **without** an equivalent index covering the
  lost recall (there is no `BalanceIndex`-for-early-buyers), so this is a
  real recall-vs-call-volume tradeoff, not a free win. Live-reverified with
  the same instrumented probe after the fix (90s window, 21 launches
  discovered, 12 processed): outer scans now cap at 20 as intended (several
  launches showed exactly `20/20` instead of reaching 50), but the overall
  429 rate was effectively unchanged (**741 of 751 calls, 98.7%**) — at this
  level of endpoint saturation, nearly everything fails regardless of how
  many signatures are requested, so the fix bounds worst-case request volume
  per launch without measurably improving (or, within this sample,
  measurably hurting) how much actually gets through. Honest conclusion:
  this is the same class of fix as session 40 (reduce how hard one signal
  pushes on an already-overwhelmed endpoint), but at this saturation level
  the scoring endpoint's throughput — not any one signal's call count — is
  now clearly the dominant constraint, more so than session 40's one-launch
  sample suggested.
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
- **`findFundingSource`'s lookback-limit — live-checked (session 37), real
  bug root-caused and fixed (session 39).** Open since session 4, repeatedly
  blocked (sessions 16/19/20/21) because discovery either couldn't resolve a
  live launch at all, or the scoring endpoint's backlog never let one finish
  scoring with early-buy data available. Session 37 unblocked the live check
  by running `fetchBundledBuysInput` directly against
  `solana-rpc.publicnode.com` (the discovery endpoint) instead of waiting on
  the scoring endpoint, and measured **4 of 12 distinct early buyers (33%)
  resolved to `fundedBy: null` ("unknown")** across 4 real mints — but didn't
  dig into why.
  Session 39 dug in with an instrumented probe that classified each miss, and
  found it was overwhelmingly **one root cause, not signature-limit
  exhaustion**: `findFundingSource` only ever checked the buyer's single
  *oldest* visible signature for a SOL balance increase. Across a live sample
  (24 mints, dozens of buyers), nearly every miss was a case where that oldest
  transaction wasn't a funding transfer at all (some other, unrelated
  activity, e.g. a failed tx) while a real funding transfer sat a few
  signatures later, still well within `signatureLimit: 50` — the function
  just never looked at it. Zero misses were attributable to the wallet
  genuinely having no funding transaction within the limit.
  Fixed in `src/data/bundledBuys.ts`: `findFundingSource` now walks every
  signature within the limit oldest-to-newest and returns the first one that
  actually shows a SOL balance increase for the buyer, instead of assuming
  the single oldest signature is the funding transaction. Stops at the first
  match, so the common case (a freshly-created wallet funded then immediately
  used) still costs one extra `getTransaction` call; only a wallet with no
  funding transaction anywhere in the window pays the full `signatureLimit`
  cost, same worst case the old code already risked elsewhere. Regression
  test added (confirmed it fails on the pre-fix code, passes on the fix).
  **Live-reverified with the real, fixed `fetchBundledBuysInput`** over a
  180s window (24 mints, public mainnet-beta, no keys): unknown rate dropped
  from session 37's 33% to **2% (5 of 217 buyers)** — the remaining handful
  are genuine "no funding transaction within `signatureLimit: 50`" cases, the
  kind of miss this lookback limit was always expected to have.
  **Session 42** tried a different angle on the scoring-endpoint ceiling
  (sessions 20-41, above) than any prior session: proactive client-side
  pacing instead of only reactive retry-after-429. Measured the official
  endpoint's sustained safe rate directly with a throwaway paced probe
  (`getSlot`, a non-indexed method, so the measurement isn't skewed by the
  indexed-method throttling sessions 20/28 found separately): a steady
  ~2.5 req/sec (400ms between request starts) ran 40s with zero 429s, while
  5 req/sec degraded to ~27% 429 over a sustained 15s window and 7+ req/sec
  was worse — the ceiling is a sustained average rate, not just burst size,
  so spacing requests out should help where retry-after-the-fact alone
  hadn't. Implemented `minIntervalMs` in `src/rpc.ts`: a chained pacer that
  reserves each request's start time at least `minIntervalMs` after the
  previous one, queued in call order so concurrent callers space out instead
  of racing (disabled by default — `0` — so every existing caller/test is
  unaffected; opt-in only). 2 new tests in `rpc.test.ts` (real-timer-based,
  not the fake-clock pattern used elsewhere, after a fake-clock version hit a
  microtask-ordering flake unrelated to the spacing guarantee itself — see
  the test file's comment). Wired into `src/server.ts`'s two scoring clients
  (`watcherScoringRpc`, `pollScoringRpc`) at `minIntervalMs: 400` each (not
  800, after a first live check — see below). Live-checked twice, foreground,
  same pattern as sessions 26/27/34/40/41: at 800ms the single
  `getTransaction`-heavy deployer-history scan, paced one request at a time,
  took long enough that an 85s window still logged zero new launches
  landing; dropping to 400ms (matching the measured single-stream safe rate
  directly, since each scoring client paces independently rather than
  sharing one combined budget) and re-checking over 110s got **1 launch
  landing in `/api/feed`**, plus a measurable drop in holder-concentration's
  429 count (2 vs 3 in a comparable unpaced run). Honest read: this is a
  small, verified improvement in the same direction as sessions 40-41
  (reduce pressure on an overwhelmed endpoint), not a fix for the ceiling —
  one launch in 110s is still far below real-time discovery's rate, and the
  two scoring clients pace independently of each other, so their *combined*
  request rate against the one shared endpoint is still roughly double the
  single-stream-safe rate this session measured. A shared, cross-client
  pacer (one `minIntervalMs` budget split across
  `watcherScoringRpc`/`pollScoringRpc` rather than 400ms each) is the
  logical next step and wasn't attempted this session.
  **Session 43** closed that gap: extracted `RequestPacer` out of
  `SolanaRpcClient` in `src/rpc.ts` (same reserve-a-slot chaining logic, now
  a standalone class) so one instance can be shared between multiple
  clients instead of each client pacing independently.
  `watcherScoringRpc`/`pollScoringRpc` in `src/server.ts` now share one
  `RequestPacer(400)` (via the new `pacer` option, which takes priority over
  `minIntervalMs`) instead of each getting its own `minIntervalMs: 400` —
  whichever one calls next waits for the shared slot, so the combined rate
  against the one endpoint they both hit is held to the measured-safe
  ~2.5 req/sec regardless of which client is busier. 1 new test in
  `rpc.test.ts` (two clients sharing one pacer, asserted via combined
  elapsed time the same way the original `minIntervalMs` test asserts a
  single client's spacing). Live-checked (110s, foreground, same pattern as
  prior sessions): **1 launch landed in `/api/feed`** — not more than
  session 42's independently-paced check, so this is a correctness fix for
  the double-rate gap rather than a throughput win on its own. A new,
  more specific finding from this run: of 39 total 429s logged, 37 were on
  `getTransaction` specifically and only 2 on `getTokenLargestAccounts` —
  since session 42's rate measurement used `getSlot` (a cheap, non-indexed
  method) to find the ~2.5 req/sec ceiling, it's possible the endpoint
  throttles expensive calls like `getTransaction` more strictly than cheap
  ones at the same request rate, which a flat combined-RPS pacer across all
  methods wouldn't capture. Not confirmed with a dedicated measurement this
  session — worth a `getTransaction`-specific paced probe before tuning
  `minIntervalMs` further.

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
