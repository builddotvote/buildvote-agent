# Progress

## Session 1 — 2026-09-29

### Done
- Scaffolded `/rug-radar` as a Node 20 + TypeScript project (step 1 of TASK.md).
- `package.json` with scripts: `dev`, `start`, `build`, `test`, `typecheck`.
  Dev deps only: `typescript`, `tsx`, `@types/node`.
- `tsconfig.json` (strict, ES2022, NodeNext modules).
- `src/config.ts` loads `SOLANA_RPC_URL` and `PORT` from env with a public
  default RPC (`https://api.mainnet-beta.solana.com`), no keys anywhere.
- `src/config.test.ts` — offline unit test for config defaults/overrides.
- `src/types.ts` — shared `TokenLaunch` / `SignalResult` / `LaunchScore` types
  used by upcoming signal modules and the scorer.
- `src/server.ts` — minimal HTTP server serving `public/index.html` and a
  stub `GET /api/feed` returning `{ launches: [] }`.
- `public/index.html` — placeholder live feed page.
- `.env.example` — documents `SOLANA_RPC_URL` and `PORT`, no real values.
- `rug-radar/README.md` — install/run/test instructions and the signal plan.
- Added `dist/` to the root `.gitignore` (build output, not committed).

### Works
- `npm install`, `npm test` (2/2 passing, offline), `npm run typecheck`,
  `npm run build` all succeed in `/rug-radar`.
- `npm run dev` / `npm start` boot an HTTP server; manually verified
  `GET /` returns the HTML page and `GET /api/feed` returns `{"launches":[]}`.

### Next
- Step 2: build the data layer against the public Solana RPC (subscribe to
  new pump.fun mint/launch events, read account data) — URL from env only,
  no keys in code.
- Step 3: implement the four signals in `src/signals/`, each with its own
  module and offline tests using recorded sample data (no live calls in
  tests):
  1. Deployer history
  2. Bundled buys
  3. Holder concentration
  4. Liquidity and migration status
- Step 4: combine signals into a single score with reasons shown next to it.
- Step 5: wire the live feed page to the real data/score pipeline (currently
  a static stub).

## Session 2 — 2026-09-29

### Done
- Ran `npm install` in `/rug-radar` (node_modules wasn't present; needed for
  typecheck/test to run at all).
- Step 2: `src/rpc.ts` — thin client for the public Solana JSON-RPC API
  (`getTokenSupply`, `getTokenLargestAccounts`, `getAccountInfo`,
  `getSignaturesForAddress`, `getTransaction`). Takes the RPC URL from env
  via existing `config.ts`, no keys. `src/rpc.test.ts` mocks `fetch` with
  fixtures shaped like real RPC responses (10 tests: happy paths, null
  account, RPC-level error → `RpcError`, HTTP-level error).
- `src/knownAccounts.ts` — well-known, stable Solana program addresses
  (system/token/token-2022/associated-token programs) that signals should
  treat as non-holders. `src/knownAccounts.test.ts` sanity-checks the list.
- Step 3 (signal 3, Holder concentration), split into pure logic vs. data
  fetch so scoring is testable with zero network mocking:
  - `src/signals/holderConcentration.ts` — `scoreHolderConcentration()`:
    excludes given addresses (bonding curve + known program accounts),
    ranks the rest, sums the top 10, scores by share of total supply
    (>=50% → 90, 30-50% → 55, else a proportional score), reasons list the
    %. `src/signals/holderConcentration.test.ts` — 5 offline tests.
  - `src/data/holderConcentration.ts` — `fetchHolderConcentrationInput()`
    combines `getTokenSupply` + `getTokenLargestAccounts` into the signal's
    input. `src/data/holderConcentration.test.ts` — 1 test with a fake RPC
    object (no `fetch` mocking needed since it depends on `rpc.ts`'s typed
    interface, not the HTTP layer).
- Updated `rug-radar/README.md` to describe the data layer and the built
  signal; noted the other three signals as planned.

### Works
- `npm install`, `npm run typecheck`, `npm run build` all clean in
  `/rug-radar`.
- `npm test`: 18/18 passing, all offline (mocked `fetch` or fake RPC
  objects, no live network calls).

### Next
- Signal 1, Deployer history: needs the pump.fun program ID and how to spot
  a "token create" instruction + its outcome (migrated to Raydium /
  abandoned / still on the curve). Should confirm the exact program ID and
  instruction layout (e.g. via a web search for pump.fun's public program
  docs) before writing decoding logic, rather than guessing byte offsets.
- Signal 2, Bundled buys: build on `rpc.ts`'s `getSignaturesForAddress` +
  `getTransaction` (already implemented and tested) to find early buyers
  funded from a common source wallet.
- Signal 4, Liquidity and migration status: also needs pump.fun-specific
  knowledge (bonding curve reserves, migration completion flag) — same
  research step as signal 1 first.
- Step 4: a combiner that takes `SignalResult[]` → `LaunchScore` (weighted
  average or max-of-risk with reasons flattened) — can be built once at
  least 2 signals exist; holder-concentration alone isn't enough to be
  useful.
- Step 5: wire `GET /api/feed` (currently a stub in `src/server.ts`) to a
  real pipeline once signals + combiner exist.

## Session 3 — 2026-09-30

### Done
- Researched pump.fun on-chain layout (needed before signals 1 and 4 could
  be built): program ID `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P`, the
  bonding curve PDA (seeds `["bonding-curve", mint]`), its Anchor account
  layout (8-byte discriminator, five little-endian u64 reserve fields, a
  `complete` bool, then the `creator` pubkey), and how migration works
  (permissionless `migrate` instruction, graduates to PumpSwap since March
  2025, previously Raydium). Source: the project's own public docs repo
  (`pump-fun/pump-public-docs`), linked from `rug-radar/README.md`.
- Fixed a pre-existing bug in `src/knownAccounts.ts`: `systemProgram` had 9
  extra `"1"` characters (41 chars instead of the correct 32-char address
  `11111111111111111111111111111111`). Confirmed the correct value against
  Solana Explorer and added a codec test that pins it (see below) so it
  can't silently regress. Holder-concentration exclusion lists using this
  constant were slightly wrong before; low real-world impact since the
  system program rarely appears as a token holder, but worth fixing since
  other signals may reuse this list.
- `src/base58.ts` — small dependency-free base58 (Bitcoin alphabet) codec
  (`base58Encode`/`base58Decode`), needed to turn the raw pubkey bytes in
  account data back into addresses. `src/base58.test.ts` — 3 tests: the
  all-zero-bytes vector against the (now-fixed) system program address,
  round-trips of 4 known real addresses, and rejection of invalid
  characters.
- `src/pumpfun.ts` — pump.fun program ID constant + `decodeBondingCurve()`,
  a pure offline decoder for the bonding curve account's raw base64 data
  (reserves, `complete` flag, `creator` address). `src/pumpfun.test.ts` — 3
  tests using hand-built fixture buffers (still-bonding, completed/migrated,
  and too-short data), no network involved.
- Step 3 (signal 4, Liquidity and migration status), same pure-logic /
  data-fetch split as signal 3:
  - `src/signals/liquidity.ts` — `scoreLiquidity()`: score 10 if the curve
    is complete (migrated to an AMM); otherwise scores by real SOL reserves
    still backing the curve (<=5 SOL → 80 "thin", <=15 SOL → 45
    "moderate", else 20 "deep, approaching graduation").
    `src/signals/liquidity.test.ts` — 5 offline tests incl. a boundary case.
  - `src/data/liquidity.ts` — `fetchLiquidityInput()` calls
    `rpc.getAccountInfo()` on the bonding curve address and decodes it via
    `pumpfun.ts`. `src/data/liquidity.test.ts` — 2 tests with a fake RPC
    object (found + not-found cases).
- Updated `rug-radar/README.md`: documents `base58.ts`, `pumpfun.ts`, and
  the now-built liquidity signal; notes the bonding curve address comes
  from the mint's "create" transaction rather than being PDA-derived here
  (no `@solana/web3.js` dependency added — PDA derivation needs ed25519
  curve-membership checks that aren't worth a new dependency yet).

### Works
- `npm run typecheck` and `npm run build` are clean in `/rug-radar`.
- `npm test`: 31/31 passing, all offline (mocked `fetch`, fake RPC objects,
  or hand-built fixture buffers — no live network calls anywhere in tests).

### Next
- Signal 1, Deployer history: now unblocked by this session's research.
  Plan: given a deployer wallet address, use `getSignaturesForAddress` +
  `getTransaction` (already in `rpc.ts`) to find past pump.fun `create`
  instructions from that wallet, collect the mints created, then check each
  mint's bonding curve (`decodeBondingCurve`, already built) for
  `complete`/still-active as a rough "how did it end" signal. Note: the
  `create` instruction's exact account order isn't nailed down yet from the
  docs read so far — confirm it (e.g. via a real transaction on a block
  explorer) before decoding instruction data, same caution as this
  session's account-layout work.
- Signal 2, Bundled buys: build on `getSignaturesForAddress` +
  `getTransaction` to find early buyers funded from a common source wallet
  — no new research needed, can start directly.
- Step 4: the combiner (`SignalResult[]` → `LaunchScore`) — now unblocked,
  two signals exist (holder-concentration, liquidity). Could be built next
  session even before signals 1/2 land, then extended as they arrive.
- Step 5: wire `GET /api/feed` to a real pipeline — still blocked on having
  a way to discover *new* launches (a "create" instruction watcher/poller),
  which hasn't been built yet and doesn't depend on which signals exist.

## Session 4 — 2026-09-30

### Done
- Ran `npm install` in `/rug-radar` (node_modules isn't persisted between
  sessions; needed before tests/typecheck could run).
- Step 4, the combiner: `src/scorer.ts` — `combineSignals(mint, signals)` →
  `LaunchScore`. Weighted average of each signal's 0-100 score (liquidity and
  holder-concentration weighted 2x as the most direct rug-pull indicators;
  unlisted/future signal names default to weight 1 so the combiner doesn't
  need touching every time a new signal lands), reasons passed through
  untouched per signal. `src/scorer.test.ts` — 5 offline tests.
- Signal 2, Bundled buys — pure scoring logic:
  `src/signals/bundledBuys.ts` — `scoreBundledBuys()`: takes early buys
  (buyer, funding-source wallet or null, seconds after launch), filters to
  a time window (default 5 min), groups by funding source, scores by what
  share of early buyers share one funding wallet (>=50% → 90, 30-50% → 55,
  else proportional; <2 buyers from one source isn't a "bundle").
  `src/signals/bundledBuys.test.ts` — 7 offline tests.
- Signal 2 — data fetch: before writing `src/data/bundledBuys.ts`, confirmed
  via the public Solana RPC docs (web search) that `getTransaction` with
  `encoding: jsonParsed` returns `transaction.message.accountKeys` as
  `{pubkey, signer, writable, source?}[]` (same order as `preBalances`/
  `postBalances`) — this was previously typed as `unknown` in `rpc.ts`
  since nothing needed it yet. Extended `ParsedTransaction` in `src/rpc.ts`
  with this shape (new `ParsedAccountKey` type) rather than guessing it.
  `src/data/bundledBuys.ts` — `fetchBundledBuysInput()`: pulls the bonding
  curve's recent signatures, keeps ones inside the early window, finds the
  buyer from each transaction's token-balance increase for the mint, then
  for each distinct buyer walks back to their earliest known transaction
  (within a signature-count limit) and reads which other account's SOL
  balance dropped the most — a heuristic "who funded this wallet" proxy,
  documented as such since a wallet's true first-ever tx could be older
  than the scanned window. Caches the funding lookup per buyer address so
  a wallet appearing in multiple early buys isn't re-fetched.
  `src/data/bundledBuys.test.ts` — 5 tests with fake RPC objects (no fetch
  mocking, matching the pattern in the other `data/*.test.ts` files).
- Updated `rug-radar/README.md`: documents the scorer and the now-built
  bundled-buys signal (both logic and data-fetch sides), notes the
  remaining "planned" status of deployer history.

### Works
- `npm run typecheck` and `npm run build` are clean in `/rug-radar`.
- `npm test`: 48/48 passing, all offline (mocked `fetch`, fake RPC objects,
  or hand-built fixture buffers — no live network calls anywhere in tests).
- Three of four signals now built (holder-concentration, liquidity,
  bundled-buys) plus the combiner; only deployer-history and the live feed
  wiring remain from the original TASK.md plan.

### Next
- Signal 1, Deployer history: still the one open signal. Needs the
  pump.fun "create" instruction's account order confirmed against a real
  transaction (e.g. via a block explorer) before decoding — same
  "confirm before decoding" caution used for bundled buys' `accountKeys`
  shape this session. Plan unchanged from session 3: given a deployer
  wallet, use `getSignaturesForAddress` + `getTransaction` (already in
  `rpc.ts`) to find past `create` instructions from that wallet, collect
  the mints, then check each mint's bonding curve (`decodeBondingCurve`,
  already built) for complete/still-active as a rough "how did it end"
  read.
- Bundled buys' funding-source heuristic (`findFundingSource` in
  `src/data/bundledBuys.ts`) only looks back `signatureLimit` (default 50)
  transactions per buyer wallet — fine for freshly-created buyer wallets
  (the common bundling case) but will miss the true funding source for an
  old, active wallet. Worth a real-RPC sanity check once step 5's live
  pipeline exists and there's real data to look at, rather than guessing
  further offline.
- Step 5: wire `GET /api/feed` to a real pipeline. Still needs a way to
  discover *new* launches (a "create" instruction watcher/poller) — this
  remains the last unblocked-but-not-started piece, independent of which
  signals exist. Once it exists, `src/server.ts`'s stub feed can call
  `fetchHolderConcentrationInput` / `fetchLiquidityInput` /
  `fetchBundledBuysInput` for each new launch, run them through
  `scoreHolderConcentration` / `scoreLiquidity` / `scoreBundledBuys`, and
  combine with `combineSignals` — all the pieces now exist except the
  discovery step and the page rendering the real feed (currently a static
  placeholder).

## Session 5 — 2026-09-30

### Done
- Ran `npm install` in `/rug-radar` (node_modules isn't persisted between
  sessions).
- Signal 1, Deployer history — the last open signal — is now built, unblocking
  step 3 entirely (all four signals exist):
  - Research first: fetched the pump.fun program's public Anchor IDL
    (`idl/pump.json` in `pump-fun/pump-public-docs` on GitHub) to confirm the
    `create` instruction's exact account order and discriminator, rather than
    guessing from the docs prose (which only listed argument names, not
    account order). Confirmed `create` discriminator
    `[24,30,200,40,5,28,7,119]` with accounts `mint` (index 0),
    `bonding_curve` (index 2), `user`/deployer (index 7); also found
    `create_v2` (spl-token-2022 coins) with discriminator
    `[214,144,76,236,95,139,49,180]` and `user` at index 4 instead (fewer
    accounts before it — no metadata/mpl_token_metadata accounts in that
    variant). Both variants expose `bonding_curve` directly as an instruction
    account, so no PDA re-derivation is needed to find it.
  - `src/pumpfun.ts` — added `decodeCreateInstruction(dataBase58, accounts)`:
    decodes the instruction's base58 data, matches its first 8 bytes against
    the `create`/`create_v2` discriminators, and pulls `mint`/`bondingCurve`/
    `user` out of the accounts array at the right index for whichever variant
    matched (or returns `null` if neither matches, or accounts are short).
    Added 4 offline tests to `src/pumpfun.test.ts` (create, create_v2,
    unrelated discriminator, too-few-accounts).
  - `src/rpc.ts` — `ParsedTransaction.transaction.message` gained an optional
    `instructions` field (`MessageInstruction[]`), typed as a union of
    `PartiallyDecodedInstruction` (unrecognized programs like pump.fun:
    `programId` + raw `accounts` + base58 `data`) and `KnownProgramInstruction`
    (recognized programs, pre-parsed by the RPC). This was previously
    unmodeled since nothing needed instruction-level data yet — same
    "extend the type when something needs it, confirm against real RPC docs"
    approach used for `ParsedAccountKey` in session 4.
  - `src/signals/deployerHistory.ts` — `scoreDeployerHistory()`: takes the
    deployer's prior launches (mint + whether its curve migrated), scores by
    the share that never migrated (>=80% → 90, 50-80% → 55, else
    proportional). Fewer than 3 prior launches is flagged as too thin a
    sample and capped at 40 regardless of share, so e.g. one bad token isn't
    scored the same as a proven serial-abandoner pattern.
    `src/signals/deployerHistory.test.ts` — 7 offline tests incl. the thin-
    history cap and a boundary case.
  - `src/data/deployerHistory.ts` — `fetchDeployerHistoryInput()`: pages
    through the deployer's signature history, decodes any pump.fun
    create/create_v2 instruction where this wallet is the `user`, skips ones
    that created the current mint (not "prior" history) or a mint already
    seen, and for each prior mint reads its bonding curve account to check
    `complete`. `src/data/deployerHistory.test.ts` — 5 tests with fake RPC
    objects (no fetch mocking, same pattern as the other `data/*.test.ts`
    files): happy path with a mix of migrated/not, excludes current mint,
    ignores non-create transactions, skips failed transactions (no wasted
    `getTransaction` call), and ignores a create instruction from a
    different deployer.
- Updated `rug-radar/README.md`: signal 1 moved from "planned" to "built",
  `pumpfun.ts`'s description now covers `decodeCreateInstruction` and points
  at the IDL (not just the docs prose) as the source, and the top status
  line now says all four signals are built.

### Works
- `npm run typecheck` and `npm run build` are clean in `/rug-radar`.
- `npm test`: 64/64 passing, all offline (mocked `fetch`, fake RPC objects,
  or hand-built fixture buffers/instructions — no live network calls
  anywhere in tests).
- All four signals from TASK.md are now built: deployer history, bundled
  buys, holder concentration, liquidity/migration — plus the combiner.

### Next
- Step 5 is the only remaining piece: wire `GET /api/feed` to a real
  pipeline. Still needs a launch-discovery mechanism (poll
  `getSignaturesForAddress` on the pump.fun program ID itself, or on a
  known high-traffic account, for new `create`/`create_v2` instructions —
  the same decoding already built in `pumpfun.ts` and
  `data/deployerHistory.ts` works for this, just pointed at the program ID
  instead of one deployer). Once discovery exists, `src/server.ts`'s stub
  feed can call all four `fetch*Input` functions per new launch, score with
  `score*`, combine with `combineSignals`, and the page (currently a static
  placeholder in `public/index.html`) needs to poll `/api/feed` and render
  the list.
- `fetchDeployerHistoryInput`'s `signatureLimit` (default 100) bounds how far
  back it looks for a deployer's prior launches — same "fine for typical
  cases, will under-count a very prolific wallet" caveat as bundled buys'
  funding-source lookback (session 4). Worth a real-RPC sanity check once
  step 5 exists and there's live data to look at.
- No live-RPC smoke test has been run yet against any of the four signals'
  data-fetch functions (holder concentration, liquidity, bundled buys,
  deployer history) — all testing so far is offline against fixtures/fake
  RPC objects. Once step 5's discovery loop exists, running the full
  pipeline against one real, recent launch would be a good sanity check
  that the account layouts and instruction decoding hold up against live
  data, not just hand-built fixtures.

## Session 6 — 2026-09-30

*(Note: this entry was written retroactively in Session 8 — the run that did
this work hit its step limit right after finishing and never updated this
file. Reconstructed from `logs/session-0008.md`, which records every step.)*

### Done
- Step 5, first half: wired discovery into the live feed.
  `src/feed.ts` — `LiveFeed`, a bounded in-memory list of scored launches
  (newest first, default max 50). `src/poller.ts` — `pollOnce()`: one poll
  cycle (find new launches since the last watermark → score each via the
  pipeline → add to the feed), kept separate from `setInterval` so a single
  cycle is testable without real timers.
- `src/server.ts` rewritten from the step-1 stub: boots the RPC client and
  `LiveFeed`, runs `pollOnce` immediately and then every 15s, serves
  `GET /api/feed` with the real feed contents instead of `{ launches: [] }`.
- `public/index.html` rewritten from the static placeholder: polls
  `/api/feed` every 10s and renders each launch's mint, overall score
  (color-coded low/medium/high), and per-signal name + score + reasons.
  Checked `reasons` strings across all four signals before rendering via
  `innerHTML` — they're all server-built from numbers (percentages, SOL
  amounts, counts), never raw on-chain text, so no injection risk from
  rendering them directly.
- First live-RPC smoke test of the full pipeline (public mainnet-beta, no
  keys) found a real bug: `getTransaction` can return "not found" for a
  signature `getSignaturesForAddress` had just returned (the public RPC is
  multiple nodes behind a load balancer, not perfectly consistent), which
  crashed the whole discovery poll on one bad signature. Fixed in
  `discovery.ts` by catching and skipping a failed `getTransaction` instead
  of letting it abort the scan. Also started switching discovery away from
  `getSignaturesForAddress`'s `until` signature cursor toward a timestamp
  watermark, after seeing the `until` cursor itself error against this
  cluster — finished in Session 7.

### Works
- `npm run typecheck` and `npm run build` clean.
- `npm test`: 76/76 passing, still all offline.
- Manually booted the server with an unreachable RPC URL to confirm it
  boots, serves the stub feed, and logs/continues instead of crashing when
  polling fails.

### Next
- Finish the `until`-cursor → timestamp-watermark switch in `discovery.ts`
  (in progress when this session ended).
- Re-run the live smoke test once that's done.

## Session 7 — 2026-10-01

*(Also reconstructed retroactively in Session 8, from `logs/session-0009.md`
— this run also hit its step limit right after finishing.)*

### Done
- Found and fixed a bug left from Session 6's interrupted cursor→watermark
  switch: `discovery.ts` still returned a field named `newestSignature`
  instead of the new `newestBlockTime`, with stale call sites in
  `poller.ts`/`server.ts`/tests — would not have typechecked. Fixed all
  call sites consistently and rewrote `discovery.test.ts`/`poller.test.ts`
  for the timestamp-watermark API.
- Ran the live smoke test again and found two more real bugs: `getTransaction`
  calls in `src/data/deployerHistory.ts` and `src/data/bundledBuys.ts` had
  the same unguarded-failure problem Session 6 fixed in `discovery.ts` —
  one bad transaction in a wallet's history crashed that whole signal
  fetch. Rather than duplicating the try/catch in four places, factored it
  into a shared `safeGetTransaction()` helper in `src/rpc.ts` and switched
  all four call sites (discovery, deployer history x1, bundled buys x2) to
  use it. Added `rpc.test.ts` coverage for the helper itself.
- Confirmed the live pipeline works end-to-end against real mainnet-beta
  data after these fixes (discovery finds launches, pipeline scores them,
  no crashes on flaky-RPC edge cases). Deleted the scratch smoke-test
  script (`tmp-smoke.ts`) that had been accidentally left tracked from the
  interrupted Session 6.

### Works
- `npm run typecheck` and `npm run build` clean.
- `npm test`: 79/79 passing, all offline.
- Live pipeline confirmed working end-to-end against real mainnet-beta RPC
  calls (manual smoke test, not part of the automated suite).

### Next
- All five TASK.md steps now appear complete. A good next step is a
  longer/more adversarial live-RPC check — e.g. does discovery actually
  find launches at a realistic poll cadence, and does the public RPC's
  rate limit get hit under real polling frequency (inferred from where
  this run left off; it hit its step limit immediately after the above).

## Session 8 — 2026-10-01

### Done
- Found this file (PROGRESS.md) badly out of date: it stopped at "Session 5"
  even though the code on `main` already had discovery, the pipeline, the
  poller, the live feed, and the real server wiring — all of TASK.md's five
  steps, done across two runs (`logs/session-0008.md`,
  `logs/session-0009.md`) that both hit their step limit right after
  finishing and before writing here. Backfilled those as Session 6 and
  Session 7 above from the step logs (which record everything), so this
  file matches what is actually in the repo.
- Ran a real live-RPC smoke test (public mainnet-beta, no keys, same as
  Sessions 6-7) to sanity-check the "done" pipeline rather than taking the
  reconstructed history at face value, and found two more real problems:
  1. **No retry on HTTP 429.** Back-to-back `getTransaction` calls (e.g.
     discovery scanning many signatures in one poll) hit the public RPC's
     rate limit almost immediately, and `rpc.ts` had no retry — every 429
     just failed the call outright (caught by `safeGetTransaction` where
     used, but still silently drops data). Fixed: `SolanaRpcClient` now
     retries on 429 with exponential backoff (4 retries, 300ms base,
     configurable, injectable `sleep` so tests stay instant and offline).
     3 new tests in `rpc.test.ts` (retry-then-succeed, retries-exhausted,
     and the pre-existing 429 test updated to pass `maxRetries: 0` so it
     still checks the no-retry-left path).
  2. **`getTransaction` requested the wrong transaction version.** It
     hardcoded `maxSupportedTransactionVersion: 0`; live mainnet-beta now
     rejects that for most current transactions with "Transaction version
     (1) is not supported by the requesting client". This means Session 7's
     "live pipeline confirmed working end-to-end" was likely seeing a lot
     of silently-dropped transactions (via `safeGetTransaction`'s
     catch-and-skip) rather than genuinely resolving them — the smoke test
     logged the error but didn't fail loudly, so this had been hiding in
     plain sight. Fixed by bumping to `maxSupportedTransactionVersion: 1`;
     confirmed against live data this clears the error.
  3. **Discovery coverage is a bigger problem than documented.** Checked
     directly: `getSignaturesForAddress` on the pump.fun program ID returns
     1000 signatures spanning only ~2 seconds of real traffic (~500 tx/sec
     across all instruction types, not just creates). The existing
     `DEFAULT_LIMIT = 50` comment in `discovery.ts` described this as "a
     burst... will be under-counted", which understates it badly — at this
     volume, a 15s poll scanning 50 signatures catches a small slice of
     launches, not occasional bursts. Rewrote the comment to say so
     plainly and explain why raising the limit doesn't fix it (volume is
     far beyond any sane limit, and more signatures means more
     `getTransaction` calls, i.e. more 429s). Documented the real fix this
     needs — a websocket `logsSubscribe` with a `mentions` filter, parsing
     `"Instruction: Create"` out of the pushed log lines instead of polling
     signatures and fetching each transaction — as a known limitation in
     `rug-radar/README.md`, not attempted this session (meaningfully bigger
     than a small step: new transport, reconnection handling, log parsing).
- Updated `rug-radar/README.md`: status line now says all five TASK.md
  steps are built and live-sanity-checked (not "what's left"), added a
  "Live feed" section describing discovery → pipeline → poller → feed →
  server → page end-to-end, and a "Known limitations" section (discovery
  under-sampling, with numbers; the existing lookback-limit caveats from
  earlier sessions moved here too).

### Works
- `npm run typecheck` and `npm run build` clean.
- `npm test`: 81/81 passing, all offline (new retry tests use an injected
  fake `sleep`, so they run in milliseconds despite testing backoff
  behavior — no real network calls anywhere in the suite).
- Live-RPC smoke test (manual, public mainnet-beta, not part of the test
  suite) with both fixes in place: no more 429s, no more transaction
  version errors. Did not happen to catch a `create` instruction in the
  scanned window this run — expected and consistent with the coverage
  limitation documented above, not a new bug.

### Next
- The discovery coverage gap (above) is the main remaining issue — the
  live feed currently runs in production but will visibly under-report
  launches. A websocket-based redesign (`logsSubscribe` with a `mentions`
  filter) is the planned fix; worth scoping as its own session rather than
  rushing, since it changes the transport (no more polling on an interval)
  and needs reconnection/backoff handling of its own.
- No automated test exercises the real `server.ts` against live RPC (by
  design, per the "offline tests" rule) — the live-RPC smoke testing done
  in Sessions 6-8 has been manual and not repeatable without rerunning it
  by hand (a throwaway script, deleted before each session ends, never
  committed). Worth keeping that habit for any future change that touches
  the data layer.
- All five TASK.md steps are functionally complete; remaining work is
  hardening (discovery coverage, the lookback-limit caveats noted in
  earlier sessions for deployer history and bundled buys) rather than new
  features.

## Session 9 — 2026-10-01

*(Reconstructed from `logs/session-0011.md` — this run hit its step limit
before writing here; backfilled from the step log, same approach as Sessions
6-7.)*

### Done
- Started the websocket-based discovery redesign planned at the end of
  Session 8. Confirmed Node 20 (the runtime in use) doesn't expose a global
  `WebSocket` without the `--experimental-websocket` flag, and used a scratch
  probe script (`probe-ws.mjs`, meant to be deleted before the session ended
  but got left behind when the step limit hit) to capture real
  `logsNotification` log lines from a `logsSubscribe` subscription on the
  pump.fun program ID, confirming `mentions` matches every instruction type
  (not just creates) and that `"Instruction: Create"`/`"Instruction:
  CreateV2"` show up verbatim in the log lines for an actual create.
- `src/wsLogParser.ts` — `detectCreateInstruction()`: given a program ID and
  a transaction's log lines, finds whether a `create`/`create_v2` happened
  *for that program specifically* (not a same-named instruction logged by an
  unrelated program, and not a Create the target only CPIs into) by tracking
  Anchor's `Program X invoke [depth]`/`Program X success` nesting rather than
  just substring-matching the log text. `src/wsLogParser.test.ts` — 6 offline
  tests using hand-built log-line fixtures.
- Extracted `resolveLaunchFromSignature()` out of `src/discovery.ts` (was
  private to the polling loop) so both the poller and the new websocket path
  can turn a bare signature into a `DiscoveredLaunch` the same way, without
  duplicating the decode logic.
- `src/wsDiscovery.ts` — `LaunchWatcher`: subscribes to `logsSubscribe` with
  a `mentions` filter on the pump.fun program, runs every pushed
  notification's logs through `detectCreateInstruction` first and only calls
  `getTransaction` (via `resolveLaunchFromSignature`) on an actual match,
  reconnects with exponential backoff on a dropped connection, and dedupes
  redelivered signatures after a resubscribe (bounded `Set`). Takes the
  `WebSocket` constructor as an injectable factory (`WebSocketFactory`) so
  tests use a fake instead of a real socket or the DOM lib types.
  `src/wsDiscovery.test.ts` — 8 offline tests (dedup, reconnect-and-resubscribe,
  stop() suppressing reconnect, ignores non-create/errored notifications,
  `deriveWsUrl`'s https→wss / http→ws mapping).
- Started `src/feed.ts`'s dedup-by-mint (`has()`) needed before wiring both
  discovery paths into one feed, so a launch found by both the watcher and
  the backstop poll only gets scored once — session ended mid-wiring before
  `server.ts`/`config.ts` were updated to actually use `LaunchWatcher`.

### Works
- `npm run typecheck` and `npm test` were clean at 87/87 (mid-session,
  before `wsDiscovery.test.ts`'s final tests landed) per the step log;
  exact end-of-session state wasn't re-verified before the step limit hit
  (no final "all green" step recorded).

### Next (as left by this session, confirmed/continued in Session 10 below)
- `wsDiscovery.ts`/`wsLogParser.ts` existed but were not wired into
  `server.ts` — the live feed was still running on `discovery.ts`'s polling
  path alone at the end of this session.
- `probe-ws.mjs` (scratch, meant to be temporary) was left committed.
- `config.ts` had no `SOLANA_WS_URL` override yet.

## Session 10 — 2026-10-02

### Done
- Found Session 9 had left real, working code (`wsDiscovery.ts`,
  `wsLogParser.ts`, `feed.ts`'s dedup) unwired and a scratch file
  (`probe-ws.mjs`) committed by accident when its run hit the step limit.
  Verified the existing suite first (95/95 passing, clean typecheck) before
  touching anything, then finished the wiring:
  - `src/config.ts` — added optional `SOLANA_WS_URL` (falls back to
    `wsDiscovery.ts`'s `deriveWsUrl(rpcUrl)` when unset). Updated
    `config.test.ts` and `.env.example` to match.
  - `package.json` — `dev`/`start` now set `NODE_OPTIONS=--experimental-websocket`
    (Node 20 needs the flag; confirmed Node 22+ wouldn't, but this repo runs
    on Node 20).
  - `src/server.ts` — now runs `LaunchWatcher` (real-time, primary) alongside
    the existing `discovery.ts`/`poller.ts` polling loop (kept as a backstop
    for launches created during startup or a reconnect gap). Both paths feed
    the same `LiveFeed`, which already dedupes by mint from Session 9's
    `has()`/`add()` change, so a launch seen by both only scores once.
  - Deleted `probe-ws.mjs` (the leftover scratch probe).
- Live-booted the server (manual, not part of the automated suite, deleted
  no files this time since nothing scratch was created) and found a second
  real problem beyond what Session 9 left: the websocket watcher correctly
  finds create-like signatures in real time, but resolving several of them
  around the same time (plus the backstop poller's own `getTransaction`
  calls) fired enough concurrent requests to the public RPC that most hit
  HTTP 429 even with Session 8's retry-with-backoff, because every
  concurrent call backs off on roughly the same schedule and they keep
  colliding instead of draining. Fixed: `SolanaRpcClient` (`src/rpc.ts`) now
  caps in-flight requests at a configurable `maxConcurrent` (default 4),
  shared across every caller via one queue, so bursts are spaced out instead
  of all landing on the rate limiter at once. `rpc.test.ts` — 1 new test
  using a manually-released fake `fetch` to assert the cap holds and queued
  calls still complete.
- Re-ran the live smoke test after the concurrency fix: 429s are reduced but
  not eliminated — the free public RPC's quota is tight enough that
  client-side queuing alone doesn't fully escape it. This fails closed, not
  loudly (`safeGetTransaction` already catches and skips, from Session 7),
  so the symptom is under-reported launches, not a crash. Documented as the
  new top "Known limitations" entry in `rug-radar/README.md` rather than
  chasing it further — a real fix needs a paid/less-restricted RPC, out of
  scope for "public RPC, no keys."
- Updated `rug-radar/README.md`: "Live feed" section now describes both
  discovery paths (websocket primary, polling backstop) and the concurrency
  cap; "Known limitations" reordered so the rate-limit ceiling (still
  binding) leads, with the old "discovery under-samples" note kept but
  reframed as why the polling path is now the backstop rather than primary.

### Works
- `npm run typecheck` and `npm run build` clean.
- `npm test`: 96/96 passing, all offline (fake WebSocket/fetch objects and
  hand-built log-line fixtures — no live network calls in the suite).
- Live-booted `npm start` twice (manual smoke test, ~30s each, public
  mainnet-beta, no keys): server boots, logs the RPC and derived WS URL,
  the websocket watcher connects and finds create-like candidates (visible
  via the `getTransaction failed: ... 429` lines when the rate limit is
  hit), `/api/feed` keeps responding the whole time, no crash.

### Next
- The public RPC rate limit is now the main remaining gap — see "Known
  limitations" in the README. Options worth considering next: backing off
  the websocket path's own concurrency independently of the backstop
  poller's (right now they share one client-wide cap, so a busy poller
  cycle can still starve the watcher's resolves or vice versa), or simply
  accepting some under-reporting as inherent to a free public endpoint and
  focusing further sessions elsewhere.
- No automated test exercises `server.ts` wiring both discovery paths
  together against live RPC (by design — offline tests only); the live
  smoke testing in this session was manual, same caveat noted in every
  session since Session 6.
- All five TASK.md steps remain functionally complete; what's left is
  hardening around the rate-limit ceiling, not new features.

## Session 11 — 2026-10-02

### Done
- Picked up the first of the two options Session 10 left open ("separate
  concurrency for the websocket path vs. the backstop poller" vs. "accept
  under-reporting"): `src/server.ts` now builds two `SolanaRpcClient`s
  (`watcherRpc`, `pollRpc`), each `maxConcurrent: 2`, instead of one shared
  client with `maxConcurrent: 4`. Same total requests in flight against the
  public RPC as before (4), but the websocket watcher's latency-sensitive
  resolve call (and the scoring it triggers) no longer queues behind the
  backstop poller's own signature scans and scoring, or vice versa. No
  changes needed to `rpc.ts`, `wsDiscovery.ts`, or `pipeline.ts` — all three
  already took an injected RPC client/interface, so this was purely a
  `server.ts` wiring change.
- Updated `rug-radar/README.md`'s data-layer section to describe the split
  clients and why (latency-sensitive path vs. bursty backstop); left "Known
  limitations" as-is since the rate-limit ceiling itself isn't changed by
  this, only which local caller waits for it.
- No test changes: `server.ts` has no dedicated test file (by design, same
  as every prior session — it wires real RPC/websocket calls, offline tests
  live at the `rpc.ts`/`wsDiscovery.ts`/`pipeline.ts` level instead). Verified
  by hand: typecheck, build, and `npm test` (96/96, unchanged) stayed clean,
  then live-booted `npm start` against public mainnet-beta — server boots,
  logs both RPC/WS URLs, watcher connects, `/api/feed` responds — before
  killing it and confirming `git status` showed only the intended
  `server.ts` edit (no stray scratch files).

### Works
- `npm run typecheck`, `npm run build`, and `npm test` (96/96, offline) all
  clean in `/rug-radar`.
- Live-booted `npm start` once (~8s, public mainnet-beta, no keys): boots
  cleanly, `/api/feed` responds, no crash, no leftover process or scratch
  files afterward.

### Next
- The public RPC's rate limit itself is still the binding constraint (see
  README's "Known limitations") — this session only improved fairness
  between the two discovery paths sharing it, not the ceiling itself. A real
  fix needs a paid/less-restricted RPC, out of scope for "public RPC, no
  keys."
- The `fetchDeployerHistoryInput`/`findFundingSource` lookback-limit caveats
  (noted since Sessions 4-5) are still untouched — would need a real-RPC
  sanity check against a long-history wallet to judge whether the current
  defaults are worth adjusting, not guessed offline.
- All five TASK.md steps remain functionally complete; remaining work is
  further hardening, not new features.

## Session 12 — 2026-10-02

### Done
- Ran the real-RPC sanity check flagged since Session 4/11: used the
  websocket watcher (`LaunchWatcher`) to capture real, live pump.fun creates
  (no scanning — the earlier attempt scanning 400 of the program's own recent
  signatures found zero creates, confirming how small a slice of the firehose
  that is). Found a real deployer wallet
  (`4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf`) creating a new mint roughly
  every 1-2 seconds.
- Ran the actual production functions (`fetchDeployerHistoryInput` +
  `scoreDeployerHistory`, not just raw signature counts) against that live
  deployer. Result: within the default 100-signature scan, the signal found
  only 0-1 "prior launches" and scored it `0` ("no prior tokens found") — the
  lowest possible risk reading for one of the most prolific create-spamming
  wallets observed. This is a confirmed false-negative on exactly the pattern
  the signal exists to catch, worse than the vague "under-counts a very
  prolific wallet" caveat on record since Session 4 — most of that wallet's
  own signature history isn't creates at all, so create density within any
  scan window is low and raising the limit only helps proportionally while
  multiplying `getTransaction` calls (worse 429s).
  - Along the way, hit what looked like a crash in `scoreDeployerHistory`
    (`Cannot read properties of undefined (reading 'length')`) — turned out
    to be a bug in the scratch probe script itself (passed the array
    directly instead of `{ deployer, priorLaunches }`); confirmed
    `pipeline.ts:36` already calls it correctly. Not a real bug, but worth
    recording so it isn't re-investigated from scratch next time.
  - Did not get to the matching live check for `findFundingSource`
    (bundled buys' funding-source lookback, default 50 signatures) — the
    freshly-created mints used above hadn't accumulated enough early-buy
    activity in the session window. Still open.
- Updated `rug-radar/README.md`'s "Known limitations": replaced the vague
  deployer-history/bundled-buys lookback caveat with the concrete finding
  above, and proposed (not yet built) a direction that avoids the cold-start
  problem differently: since the websocket watcher already observes every
  create it discovers in real time, it could build its own running
  `deployer -> prior mints` index from launches seen live, instead of relying
  only on retroactively scanning `getSignaturesForAddress` after the fact.
  That wouldn't fix a deployer's pre-existing history but would stop
  under-counting repeat offenders going forward.
- Deleted all scratch probe files created this session
  (`tmp-probe-lookback.ts`, `tmp-probe-buys.ts`, `tmp-capture.ts`,
  `tmp-probe-signal.ts`) before finishing — none were meant to be committed,
  same habit as prior sessions' scratch smoke-test scripts.

### Works
- `npm run typecheck`, `npm run build`, and `npm test` (96/96, offline) all
  clean in `/rug-radar` — no production code changed this session, only
  `README.md`/`PROGRESS.md` and (deleted) scratch files.
- Live-RPC checks performed with the real, unmodified production code
  (`fetchDeployerHistoryInput`, `scoreDeployerHistory`, `LaunchWatcher`)
  against public mainnet-beta, not just raw RPC probing — see "Done" above.

### Next
- The deployer-history false-negative on prolific wallets (above) is the
  most concrete, now-proven issue on record. Worth a real fix in a focused
  session: either the live-observed-index idea sketched above, or research
  into why create density is so low in this wallet's own signature history
  (e.g. does pump.fun's `create` bundle with several other instructions'
  worth of signatures per launch, or is this wallet doing unrelated
  high-frequency activity too) before picking an approach.
- `findFundingSource`'s lookback-limit still hasn't had its live check —
  needs a mint with real early-buy activity (not one captured seconds before
  the check) to find a buyer wallet old enough to test against.
- All five TASK.md steps remain functionally complete; the rate-limit
  ceiling and the deployer-history false-negative above are the two most
  concrete hardening items on record.

## Session 13 — 2026-10-02

### Done
- Picked up the most concrete open item from Session 12 (the deployer-history
  false-negative on prolific wallets) and built the fix it had sketched but
  not attempted: a live-observed deployer index.
  - `src/deployerIndex.ts` — `DeployerIndex`: an in-memory `deployer -> mint
    -> bondingCurve` map, built up as launches are *discovered* (not scanned
    retroactively). Bounded by a single FIFO across all deployers (same
    pattern as `LiveFeed`/`LaunchWatcher`'s own dedup structures) so a
    long-running process doesn't grow this forever. `record()` is dedup-safe
    (idempotent per mint); `getPriorLaunches(deployer, excludeMint)` returns
    everything known for a deployer except the mint currently being scored.
    `src/deployerIndex.test.ts` — 6 offline tests (empty lookup, record +
    lookup, self-exclusion, dedup, cross-deployer isolation, FIFO eviction).
  - `src/data/deployerHistory.ts` — `fetchDeployerHistoryInput()` gained an
    `observedPriorLaunches` option: after the existing retroactive scan,
    merges in any observed mints not already found by the scan (deduped by
    mint against both the scan's results and the current mint), checking
    each one's migration status the same way the scan does. 4 new tests in
    `src/data/deployerHistory.test.ts` (merges a scan-missed mint, doesn't
    double-count one the scan already found, excludes the current mint even
    if wrongly passed in as "observed").
  - `src/pipeline.ts` — `scoreLaunch()` takes an optional `deployerIndex`
    param: records the current launch into it, then passes
    `getPriorLaunches()`'s result into `fetchDeployerHistoryInput` as
    `observedPriorLaunches`. Recording happens before the lookup, but
    `getPriorLaunches`'s `excludeMint` makes the order not matter for
    correctness. 2 new tests in `src/pipeline.test.ts` (the index catches a
    prior launch the scan can't see; scoring a launch records it for a later
    lookup).
  - `src/poller.ts` — `pollOnce()` takes the same optional `deployerIndex`
    param and threads it into `scoreLaunch`. No test changes needed (existing
    tests call it without the new optional param).
  - `src/server.ts` — one `DeployerIndex` shared across both discovery paths
    (websocket watcher and backstop poller), so a launch seen by either path
    updates the same index.
- Live-verified the fix, not just the offline tests: wrote a throwaway probe
  (`tmp-probe-index.ts`, deleted before finishing, same habit as prior
  sessions' scratch scripts) that watched the real websocket feed for the
  same prolific deployer flagged in Session 12
  (`4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf`) and called the real
  `fetchDeployerHistoryInput` + `scoreDeployerHistory` functions (with the
  retroactive scan's `signatureLimit` set to 1, to isolate the index's own
  contribution) each time it created a new mint. Confirmed live: by the
  deployer's 4th launch observed in the process, the score rose from `40`
  ("too few prior tokens to call it a pattern") to `90` ("4 of 4 prior tokens
  from this deployer never migrated (100%)") — the exact false-negative
  Session 12 found, now caught.
- Updated `rug-radar/README.md`: the "Deployer history" signal description
  now mentions `deployerIndex.ts`; the "Known limitations" entry for the
  false-negative is marked "Partially fixed" with what it does/doesn't cover
  (doesn't help a deployer's pre-existing, pre-startup history — only the
  retroactive scan can see further back than process start) and the live
  numbers from the check above.

### Works
- `npm run typecheck` and `npm run build` clean.
- `npm test`: 107/107 passing (11 new), all offline (fake RPC objects, no
  live calls in the automated suite).
- Live-booted `npm start` once (~8s, public mainnet-beta, no keys): boots
  cleanly, `/api/feed` responds, no crash.
- Live-verified the actual fix (not just offline tests) against a real
  repeat deployer via a deleted scratch probe — see "Done" above for the
  before/after scores.
- `git status` showed only the intended files changed after cleanup — no
  leftover scratch probe.

### Next
- The live check above isolated the index's contribution with
  `signatureLimit: 1`; haven't checked the realistic combined case (default
  `signatureLimit: 100` scan + index together) against a repeat deployer,
  though there's no reason to expect it behaves differently — the merge just
  adds more candidates to the same dedup logic.
- `findFundingSource`'s lookback-limit (bundled buys) still hasn't had its
  live check — flagged since Session 4, still open, needs a mint with real
  early-buy activity old enough to test against (same blocker noted in
  Session 12).
- The public RPC rate-limit ceiling (README's top "Known limitations" entry)
  is unchanged by this session — still the main remaining hardening item
  along with whatever the next live-RPC check surfaces.
- All five TASK.md steps remain functionally complete.

## Sessions 14-16 — 2026-10-02 / 2026-10-03

*(Reconstructed from `logs/session-0014.md`, `logs/session-0015.md`,
`logs/session-0016.md` — none of these runs updated this file before hitting
their step limit or finishing; same recurring issue as Sessions 6-9.)*

- Session 14 re-confirmed (same finding as Session 12, same deployer wallet)
  the deployer-history false-negative on prolific creators; Session 15 then
  built and live-verified the `DeployerIndex` fix described under Session 13
  above (the two sessions' logs describe the same work — Session 13's write-up
  above is the one that matches what actually landed in the repo).
- Session 16 was very short (13 steps): re-read the backlog, found Session 4's
  long-open item ("live-check `findFundingSource`'s lookback limit") still
  outstanding, and started a live probe (`tmp-probe-funding.ts`, watching the
  websocket feed for a fresh mint with enough early-buy activity to test
  against) before hitting its step limit. The probe script was left committed
  — picked up and run in Session 17.

## Session 17 — 2026-10-03

*(Reconstructed from `logs/session-0017.md` — this run hit its step limit
mid-fix and never updated this file. Completed and verified in Session 18
below; see that entry for final state.)*

### Done
- Ran Session 16's leftover `tmp-probe-funding.ts`, but it surfaced a bigger,
  unrelated problem before the funding-source question could be answered:
  the **websocket watcher was silently dropping every live launch**.
  `detectCreateInstruction` correctly found `create_v2` instructions in
  real-time log pushes (13 in 30s in one capture), but
  `resolveLaunchFromSignature`'s `getTransaction` call for each of those
  signatures came back null every time. Root cause, confirmed by timing one
  signature directly: the public RPC's multi-node cluster can take several
  seconds (~8.5s measured) after a `logsSubscribe` push before the matching
  transaction is visible via `getTransaction` on whichever node answers that
  call — a "not found" result isn't an exception, so nothing surfaced the
  loss; the launch was just gone.
- Fixed in `src/discovery.ts`: `resolveLaunchFromSignature` now retries a
  null `getTransaction` result with exponential backoff (5 retries, 750ms
  base, ~23s total budget — sized from the measured ~8.5s lag) before giving
  up; a transaction that resolves but isn't a create is still returned
  immediately (never retried, since that outcome can't change). `sleep` is
  injectable so tests stay offline. Wired the same options through
  `wsDiscovery.ts` (the primary path that hit this live) and
  `findNewLaunches`'s `resolveOptions` (the backstop poller can hit the same
  lag on very recent signatures).
- Added tests for the new retry behavior to `discovery.test.ts` and
  `wsDiscovery.test.ts`.
- Ran out of steps before finishing: two pre-existing tests in
  `discovery.test.ts` that trigger `resolveLaunchFromSignature` without
  passing `resolveOptions` started hitting the *real* `setTimeout`-based
  `defaultSleep` (no fake sleep injected), ballooning the offline suite's
  runtime from ~200ms to ~24s. Mid-fix on this when the session ended; six
  scratch diagnostic files (`tmp-diag*.ts`, plus Session 16's leftover
  `tmp-probe-funding.ts`) were left committed instead of deleted.

## Session 18 — 2026-10-03

### Done
- Picked up where Session 17 left off. Verified the repo first: typecheck and
  build clean, but `npm test` took ~24s (should be ~200ms-3s for an all-offline
  suite) — confirmed via per-file timing that one test in `discovery.test.ts`
  ("skips a signature whose getTransaction call throws, instead of failing the
  whole poll") was the culprit: `safeGetTransaction` treats a thrown error the
  same as "not found", so Session 17's new retry loop ran for real with no
  injected sleep (750ms, 1500, 3000, 6000, 12000ms = ~23.25s). Fixed by passing
  `resolveOptions: { retries: 0 }` to that test's `findNewLaunches` call,
  matching the pattern the adjacent "finds a create instruction..." test
  already used — this test's intent is "a throw doesn't crash the whole poll",
  not retry behavior (which the three dedicated `resolveLaunchFromSignature`
  tests already cover with injected fake sleeps). Suite is back to ~2.6-3s,
  111/111 passing, all offline.
- Deleted the 7 scratch diagnostic files Session 17 (and Session 16's
  `tmp-probe-funding.ts`) left committed (`tmp-diag.ts` through `tmp-diag6.ts`,
  `tmp-probe-funding.ts`) — none were meant to be kept, same cleanup habit as
  every prior session's scratch probes.
- Documented Session 17's real fix (the replication-lag retry) in
  `rug-radar/README.md`'s "Live feed" section, since it had landed in code but
  was never written up — explains the ~8.5s measured lag, the retry budget,
  and why only a "not found" result (not a resolved-but-not-a-create result)
  is retried.
- Backfilled this file for Sessions 14-17 (all four either didn't touch this
  file or got overwritten by a reconstruction that stopped at Session 13),
  same "reconstruct from `logs/session-*.md`" approach used for Sessions 6-9.
- Accidentally ran `cp .env.example .env` during a live smoke-test attempt,
  which conflicts with this project's "never write `.env` files" rule even
  though the content is just public placeholders with no secrets — caught it
  immediately and deleted the file before it was ever staged or committed.
  Re-ran the smoke test instead via `node --import tsx src/server.ts`
  directly, which needs no `.env` since `config.ts` already falls back to the
  public default RPC URL.

### Works
- `npm run typecheck` and `npm run build` clean in `/rug-radar`.
- `npm test`: 111/111 passing in ~2.6-3s (down from ~24s), all offline — no
  real timers, no live network calls.
- Live-booted the server directly (public mainnet-beta, no `.env`, ~12s):
  boots cleanly, logs both RPC and derived WS URLs, `/api/feed` responds
  `{"launches":[]}` while running, occasional `getTransaction failed: ... 429`
  lines consistent with the documented rate-limit ceiling, no crash.
- `git status` after cleanup shows only the intended README/test/PROGRESS
  changes plus the 7 scratch-file deletions — no stray files, no `.env`.

### Next
- `findFundingSource`'s lookback-limit live check (flagged since Session 4,
  restarted in Session 16, interrupted by the bigger bug Session 17 found) is
  still open — needs a fresh mint with enough early-buy activity to test
  against.
- The public RPC rate-limit ceiling (README's top "Known limitations" entry)
  is unchanged — still the main structural constraint of using a free,
  keyless endpoint.
- Worth double-checking, next time the live feed runs for a while, whether
  Session 17's retry budget (~23s worst case per unresolved signature) ever
  causes the backstop poller's 15s interval to overlap with itself on a slow
  signature — `pollOnce` currently awaits the whole `findNewLaunches` call
  before the next interval fires, so a worst-case retry chain would delay the
  next scheduled poll rather than overlap it, which seems fine but hasn't
  been observed live.
- All five TASK.md steps remain functionally complete; remaining work is
  hardening (rate limit, the two open lookback-limit checks) rather than new
  features.

## Session 19 — 2026-10-03

### Done
- Picked up the oldest open item (`findFundingSource`'s lookback-limit live
  check, flagged since Session 4) by watching the real websocket feed for a
  fresh mint with early-buy activity, same pattern as Session 12's deployer-
  history live check. Never got there: the watcher couldn't resolve a single
  live launch in the time available, which turned into a bigger finding.
- Live-checked `LaunchWatcher` in isolation (no competing calls, production's
  own `maxConcurrent: 2`) for 3 straight minutes against real mainnet-beta:
  **zero** launches resolved, a 429 on essentially every `getTransaction`
  call. Previously documented as "occasional 429s, reduced but not
  eliminated" (Session 10) — this is categorically worse.
- Root-caused a real, now-fixed bug that was making it worse:
  `resolveLaunchFromSignature` (`src/discovery.ts`) called
  `safeGetTransaction`, which swallowed a thrown error (e.g. a 429 that
  exhausted `rpc.ts`'s own 4 retries) to the same `null` as a genuine
  "not found yet" result. Its not-found retry loop then retried a rate-limit
  exhaustion exactly like replication lag — up to 5 more rounds, each
  re-running `rpc.ts`'s own 4-retry backoff, i.e. up to ~20-25 real HTTP
  calls for one signature, hammering an endpoint that had just asked for a
  slower pace. Fixed: `resolveLaunchFromSignature` now distinguishes a
  thrown error (gives up immediately, no retry) from a genuine `null`
  (retries as before, unchanged). `src/discovery.test.ts` — 1 new test
  pinning this (`retries: 5` passed but `calls` stays at 1 on a throw);
  removed a no-longer-needed `resolveOptions: { retries: 0 }` workaround
  from an existing test now that a throw never enters the retry loop.
- Re-ran the same 3-minute live check after the fix: still zero launches
  resolved. The amplification bug was real and worth fixing — it was
  actively self-reinforcing the exact problem it was trying to survive — but
  it wasn't the whole story. The public endpoint's current throttling is
  tight enough that even a single, non-amplified attempt per signature
  mostly fails.
- Updated `rug-radar/README.md`'s top "Known limitations" entry with this
  finding (previously "occasional 429s" → now "currently severe enough to
  stall live discovery almost entirely"), the fix, and that it's a point-in-
  time observation worth re-checking later (could reflect load on the free
  endpoint varying over time). Updated the `findFundingSource` bullet: still
  open, now understood to be blocked by this bigger issue rather than just
  needing a lucky mint with enough early-buy activity.
- Deleted both scratch probe scripts used for the live checks
  (`tmp-probe-funding.ts`, `tmp-probe-watcher-only.ts`) before finishing —
  same cleanup habit as every prior session.

### Works
- `npm run typecheck` and `npm run build` clean in `/rug-radar`.
- `npm test`: 112/112 passing (1 new), all offline, ~2.7-2.8s.
- Live-checked the real, unmodified-then-fixed `LaunchWatcher` against
  public mainnet-beta twice (before/after the fix) — see "Done" above.
- `git status` after cleanup shows only the intended `discovery.ts`/
  `discovery.test.ts`/README/PROGRESS changes — no stray scratch files.

### Next
- `findFundingSource`'s lookback-limit live check (open since Session 4) is
  still blocked — needs the rate-limit situation to ease, or a lower-traffic
  window, before a launch can even be resolved to test against.
- Worth re-running the 3-minute isolated-watcher check at a different time of
  day to see if the "zero resolved in 3 minutes" result was specific to this
  session's window or a persistent new floor — the finding above is time-
  stamped, not necessarily permanent.
- If the rate limit genuinely has tightened to this degree persistently, the
  backstop poller (`src/discovery.ts`'s 15s interval) is likely also mostly
  failing right now, not just under-sampling as previously documented — not
  separately live-checked this session, but it shares the same
  `getTransaction` call and endpoint.
- All five TASK.md steps remain functionally complete; the rate-limit
  ceiling (now confirmed more severe than previously documented, independent
  of the amplification bug this session fixed) is the main open item.

## Session 20 — 2026-10-03

*(Reconstructed from `logs/session-0020.md` — this run hit its step limit
right after its last README edit and never updated this file. Verified
against the actual code/README diff in Session 21, same approach as prior
reconstructions.)*

### Done
- Picked up Session 19's confirmed finding (the official public RPC's rate
  limit stalls discovery almost entirely) and found a real fix: live-checked
  several alternative public endpoints and found `solana-rpc.publicnode.com`
  handles the same `getTransaction` volume discovery needs with **zero**
  429s (37-42 launches resolved in a 90s `LaunchWatcher`-only check, vs.
  **zero** resolved and 172/172 calls hitting 429 on
  `api.mainnet-beta.solana.com` in the same window) and supports
  `logsSubscribe` over websocket. It can't fully replace the official
  endpoint, though — its free tier blocks "indexed" token methods
  (`getTokenSupply`, `getTokenLargestAccounts`, needed by holder
  concentration) behind a personal-token signup.
- Split config into two RPC URLs instead of one: `src/config.ts` gained
  `discoveryRpcUrl` (env `SOLANA_DISCOVERY_RPC_URL`, defaults to
  `solana-rpc.publicnode.com`) alongside the existing `rpcUrl` (env
  `SOLANA_RPC_URL`, unchanged default, now used only for per-launch
  scoring). `src/poller.ts`'s `pollOnce()` takes separate `discoveryRpc`/
  `scoringRpc` params instead of one client. `src/server.ts` now builds four
  `SolanaRpcClient`s (discovery × 2 paths, scoring × 2 paths, each
  `maxConcurrent: 2`, same per-path fairness reasoning as Session 11's
  split, now applied per endpoint) and passes the right one to the watcher
  vs. the backstop poller. Updated `config.test.ts`, `poller.test.ts`,
  `.env.example` to match.
- Live-booted the real server end-to-end after the wiring change and found a
  new, concrete bottleneck one layer down: with discovery actually working
  now, far more launches reach scoring than before, and scoring still runs
  over the official rate-limited endpoint (needed for the token methods the
  discovery endpoint blocks). A 100-second boot saw 18 signal failures
  (mostly `getTokenLargestAccounts` 429s) and **zero** launches land in
  `/api/feed` — confirmed not a hang (an isolated `getTokenSupply` call
  against the same endpoint at the same time succeeded in 157ms), but
  scoring work arriving faster than `maxConcurrent: 2` can drain against a
  rate-limited endpoint. Documented as a new, unfixed finding rather than
  attempted — fixing the first bottleneck exposed this one, and the fix
  (backpressure, e.g. capping pending-scoring count and dropping the rest)
  is a different-shaped change than this session's endpoint split.
- Updated `rug-radar/README.md`: "Live feed" section gained a "Two public RPC
  endpoints, not one" subsection with the live numbers above; "Known
  limitations" top entry rewritten to describe discovery's fix and the new
  scoring-side bottleneck it exposed; "Setup" section documents the new
  `SOLANA_DISCOVERY_RPC_URL` env var.
- Ran out of steps before updating this file. Left two scratch probe files
  committed (`rug-radar/tmp-probe-ratelimit.ts`, `rug-radar/tmp-probe-score-one.ts`)
  — same step-limit-interrupts-cleanup pattern as Sessions 17 and 19;
  deleted in Session 21 (see below).

### Works (per the step log; re-verified in Session 21)
- `npm run typecheck` and `npm test` (112/112, offline, unchanged count —
  `config.test.ts` extended existing tests rather than adding new ones)
  clean after the config/poller/server changes.
- Live-booted the real server twice: once confirming the endpoint split
  resolves launches via discovery, once (100s) surfacing the scoring-side
  429 bottleneck above.

### Next
- The scoring-side bottleneck found this session (discovery now works, but
  scoring over the official rate-limited endpoint can't keep up with the
  resulting volume) is the most concrete open item — needs a backpressure
  mechanism (e.g. cap in-flight/pending scoring count, drop the rest; the
  feed already tolerates missed launches) or an accepted-tradeoff writeup if
  that's not worth building.
- `findFundingSource`'s lookback-limit live check (open since Session 4) is
  still blocked — it calls `getSignaturesForAddress`/`getTransaction` on the
  scoring endpoint, so it needs the new bottleneck above resolved (or at
  least eased) before a result can come back to check against.
- All five TASK.md steps remain functionally complete; the scoring-side rate
  limit (not the discovery-side one, now fixed) is the main open item.

## Session 21 — 2026-10-04

### Done
- Found Session 20 had left real, verified work (the two-RPC-endpoint split
  fixing discovery) but never updated this file, and left two scratch probe
  files committed (`rug-radar/tmp-probe-ratelimit.ts`,
  `rug-radar/tmp-probe-score-one.ts`). Verified the repo first (typecheck,
  build, 112/112 tests clean; the `config.ts`/`poller.ts`/`server.ts`/
  `.env.example`/README changes Session 20's log described were all
  actually present and consistent), then deleted both scratch files and
  backfilled the Session 20 entry above from `logs/session-0020.md`.
- Picked up Session 20's most concrete open item — the scoring-side
  bottleneck it found (discovery now works, but far more launches reach
  scoring than before, and scoring over the official rate-limited endpoint
  couldn't drain the resulting queue: 18 signal failures, zero launches
  landed in `/api/feed` over 100s) — and built the backpressure mechanism
  it proposed instead of just accepting the gap:
  - `src/scoringGate.ts` — `ScoringGate`: caps how many launches can be
    scoring at once; `tryAcquire()` returns false once at the cap (caller
    should drop the launch, not queue it) and `release()` frees a slot.
    Deliberately drops rather than queues — queuing was the exact bug found
    in Session 20 (an unbounded backlog against a rate-limited endpoint
    never drains). `src/scoringGate.test.ts` — 4 offline tests (acquire up
    to cap, reject over cap, release frees a slot, a cap of 0 rejects
    immediately).
  - `src/poller.ts` — `pollOnce()` gained an optional `scoringGate` param:
    when passed, checks `tryAcquire()` before scoring each launch found in
    that cycle, skips (logs "too many pending scores") if full, releases in
    a `finally` either way. Existing tests unaffected (param is optional);
    2 new tests in `poller.test.ts` (a full gate drops the launch and still
    advances the watermark; a gate with room releases its slot so a later
    acquire succeeds).
  - `src/server.ts` — one `ScoringGate(3)` shared across both discovery
    paths (the websocket watcher's `onLaunch` callback and the backstop
    poller's `pollOnce` call), since both ultimately score against the same
    rate-limited scoring endpoint. The watcher's callback now checks
    `tryAcquire()` before calling `scoreLaunch`, skipping (same log message)
    if full, and releases in a `.finally()`.
- Live-booted the real server twice after wiring the gate in (public
  mainnet-beta, no keys): a 25s boot and a 60s boot. Confirmed the gate
  behaves as designed — the 60s boot logged 23 clean "too many pending
  scores" skips (backlog stays bounded, with a clear reason logged) instead
  of Session 20's silent, ever-growing queue, and 429s/signal-failures
  dropped from Session 20's 18-in-100s to 17+3-in-60s (less contention per
  scoring attempt). **Honest result, not oversold:** zero launches still
  landed in `/api/feed` within either boot's window. The gate fixes "the
  backlog grows forever with no visibility into why" — it does not fix "the
  official scoring endpoint can sustain enough throughput to finish scoring
  a launch at all" right now. Documented this distinction clearly in the
  README rather than claiming the scoring bottleneck is resolved.
- Updated `rug-radar/README.md`: "Live feed" section gained a short
  "A scoring backpressure gate (session 21)" paragraph; "Known limitations"
  top entry extended with this session's fix and its honest live-boot
  result (bounded backlog, still zero scores landed in the test windows).

### Works
- `npm run typecheck` and `npm run build` clean in `/rug-radar`.
- `npm test`: 118/118 passing (6 new: 4 in `scoringGate.test.ts`, 2 in
  `poller.test.ts`), all offline, ~2.5s.
- Live-booted `npm`-equivalent (`node --import tsx src/server.ts`) twice
  against public mainnet-beta, no keys, no `.env` written: 25s and 60s —
  server boots, logs both RPC/WS URLs, gate skips are logged clearly,
  `/api/feed` keeps responding, no crash, no leftover process.
- `git status` after cleanup shows only the intended
  `scoringGate.ts`/`scoringGate.test.ts`/`poller.ts`/`poller.test.ts`/
  `server.ts`/README/PROGRESS changes plus the two scratch-file deletions —
  no stray files.

### Next
- The scoring-side rate limit itself (not the backlog-growth problem, now
  fixed) is the main remaining gap: zero launches landed in `/api/feed`
  across two live-boot windows even with the gate bounding the backlog.
  Worth the same kind of fix discovery got in Session 20 — finding an
  alternative public endpoint whose free tier isn't as tight for
  `getTokenSupply`/`getTokenLargestAccounts`/`getTransaction` (the token
  methods `solana-rpc.publicnode.com` itself blocks without a signup) —
  rather than tuning the gate's cap of 3 further, which only trades backlog
  size for drop rate without touching the underlying throughput ceiling.
- `findFundingSource`'s lookback-limit live check (open since Session 4) is
  still blocked on the same root cause — needs a launch to actually finish
  scoring (with real early-buy signal data available) before it can be
  checked against a long-history wallet.
- Worth re-running the live-boot check at a different time of day, same
  caveat Session 19 raised about its own rate-limit finding — the official
  endpoint's throttling could vary with load rather than being a fixed
  floor.
- All five TASK.md steps remain functionally complete; the scoring
  endpoint's rate-limit ceiling is the one concrete, reproducible open item.
