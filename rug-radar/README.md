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

Session 104 found a third trade variant beyond `buy`/`sell` and
`buy_v2`/`sell_v2`: the IDL's `buy_v3`/`sell_v3`, confirmed live via a real
`BuyV3` instruction CPI'd into the pump.fun program from an aggregator (the
`pumpfun.test.ts` fixture for it is verbatim from that transaction, not a
synthetic one like the others). Account layout is `buy_v2`/`sell_v2`'s shape
minus the now-unused fee/associated-token-program accounts: `mint` is
`base_mint` at index 1, `bonding_curve` at 5, `user` at 8 — a third distinct
layout, not a reuse of `buy`/`sell`'s or `buy_v2`/`sell_v2`'s.
`decodeTradeInstruction` and `wsLogParser.ts`'s `detectTradeInstruction` both
now match all six variants. Nothing downstream needed changes: `discovery.ts`'s
bundled-buy detection and `balanceIndex.ts` already consume
`decodeTradeInstruction`'s collapsed `kind` field generically rather than
switching on variant, so they picked up `buy_v3`/`sell_v3` for free. Noted here
in session 103: the code and tests for this were already complete and
committed, but this README paragraph and the matching `PROGRESS.md` entry
hadn't been written yet — backfilled now rather than left undocumented.

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
one-shot re-score `RESCORE_DELAY_MS` later (60s — session 47 measured this
live: across two 150s windows tracking 62 mints total, only 3 ever saw a
trade at all, with first-trade delays of 15.4s, 16.0s, and 54.4s; the old
20s value would have missed the 54.4s case, 1 of 3 observed rather than a
rare tail, while the ~95% of mints that never trade in-window are
unaffected by the delay's length either way. Session 72 added 8 more live
samples, all 9.9s-35.9s, from an 85-mint/280s window using the same
gate-bypassing probe technique session 35 introduced below — bringing the
total to 11 samples with session 47's 54.4s still the only one past the
old 45s value. Raised to 60s to cover it, since holding the free per-mint
subscription open longer is free for the mints that never trade. Session 73
ran the same probe again (102 mints/280s window) and added 3 more samples
(23.3s, 21.6s, 22.6s), all well under 60s — 14 samples total, 54.4s still
the lone outlier above 45s, 60s unchanged). That re-score calls
`rescoreHolderConcentrationFromIndex`, and if it returns
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
   without an index covering the lost recall). The dev's own bundled buy, if
   any, is passed in from `DiscoveredLaunch.bundledBuy` instead of being
   re-discovered by the scan — see "Score" below (session 55).

   **The bonding curve's own balance was counted as a buyer (fixed session
   103).** `fetchBundledBuysInput`'s `findTokenReceiver` picked whichever
   token account's balance increased in an early transaction and called its
   owner the buyer — but a sell increases the bonding curve's own token
   balance by the same shape as a buy increases a real buyer's, and nothing
   excluded the curve's own address from that check. Confirmed live: running
   the real fetch against a live mainnet bonding curve's actual recent
   signatures (not a recorded fixture) turned up exactly this — several
   "Sell" transactions reported back with the bonding curve's own address as
   the `buyer`, each with a nonsense `fundedBy` (a "funding source" looked up
   for a program-derived address, which doesn't have one) wasting an extra
   `getSignaturesForAddress`/`getTransaction` round trip per occurrence.
   `findTokenReceiver` now takes the bonding curve's address and skips it as
   a possible receiver. New regression test in `bundledBuys.test.ts` (a
   two-token-balance-entry sell fixture — the single-entry shape the
   existing "skips a sell" test used doesn't reproduce this, since nothing
   else's balance moved in that fixture); confirmed it fails pre-fix,
   `git stash` of the one-line fix included.
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

If every signal's fetch fails for a launch (e.g. the scoring RPC
rate-limits every call for it — see "Known limitations" below), `combineSignals`
returns `{ score: 0, signals: [] }`. That's indistinguishable from "verified
low risk" once rendered, so `src/feed.ts`'s `add()` (session 50) drops a
launch with zero signals instead of adding it — a total data-fetch failure
should disappear from the live page, not show up as the lowest, most
reassuring score it can display.

The same "scoring RPC is scarce" concern applies to `src/poller.ts`'s
backstop path specifically (session 51): it runs concurrently with the
websocket watcher, and its `findNewLaunches` cursor is a time watermark, not
a feed check — so without an explicit `feed.has(launch.mint)` skip, any
launch the watcher already scored within the poller's own lookback window
got fully re-scored (all four signals' RPC calls) only to have `feed.add()`
silently drop the resulting duplicate. `pollOnce` now checks `feed.has()`
before even acquiring a `ScoringGate` slot, matching what `server.ts`'s
watcher callback already did.

Session 50's zero-signal drop left one more waste site unfixed (session 52):
`server.ts`'s watcher callback called `scheduleHolderRescore(launch)`
unconditionally after `feed.add(score)`, even when `add()` dropped the
score. 45s later `rescoreHolderConcentrationFromIndex` (see "Live feed"
below) could still spend a real `getAccountInfo` call against the scoring
RPC computing a holder-concentration rescore for a launch that was already
discarded and would never reach the feed — the rescore's own `.then`
callback only discovers this *after* paying for the call, since it checks
`feed.get(launch.mint)` for the update target, not before doing the work.
Fixed by checking `feed.has(launch.mint)` right after `feed.add(score)` and
only calling `scheduleHolderRescore` when the score was actually kept, the
same pattern `pollOnce` already uses before scoring at all.

Session 52's fix only covered the case where the score never made it into
the feed in the first place. One more waste site existed one layer deeper
(session 53): `src/feed.ts`'s `LiveFeed` is bounded (`maxSize`, default 50),
evicting the oldest entry — from both `launches` and the `mints` dedup set —
whenever a new one pushes it past the cap. `scheduleHolderRescore`'s 45s
timer (see "Live feed" below) called `rescoreHolderConcentrationFromIndex`
unconditionally, which spends a real `getAccountInfo` call against the
scoring RPC before its own `.then` callback checks `feed.get(launch.mint)`
for the update target. A launch that aged out of the feed via eviction
during the 45s wait — plausible during a burst of newer launches — paid for
that RPC call for an update nothing would ever show. Fixed by checking
`feed.has(launch.mint)` before calling `rescoreHolderConcentrationFromIndex`,
not just before using its result.

Sessions 51-53 fixed waste sites in the holder-concentration rescore; session
54 found the rescore itself was simply missing for one of the two discovery
paths. `scheduleHolderRescore` was only ever called from `src/wsDiscovery.ts`'s
primary `onLaunch` handler in `src/server.ts` — a launch the backstop poller
discovered (the websocket was down, or this is a reconnect gap) got its
initial score but never the later rescore from `BalanceIndex`, with no
record of this being a deliberate choice. Fixed by giving `pollOnce`
(`src/poller.ts`) an optional `onScored` callback, fired once per launch a
poll cycle actually kept in the feed (mirroring the same `feed.has()` check
session 52 added to the watcher path, so a zero-signal launch the poller
drops doesn't trigger a rescore either); `server.ts` passes
`scheduleHolderRescore` as that callback, the same function the watcher path
already used. Both discovery paths now get holder-concentration rescores on
equal footing.

Session 55 found one more call this process already has the answer to
without a network round-trip: `src/discovery.ts` decodes the dev's bundled
buy (if any) straight out of the create transaction it already fetched
(`DiscoveredLaunch.bundledBuy` — see "Live feed" below for where this is
also used to seed `BalanceIndex`), but `src/pipeline.ts`'s bundled-buys
signal still called `src/data/bundledBuys.ts`'s `fetchBundledBuysInput`
blind to it — which re-discovers the exact same signature via its own
`getSignaturesForAddress(bondingCurveAddress, ...)` scan (the create
transaction also touches the bonding curve account) and pays a second
`getTransaction` call just to re-derive a buyer address already known for
free. Fixed: `fetchBundledBuysInput` takes an optional `knownBundledBuy:
{ buyer, signature }`; when set, that signature is excluded from the scan
and the known buyer is added to the result directly instead of being
re-fetched. `pipeline.ts` passes `launch.bundledBuy`/`launch.signature`
through. Saves one `getTransaction` call — against the endpoint's
specifically most-throttled method (session 44) — per launch that has a
bundled dev buy, which per session 30's own captured fixture is common
real traffic, not a rare case. 3 new tests (2 in `bundledBuys.test.ts`, 1
in `pipeline.test.ts`); verified as real regression tests by reverting the
fix and confirming they fail, same discipline as sessions 50-51.

Session 51's `feed.has()` check (above) only catches a launch the *other*
discovery path has already *finished* scoring — `feed.add()` runs once
scoring completes, so it can't see a launch the other path has already
started scoring and not yet added. In that window both the watcher and the
poller could still run all four signals' RPC calls against the same mint,
same waste `feed.has()` was meant to close, just one step earlier. Session
56 closed that gap with `src/scoringInFlight.ts`'s `ScoringInFlight`: a
set of mints currently being scored, shared between `server.ts`'s watcher
callback and `poller.ts`'s `pollOnce` the same way `ScoringGate` already is.
Either path claims a mint via `tryAcquire(mint)` before its first RPC call
for it and releases it in a `finally` once scoring settles; the other path's
`tryAcquire` returns `false` for a mint already claimed, so it skips
straight past without touching the scoring RPC at all. Checked before
`ScoringGate` (so a dedup skip never costs a gate slot) and after
`feed.has()` (so an already-finished launch still short-circuits on the
cheaper check first). 4 new tests in `scoringInFlight.test.ts` plus 2 in
`poller.test.ts` covering the cross-path skip and release; verified as real
regression tests by reverting the `pollOnce` check and confirming the new
skip test fails, same discipline as sessions 50-51/55.

Session 56's `ScoringInFlight` skip was silent — unlike `ScoringGate`'s
"too many pending scores" line, nothing was logged when it fired, so there
was no way to confirm live whether the cross-path race it closes actually
happens in practice. Session 57 added a `console.error` at both skip sites
(`server.ts`'s watcher callback, `poller.ts`'s `pollOnce`): `"skipping
launch <mint>: already being scored by another discovery path"`. Purely
additive logging, no behavior change, no new tests needed (the skip path
itself is already covered by `scoringInFlight.test.ts`/`poller.test.ts`).

Sessions 57-69 kept this log line's absence from any live check open as
"the cross-path race has never been observed live." Re-reading both call
sites (session 70) closes that: `tryAcquire()` runs synchronously, before
either path's first `await`, in both `handleDiscoveredLaunch`
(`watcherOnLaunch.ts`) and `pollOnce`'s per-launch loop (`poller.ts`).
Node has one JS thread, so whichever path's handler for a given mint
starts running always finishes its claim-or-skip check without the other
interleaving mid-check — the outcome is deterministic by construction, not
a race condition that needs live traffic to confirm. Both possible
orderings are already exercised offline: `poller.test.ts`'s "a launch
already claimed by the watcher's in-flight score is skipped, not
re-scored" and `watcherOnLaunch.test.ts`'s "a mint already claimed by the
poller's in-flight score is skipped, not re-scored" cover watcher-first and
poller-first respectively. A live window where the log line fires would
confirm the two paths happened to overlap on the same mint in practice,
but adds no new evidence about *correctness* beyond what these two tests
already prove. Not something to keep chasing in future live checks.

Until session 58, the websocket watcher's `onLaunch` handler (the dedup/
gate/in-flight/score/rescore wiring above) lived as an inline closure in
`server.ts`, with no offline test of its own — `poller.ts`'s equivalent
logic was already its own function (`pollOnce`) purely so it could be unit
tested, but the watcher side never got the same treatment. Session 58
pulled it out into `src/watcherOnLaunch.ts`'s `handleDiscoveredLaunch`,
taking the same dependencies as `pollOnce` (`feed`, `scoringRpc`,
`deployerIndex`, `scoringGate`, `scoringInFlight`, `onScored`) as an options
object instead of positional args, and wired `server.ts`'s watcher
`onLaunch` to call it. Behavior is unchanged — this is a pure extraction.
7 new tests in `watcherOnLaunch.test.ts` cover the same cases
`poller.test.ts` covers for the poller side (dedup skip, gate-full skip,
in-flight skip, release-after-success, release-after-zero-signal-score,
`onScored` firing only when the launch is actually kept); verified as real
regression tests by temporarily removing the `feed.has()` dedup check and
confirming the matching test fails, same discipline as prior sessions.

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

**The watermark boundary is inclusive, not exclusive (fixed session 80).**
`findNewLaunches` tracks a `sinceBlockTime` watermark (not a feed check —
see above), and `blockTime` only has 1-second resolution: pump.fun's
firehose routinely puts multiple creates in the same wall-clock second. The
boundary check used to be `blockTime <= sinceBlockTime`, which meant any
signature sharing the *exact* second as the current watermark was skipped —
including a signature that was never actually seen before, just because an
earlier signature from that same second had already set the watermark one
poll ago. Reproduced live: poll 1 sees only sigA (second T) and sets the
watermark to T; poll 2 sees a genuinely new sigB also at second T, and the
old `<=` excluded it forever, since the watermark never moves backwards to
give it another chance. Changed to `blockTime < sinceBlockTime` so a
signature exactly at the watermark is scanned again rather than skipped —
safe because `pollOnce` already checks `feed.has(launch.mint)` before
spending any scoring RPC call, so re-resolving an already-seen signature at
the boundary costs at most one redundant `getTransaction` call on the
discovery RPC, not a duplicate score.

**Overlapping polls can't race the watermark (fixed session 81).** `server.ts`
calls `pollOnce` every `POLL_INTERVAL_MS` (15s) via `setInterval`, which fires
on schedule regardless of whether the previous call's `pollOnce` promise has
resolved — and `findNewLaunches`'s own resolve-with-retry loop above can alone
take longer than that for one slow signature, let alone a whole cycle's worth
of sequential per-launch scoring. Confirmed with an offline probe (two
`pollOnce` calls sharing one `PollState`, controlled promise resolution order,
no real timers): the call dispatched *first* can still finish *last*, and
since each call reads `state.sinceBlockTime` before its own `findNewLaunches`
call and writes it after, whichever call's write lands last wins — including
the first call's now-stale, older `newestBlockTime` snapshot, regressing the
watermark backwards until the next poll happens to catch back up. `PollState`
now carries an `inFlight` flag `pollOnce` checks before its first `await` and
clears in a `finally`; an overlapping call just returns immediately instead of
racing. Dropping beats queuing here for the same reason `ScoringGate` drops
rather than queues: this poller is only ever the backstop to the websocket
watcher, so skipping one tick's worth of discovery is safe.

**The HTTP server had no handler for its own `error` event (fixed session
95).** `server.ts` built the `http.Server` and called `server.listen(...)`
with no `server.on("error", ...)`. Node's `net`/`http` layer emits `error`
on the server itself both at startup (e.g. `EADDRINUSE` if the configured
port is already taken) and afterward, during normal operation (e.g.
`EMFILE` if `accept()` fails because the process is out of file
descriptors) — and the default behavior for an `EventEmitter` with no
`error` listener is to throw, which for an unhandled exception at the top
level crashes the whole process. Confirmed live with standalone scripts:
two servers bound to the same port, the second with no `error` listener,
crashed the process with an uncaught `EADDRINUSE` instead of failing
cleanly; emitting `error` directly on an already-listening server crashed
it the same way. Either case would take down the live feed for every
connected holder over one failure, the same shape of bug fixed in
`requestHandler.ts` (session 94) one layer down, just at the socket level
instead of a single request. Fixed by adding `server.on("error", ...)`
that logs instead of throwing, matching the `err instanceof Error ?
err.message : err` convention used everywhere else in this codebase.

**A 429 retry skipped the pacer entirely (fixed session 96).**
`SolanaRpcClient.request()` called `pacer.reserve(method)` once, before the
retry loop, instead of once per attempt. That reservation spaces out the
*first* attempt correctly, but a 429 retry is also a real request hitting
the same rate-limited endpoint — and it fired after only the exponential
backoff delay (`baseDelayMs * 2 ** attempt`, as little as 300ms), ignoring
whatever interval the method's own pacer lane requires (e.g.
`getTransaction`'s 2000ms lane above). Confirmed live with a standalone
script: a lane configured for 2000ms spacing sent its retry only ~317ms
after the first attempt, and a run with two consecutive 429s sent three
real requests 317ms and 601ms apart — both far under the lane's own
measured-safe rate, hammering the endpoint again right when it had just
asked for backoff. Fixed by moving `pacer.reserve(method)` inside the retry
loop so every real request, retries included, waits for the lane's own
spacing; re-running the same repro afterward showed every real request
landing ~2000ms apart as configured. Regression test in `rpc.test.ts`
confirms a retry now takes as long as `minIntervalMs` requires, not just
`baseDelayMs`.

**An invalid `PORT` env var reached `server.listen` uncaught (fixed
session 101).** `loadConfig`'s `PORT` parsing only guarded against
non-numeric input (`Number.isFinite`) — a negative or zero value (e.g.
`PORT=-1`) passed that check and reached `server.listen`, which throws a
synchronous `RangeError` instead of emitting the `error` event the
session 95 handler above catches. Flagged as a theoretical gap in session
95's pass, left unfixed there as operator-typo-only (no live-data path).
Fixed by checking the parsed port is a positive integer in the valid TCP
range (1-65535), falling back to the default (8787) otherwise, same as
the existing non-numeric fallback.

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

- **The scoring-endpoint rate limit (`api.mainnet-beta.solana.com`) is the
  binding constraint on throughput.** Discovery runs against a separate
  endpoint (`solana-rpc.publicnode.com`, see "Live feed" above) that is
  effectively 429-free for its own calls, but scoring's indexed token
  methods (`getTokenSupply`, `getTokenLargestAccounts`) aren't available
  keyless anywhere else found, so scoring stays on the official endpoint.
  An exhaustive search for a free, keyless alternative — other RPC
  providers, non-RPC public APIs, and `getProgramAccounts` as a substitute
  for `getTokenLargestAccounts` — found none; this avenue is closed unless
  TASK.md's "public, keyless only" constraint changes.
- **`getTokenLargestAccounts` (holder concentration's direct call) 429s
  essentially 100% of the time, at every request rate tried**, including
  rates far below what every other method tolerates. It is configured with
  `methodMaxRetries: 1` (`src/rpc.ts`/`src/server.ts`) so a launch fails
  fast on this call instead of burning a full retry budget on a call
  confirmed not to succeed. The working mitigation is `BalanceIndex`
  (`src/balanceIndex.ts`) + a delayed rescore (`src/rescore.ts`,
  `RESCORE_DELAY_MS` in `src/server.ts`, currently 60s based on 14 live
  samples): each tracked mint's own buy/sell trades are observed directly
  from its bonding-curve logs, and holder concentration is recomputed from
  that balance snapshot when the direct RPC call fails. This recovers the
  signal often, but not always — it depends on enough real trading volume
  arriving before the rescore fires.
- **`getTransaction` has its own, much slower pacer lane** (`RequestPacer`
  in `src/rpc.ts`, configured in `src/server.ts` as
  `methodIntervalsMs: { getTransaction: 2000 }`) because it 429s heavily at
  the ~2.5 req/sec rate every other method tolerates. This eliminates
  `getTransaction` 429s but adds per-launch latency, since every
  `getTransaction` call across every signal and every in-flight launch
  shares that one slow lane.
- **`ScoringGate` (`src/scoringGate.ts`) caps concurrent scoring at 3**,
  shared across both discovery paths since they hit the same scoring
  endpoint. A launch beyond the cap is dropped immediately (logged, not
  queued) rather than piling up a backlog that never drains. Net effect,
  confirmed with a live `/api/feed` check: the feed does populate under
  real load, but throughput is low and holder-concentration is frequently
  missing from the direct call (recovered via rescore when it can be).
- **Call volume per launch is bounded but not eliminated.** `deployerHistory`
  and `bundledBuys`' retroactive/window scans (`signatureLimit: 25` and `20`
  respectively, both lowered from higher defaults) are real
  recall-vs-call-volume tradeoffs — `deployerIndex.ts`'s live-built
  `deployer -> prior mints` index covers most of the recall lost by
  deployer-history's lower limit for any deployer seen creating twice in
  this process, but bundled-buys has no equivalent index, and a deployer's
  pre-existing (pre-startup) history is still bounded by the scan limit
  either way.
- **The old signature-polling discovery path (`src/discovery.ts`)
  under-samples on its own** — pump.fun sees roughly 500 tx/sec across all
  instruction types, so `getSignaturesForAddress`'s 1000-signature page
  spans only ~2 seconds. It's kept only as a backstop for a launch created
  during startup or a websocket reconnect gap; the websocket watcher
  (`src/wsDiscovery.ts`) is push-based and doesn't have this problem.
- **`findFundingSource` (`src/data/bundledBuys.ts`) has a small residual
  "unknown" rate (~2%, live-measured)** for early buyers whose funding
  transaction genuinely doesn't appear within `signatureLimit: 50`
  signatures. An earlier, larger miss rate (33%) was a real bug — the
  function checked only the buyer's oldest visible signature instead of
  walking forward to find the actual funding transfer — fixed, with a
  regression test (`bundledBuys.test.ts`) confirming it fails pre-fix and
  passes post-fix.
- **`discovery.ts`'s trade decoding missed virtually every real post-launch
  buy/sell (fixed session 107).** `findTradeInstruction`/`findCreateInstruction`
  only scanned a transaction's top-level instructions for a pump.fun
  `programId`. Confirmed live by sampling real signatures off the pump.fun
  program's own history: 16/16 standalone buy/sell transactions sampled were
  invoked via CPI from an outer router program (Jupiter or similar) — the
  actual pump.fun `Buy`/`Sell` instruction only appears in
  `meta.innerInstructions`, never at the top level. A top-level-only scan
  silently returned `null` for all of them. This fed straight into
  `wsDiscovery.ts`'s per-mint `trackMint`/`onTrade` path (`resolveTradeFromSignature`
  calls the same `findTradeInstruction`): `BalanceIndex`'s rescore mitigation
  for the `getTokenLargestAccounts` 429 (above) was built on `onTrade`, so it
  was receiving close to zero real trade data, not just "not always" recovering
  the signal as previously documented. Bundled dev buys (same transaction as
  the `create`) were still called directly at the top level in every live
  sample checked, so that path wasn't affected — but the fix (both functions
  now scan top-level and inner instructions together, via a shared
  `allInstructions` helper) is symmetric rather than special-casing trades, in
  case that stops holding for creates too. `ParsedTransactionMeta`
  (`src/rpc.ts`) now exposes `innerInstructions` (same shape as the RPC
  response, just not previously typed). Regression test in
  `discovery.test.ts` reproduces the CPI shape with an unrelated top-level
  program and a pump.fun trade only in `innerInstructions`; confirmed it
  fails pre-fix, passes post-fix.

See `PROGRESS.md` for the session-by-session history behind these
findings (live measurements, rejected alternatives, and fixes).

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
