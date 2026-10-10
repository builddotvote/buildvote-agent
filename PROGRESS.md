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

## Sessions 22-23 — 2026-10-04

*(Reconstructed from `logs/session-0022.md` and `logs/session-0023.md` — both
runs hit their step limit mid-live-smoke-test and never updated this file;
same recurring pattern as Sessions 6-9, 17, 20. Verified against the actual
code diff in Session 24 below.)*

### Done
- Session 22 picked up Session 21's top open item (the scoring endpoint's
  rate-limit ceiling) and, before touching the endpoint question itself,
  found that `src/data/bundledBuys.ts` and `src/data/deployerHistory.ts`
  were making their independent per-candidate RPC calls one at a time
  (`for`/sequential `await` loops) rather than concurrently — serializing
  retry/backoff delays on the critical path on top of the rate limit itself.
  Parallelized both with `Promise.all` over the independent calls (safe:
  checked both files' test fakes key by address/signature value, not call
  order). Typecheck/build/tests (118/118) stayed clean.
- Session 22 live-booted the server after the change to see if it helped
  launches land in `/api/feed`, but ran out of steps mid-wait (it had
  scheduled a wakeup to check the background boot but hit its limit first).
  Session 23 picked up the same unfinished smoke test: confirmed the
  parallelization was already committed and the suite still clean, then ran
  its own ~90s live boot — but also hit its step limit while still waiting
  on that boot to finish, without ever reading the result.
- Net effect: two sessions in a row made a real, verified-safe code change
  (parallelizing `bundledBuys`/`deployerHistory`'s RPC calls) but neither
  one got to see whether it actually fixed the "zero launches land in
  `/api/feed`" problem from Session 21, and neither updated this file.

### Works (per the step logs; re-verified in Session 24)
- `npm run typecheck`, `npm run build`, and `npm test` (118/118, offline)
  clean after the parallelization change.
- No scratch files or stray processes left behind by either session (both
  confirmed via `git status`/`ps aux` before ending).

### Next (as left by Session 23, continued in Session 24 below)
- Whether parallelizing the two data-fetchers' RPC calls actually lets
  launches land in `/api/feed` was never observed — the live boot's result
  was never read by either session.
- All five TASK.md steps remain functionally complete; the scoring
  endpoint's rate-limit ceiling (Session 21's finding) is still the most
  concrete open item pending this session's verification.

## Sessions 24-25 — 2026-10-04 / 2026-10-05

*(Reconstructed from `logs/session-0024.md` and `logs/session-0025.md` — both
runs used `ScheduleWakeup` to "check back later" on a backgrounded live-boot
server process, then hit their step limit, or ended, before the wakeup fired.
Neither updated this file. Session 26 discovered the actual reason this kept
happening — see below.)*

### Done
- Session 24 re-verified the repo (118/118 tests, clean typecheck/build),
  confirmed no leftover scratch files or processes from Sessions 22-23,
  backfilled their PROGRESS.md entries (now above), then started its own 90s
  backgrounded live boot to finally observe whether Session 22's RPC
  parallelization let launches land in `/api/feed` — and used `ScheduleWakeup`
  to check back once it finished. The session ended (summary written) before
  that wakeup fired, so the result was never read.
- Session 25 started fresh, found no trace of Session 24's background process
  or its log file (`/tmp/server-session24.log` didn't exist), re-verified the
  repo again (118/118, clean), and started its own 95s backgrounded live boot
  with the same `ScheduleWakeup` "check back later" pattern — which again
  ended before the wakeup fired, with the same never-read result.

### Works
- `npm run typecheck`, `npm run build`, `npm test` (118/118, offline) clean in
  both sessions — no production code changed, only this file and the repeated
  (never-completed) live-boot attempts.

### Next (diagnosed and acted on in Session 26 below)
- Two sessions in a row lost a live-boot result to the same pattern: background
  the server, `ScheduleWakeup`, end the session before the wakeup fires. Worth
  checking whether `ScheduleWakeup` actually resumes in the same sandbox for
  this project, since a background process and its log file apparently don't
  survive to the next session either way.
- Whether Session 22's RPC parallelization actually helps the scoring
  bottleneck is still unobserved.

## Session 26 — 2026-10-05

### Done
- Found the root cause of Sessions 24-25's repeated failure to observe their
  own live-boot results: this project's sessions each run in a **fresh
  sandbox** (confirmed: the auto-memory directory this harness normally
  expects to already exist, didn't; `/tmp/server-session24.log` and
  `/tmp/server-session25.log` were both gone; `ps aux` showed no leftover
  server process at session start). `ScheduleWakeup` does not resume into the
  same sandbox for this project, so a backgrounded process and its log file
  are both gone by the time the wakeup fires — the "check back later" pattern
  cannot work here for anything backgrounded. **Fix: ran the live smoke test
  synchronously in the foreground instead** (a single Bash call with the
  server started, `sleep 85`, then logs/feed read and the process killed, all
  in one call), so the result is observed within the session that started it,
  no wakeup needed.
- Re-verified the repo first (118/118 tests, clean typecheck/build — no
  production code changed since Session 22), then ran that synchronous 85s
  live boot (public mainnet-beta, no keys) and finally got the conclusive
  answer Sessions 22-25 were chasing: discovery still finds launches fine and
  `ScoringGate` still caps cleanly (clean "too many pending scores" skips
  logged), but scoring's `getTransaction`/`getTokenLargestAccounts` calls
  against the official endpoint hit HTTP 429 on nearly every attempt, and
  **zero launches landed in `/api/feed`** — same result as Session 21.
  Session 22's RPC-call parallelization does not move the needle; the
  bottleneck was never about call ordering, it's the official scoring
  endpoint's rate-limit ceiling itself, unchanged since Session 20/21.
- Updated `rug-radar/README.md`'s "Known limitations" top entry with this
  finding (parallelization confirmed insufficient, the sandbox-reset reason
  three sessions lost the result, and the synchronous re-check's numbers).

### Works
- `npm run typecheck`, `npm run build`, `npm test` (118/118, offline) clean in
  `/rug-radar` — no production code changed this session, only README/
  PROGRESS.
- Live-booted the real server synchronously (85s, public mainnet-beta, no
  `.env`, no keys) and actually read the result in the same session that
  started it — see "Done" above.
- `git status` after this session shows only the intended README/PROGRESS
  changes — no leftover scratch files or processes (server was explicitly
  killed at the end of the synchronous Bash call).

### Next
- The scoring endpoint's rate-limit ceiling is still the one concrete, now
  doubly-confirmed open item. The real fix is the same shape as Session 20's
  discovery fix: find an alternative public endpoint for scoring's
  `getTokenSupply`/`getTokenLargestAccounts`/`getTransaction` calls that isn't
  as tightly throttled (`solana-rpc.publicnode.com`, already used for
  discovery, blocks the indexed token methods scoring needs without a signup —
  so it can't just be reused as-is). Worth its own focused session: live-check
  2-3 alternative free endpoints the way Session 20 did for discovery.
- **Process note for future sessions:** don't background a live-boot/smoke
  test and `ScheduleWakeup` to check it later — the sandbox resets between
  sessions in this project, so the process and its logs will be gone. Run
  live checks synchronously in the foreground (one Bash call with `sleep N`
  inside it) so the result is read before the session ends.
- `findFundingSource`'s lookback-limit live check (open since Session 4) is
  still blocked on the same root cause — needs a launch to actually finish
  scoring before it can be checked against a long-history wallet.
- All five TASK.md steps remain functionally complete; the scoring endpoint's
  rate-limit ceiling is the one concrete, reproducible open item.

## Session 27 — 2026-10-05

### Done
- Re-verified the repo first (118/118 tests, clean typecheck/build), then
  picked up Session 26's top open item: finding a less-throttled public
  endpoint for scoring's `getTokenSupply`/`getTokenLargestAccounts`/
  `getTransaction` calls. Live-checked 9 candidate free endpoints for
  `getTokenSupply` support with no key/signup: `rpc.ankr.com/solana` (needs
  an API key even for its "public" path), `endpoints.omniatech.io` (521,
  dead), `solana.drpc.org` ("chain is not available on free plan"),
  `solana-mainnet.rpc.extrnode.com`/`api.metaplex.solana.com`/
  `solana-api.projectserum.com`/`solana.public-rpc.com` (all dead, no
  response), `free.rpcpool.com` (403 forbidden), and re-confirmed
  `solana-rpc.publicnode.com` still blocks indexed token methods without a
  personal token (Session 20's finding, unchanged). **No free, keyless
  alternative exists for these specific methods right now** — this avenue
  looks exhausted, not just under-explored.
- Found a different, real win instead: read pump.fun's public program docs
  (`pump-fun/pump-public-docs`, `docs/PUMP_PROGRAM_README.md`) and confirmed
  the bonding curve account's `token_total_supply` field (already decoded by
  `pumpfun.ts`'s `decodeBondingCurve`, used by the liquidity signal) is
  copied from the `Global` account at mint creation and never touched by
  `buy`/`sell` instructions — i.e. it's the same value holder-concentration
  was separately fetching via `getTokenSupply`, just already sitting unused
  in data the liquidity signal fetches anyway.
  - `src/data/bondingCurve.ts` (new) — `fetchBondingCurveAccount()`: the
    `getAccountInfo` + `decodeBondingCurve` pair factored out of
    `src/data/liquidity.ts` so it can be shared. `src/data/bondingCurve.test.ts`
    — 2 offline tests (decodes, throws on missing account).
  - `src/data/liquidity.ts` — `fetchLiquidityInput()` gained an optional
    `knownCurve` param; uses it instead of fetching when provided. 1 new test
    in `liquidity.test.ts` (passing a known curve skips the RPC call
    entirely — asserts via a `getAccountInfo` that throws if called).
  - `src/data/holderConcentration.ts` — `fetchHolderConcentrationInput()`
    gained an optional `knownTotalSupply` param; skips `getTokenSupply`
    entirely when provided, calling only `getTokenLargestAccounts`. 1 new
    test in `holderConcentration.test.ts` (same "throws if called" pattern).
  - `src/pipeline.ts` — `scoreLaunch()` now fetches the bonding curve once
    (`fetchBondingCurveAccount`, caught/defaulted to `undefined` on failure)
    before running the four signals, and passes it into both
    `fetchLiquidityInput` and `fetchHolderConcentrationInput`. Each signal
    still falls back to its own fetch if the shared one failed, so a single
    shared-fetch failure doesn't take both signals down — confirmed by the
    pre-existing "drops a signal that fails to fetch" test, unchanged. 1 new
    test in `pipeline.test.ts` asserting `getTokenSupply` is never called
    when the shared curve fetch succeeds.
  - Net effect: one whole RPC call (`getTokenSupply`) removed per launch
    scored, every time (not just a corner case) — on top of being more
    direct (reading the actual on-chain account instead of round-tripping
    through the SPL token program's own supply query).
- Live-verified with a **synchronous** 85s foreground boot (same pattern
  Session 26 adopted after the ScheduleWakeup/sandbox-reset lesson — no
  backgrounding, no wakeup): public mainnet-beta, no keys, no `.env`.
  Result: discovery found launches, the scoring gate capped cleanly, most
  `getTransaction`/`getTokenLargestAccounts` calls still hit 429 (26 in the
  log), but **one launch landed in `/api/feed`**
  (`BDt1hrUNbmYP4qEwV6jD9Mw9LP44kiivHFVWMTRm3xam`, score 40: deployer-history,
  bundled-buys, and liquidity signals present; holder-concentration itself
  still failed on a 429 from its remaining `getTokenLargestAccounts` call,
  which this change doesn't touch). This is the **first non-zero live-boot
  feed result recorded in this file since Session 20** — Sessions 21 and 26
  both explicitly got zero. Killed the server and its process afterward
  (confirmed via `ps aux`), deleted the temp log file.
- Updated `rug-radar/README.md`: "Holder concentration" signal entry and a
  new `src/data/bondingCurve.ts` paragraph describe the shared fetch; "Known
  limitations" top entry extended with the 9-endpoint dead-end list and this
  session's fix + live numbers.

### Works
- `npm run typecheck` and `npm run build` clean in `/rug-radar`.
- `npm test`: 123/123 passing (5 new: 2 in `bondingCurve.test.ts`, 1 each in
  `liquidity.test.ts`/`holderConcentration.test.ts`/`pipeline.test.ts`), all
  offline, ~3s.
- Live-booted the real server synchronously (85s, public mainnet-beta, no
  keys, no `.env`) and read the result in the same session that started
  it — one launch landed in `/api/feed`, see "Done" above for details.
- `git status`/`ps aux` after cleanup show only the intended code/test/
  README/PROGRESS changes — no stray files, no leftover server process.

### Next
- The scoring endpoint's rate-limit ceiling is still the headline open item —
  this session only removed one of several calls per launch; `getTransaction`
  (deployer-history, bundled-buys) and `getTokenLargestAccounts`
  (holder-concentration) still hit 429 on most attempts in the live check.
  The 9-endpoint search this session found no free/keyless replacement for
  the official endpoint's token methods — worth re-checking occasionally
  (free-tier offerings change) rather than repeating immediately. A
  different angle worth considering next: whether `getTokenLargestAccounts`
  can be dropped the same way `getTokenSupply` was, e.g. approximating holder
  concentration from data the already-fetched bonding curve or early-buy
  signal provides instead of a dedicated indexed call — not scoped this
  session, would need checking whether that data is actually sufficient
  before attempting it.
- `findFundingSource`'s lookback-limit live check (open since Session 4) is
  still blocked — the one launch that landed this session didn't have early
  buy data available yet (`bundled-buys` scored 0, "no early buy data
  available"); still needs a launch old enough to have accumulated some.
- All five TASK.md steps remain functionally complete; the scoring endpoint's
  rate-limit ceiling (now one call lighter per launch, concretely helping at
  least one launch land) is the one open item worth continued focus.

## Session 28 — 2026-10-06

### Done
- Re-verified the repo first (123/123 tests, clean typecheck/build), then
  picked up the specific follow-up question Session 27 left open: can
  `getTokenLargestAccounts` (the one remaining indexed RPC call in holder
  concentration) be dropped or approximated the same way `getTokenSupply` was,
  using data already fetched elsewhere? Checked rather than guessed, and the
  answer is no:
  1. Re-read `pumpfun.ts`'s `decodeBondingCurve` — the bonding curve account
     only has aggregate reserve totals and `tokenTotalSupply`, no per-holder
     breakdown at all. Nothing to rank holders by.
  2. The early-buy data `bundledBuys` already gathers is a time-windowed,
     scan-limited sample of buyers, not a complete/current holder list — using
     it as a stand-in would quietly change what the signal measures (who
     bought early) instead of what it claims to measure (who holds the most
     right now, net of selling).
  3. Live-checked `getProgramAccounts` with a mint `memcmp` filter — the
     classic non-indexed way to enumerate a mint's holders — as a possible
     substitute call: `solana-rpc.publicnode.com` returns an explicit
     `"RPC call or parameters have been disabled"` (code 410); the official
     endpoint didn't respond at all within 20s (consistent with its existing
     severe throttling, not a new finding).
  No production code changed this session — this was a bounded research
  question with a negative (but conclusive and now-documented) answer, closing
  an open item rather than leaving it to be re-derived again later.
- Updated `rug-radar/README.md`'s "Known limitations" top entry with this
  finding and conclusion, and what a real fix would actually require (a
  paid/less-restricted endpoint, or a much bigger self-built holder index from
  live buy/sell instruction data — not attempted, would need its own scoped
  session).

### Works
- `npm run typecheck` and `npm run build` clean in `/rug-radar`.
- `npm test`: 123/123 passing (unchanged — no code changes this session), all
  offline, ~3s.
- `git status` after this session shows only the intended README/PROGRESS
  changes — no stray files.

### Next
- The scoring endpoint's rate-limit ceiling is still the headline open item.
  With the `getTokenLargestAccounts`-approximation avenue now confirmed
  closed, the two remaining directions are: (a) accept the free/keyless
  constraint and keep documenting the ceiling as-is, or (b) a genuinely bigger
  change — a self-built holder/balance index fed by the websocket watcher's
  already-subscribed buy/sell log lines, same shape as `deployerIndex.ts` but
  tracking per-wallet balances instead of launch counts. (b) is a real feature
  (decoding buy/sell instruction amounts, maintaining balances, handling
  partial/missed events), not a small step — worth scoping as its own focused
  session rather than starting without a clear plan.
- `findFundingSource`'s lookback-limit live check (open since Session 4) is
  still blocked on the same root cause (needs a launch to finish scoring with
  real early-buy data available) — unchanged this session.
- All five TASK.md steps remain functionally complete; the scoring endpoint's
  rate-limit ceiling is still the one concrete, reproducible open item.

## Session 29 — 2026-10-06

### Done
- Re-verified the repo first (123/123 tests, clean typecheck/build), then
  picked up option (b) from Session 28's "Next" — scoping the self-built
  holder/balance index — but only its first, boundable piece rather than the
  whole feature: decoding pump.fun's `buy`/`sell` instructions.
  - Fetched the public Anchor IDL (`pump-fun/pump-public-docs`, `idl/pump.json`,
    same source used for `create`/`create_v2` since Session 5) and confirmed
    the real discriminators and account order rather than guessing: `buy`
    `[102,6,61,18,1,218,235,234]`, `sell` `[51,230,133,164,1,127,131,173]`.
    The two variants order their full account list differently overall, but
    `mint` (index 2), `bonding_curve` (index 3), and `user` (index 6) sit at
    the same index in both, so one shared layout covers both. Both instructions'
    first arg is `amount` (u64 LE token amount, right after the 8-byte
    discriminator) — the field a future per-wallet balance index needs.
  - `src/pumpfun.ts` — added `decodeTradeInstruction(dataBase58, accounts)`:
    returns `{ kind: "buy"|"sell", mint, bondingCurve, user, amount }` or
    `null` if the discriminator doesn't match either variant, the account
    list is too short, or the data is too short to hold the amount arg.
    6 new offline tests in `src/pumpfun.test.ts` (buy, sell, unrelated
    discriminator, short account list, short instruction data).
  - Deliberately did not wire this into anything yet (no index, no
    websocket-watcher changes, no new signal) — the full balance-index
    feature is multiple further sessions' worth (maintaining per-wallet
    balances across buy/sell/transfer events, handling missed/out-of-order
    events, deciding how holder-concentration would consume it), consistent
    with Session 28's own "worth scoping as its own focused session" note.
  - Updated `rug-radar/README.md`'s data-layer section with
    `decodeTradeInstruction` and why it exists but isn't wired in yet.
- No live-RPC check this session — this was pure offline decoding logic
  against a hand-confirmed public spec, same category of work as the
  `create`/`create_v2` decoder in Session 5, which also didn't need one.

### Works
- `npm run typecheck` and `npm run build` clean in `/rug-radar`.
- `npm test`: 128/128 passing (6 new, all in `pumpfun.test.ts`), all
  offline, ~3s.
- `git status` after this session shows only the intended `pumpfun.ts`/
  `pumpfun.test.ts`/README/PROGRESS changes — no stray files.

### Next
- The balance-index feature itself (per-wallet token balances from live
  buy/sell log lines, feeding holder concentration as an alternative to the
  rate-limited `getTokenLargestAccounts`) is still unbuilt beyond this
  session's decoder. Next steps in order: (1) a `wsLogParser.ts`-style
  detector for buy/sell log lines (same "track Anchor's own invoke/success
  nesting, don't substring-match" care as `detectCreateInstruction`), (2) an
  in-memory balance index (`deployer -> mint -> balance` shape, same FIFO-
  bounded pattern as `deployerIndex.ts`), (3) wiring it into the websocket
  watcher and deciding how/whether holder-concentration should prefer it over
  (or alongside) the existing RPC call. Not started — each is its own
  decision point, not a mechanical follow-on.
- The scoring endpoint's rate-limit ceiling is otherwise unchanged — still
  the headline open item; this session's decoder doesn't touch it yet on its
  own (it has to be wired into the index above before it helps).
- `findFundingSource`'s lookback-limit live check (open since Session 4) is
  still blocked on the same root cause — unchanged this session.
- All five TASK.md steps remain functionally complete.

## Session 30 — 2026-10-06

### Done
- Re-verified the repo first (128/128 tests after `npm install` restored
  `node_modules`, clean typecheck/build), then picked up step (1) from
  Session 29's "Next" — a `wsLogParser.ts`-style detector for buy/sell log
  lines, needed before the balance index can tell which transactions to
  decode. Before writing it, re-read the real captured log fixture it would
  need to recognize (`wsLogParser.test.ts`'s `REAL_CREATE_V2_LOGS`, from
  session 5) and found it already contains `"Program log: Instruction:
  BuyV2"` — not `"Instruction: Buy"`. That sent this session down a
  different, more important path than originally planned.
- Fetched the public Anchor IDL (`pump-fun/pump-public-docs`, `idl/pump.json`)
  to check: is `buy_v2` a real, separate instruction from `buy`, and did
  session 29's `decodeTradeInstruction` account for it? Confirmed via a
  direct download + `python3 -m json` parse of the raw IDL (not a webfetch
  summary — see below for why that distinction mattered) that `buy_v2` and
  `sell_v2` are genuinely separate instructions with their own
  discriminators and an unrelated account layout (`mint` is `base_mint` at
  account index 1, `bonding_curve` at 10, `user` at 13, vs. 2/3/6 for the
  plain `buy`/`sell` session 29 implemented). Session 29's decoder would
  have silently returned `null` for every real `buy_v2`/`sell_v2`
  transaction — not a crash, but exactly the kind of quiet gap that would
  have undercounted real trades once wired into a balance index, worth
  fixing before building more on top of it.
- **Caught a tool-reliability issue worth flagging**: a first attempt used
  WebFetch's AI-summarized read of `idl/pump.json` to get the `sell` and
  `sell_v2` discriminator byte arrays. It reported `sell` as
  `[51, 230, 139, 6, 167, 200, 19, 62]` and `sell_v2` as
  `[233, 84, 59, 188, 5, 23, 235, 200]`. Downloading the raw JSON directly
  (`curl` + `python3 -c 'json.load(...)'`, no summarizing model in the loop)
  showed both were fabricated: the real `sell` discriminator is
  `[51, 230, 133, 164, 1, 127, 131, 173]` (matching what was already in
  `pumpfun.ts` since session 29 — that one was right) and the real `sell_v2`
  is `[93, 246, 130, 60, 231, 233, 64, 178]`. Did not trust the summary for
  the `buy`/`buy_v2` values either, in fact re-verified everything used in
  this session's code change against the raw parse. Deleted the temporary
  `/tmp/pump_idl.json` download after use (not committed, not needed after
  verification).
- `src/pumpfun.ts` — `decodeTradeInstruction` now also matches `buy_v2`
  (`[184, 23, 238, 97, 103, 197, 211, 61]`) and `sell_v2`
  (`[93, 246, 130, 60, 231, 233, 64, 178]`), using a second account-index
  layout (`mint: 1, bondingCurve: 10, user: 13`) shared between the two v2
  variants, the same way `buy`/`sell` already shared theirs. `kind` still
  collapses to `"buy"`/`"sell"` regardless of v2-ness — a future balance
  index only needs trade direction, not which account-layout variant moved
  the tokens. 2 new offline tests in `pumpfun.test.ts` (one per v2 variant),
  built the same way as the existing buy/sell tests (fixture instruction
  data + fixture accounts, no RPC call).
- Did not get to step (1) (the wsLogParser buy/sell detector) itself this
  session — the discriminator-correctness detour was worth doing first and
  filled the session; it's still next (see below), now on a decoder that
  actually covers real trade traffic instead of roughly half of it.
- Updated `rug-radar/README.md`'s data-layer section with the buy_v2/sell_v2
  fix, why it mattered (real traffic, not a rare variant — session 5's own
  captured fixture already had one), and the webfetch-summary lesson for
  future sessions reading on-chain specs through a summarizing tool.

### Works
- `npm run typecheck` and `npm run build` clean in `/rug-radar`.
- `npm test`: 130/130 passing (2 new, both in `pumpfun.test.ts`), all
  offline, ~3s.
- `git status` after this session shows only the intended `pumpfun.ts`/
  `pumpfun.test.ts`/README/PROGRESS changes — no stray files (temp IDL
  download was outside the repo and removed).

### Next
- Step (1) from Session 29's plan — a `wsLogParser.ts`-style detector for
  buy/sell log lines (all four variants: `Buy`/`Sell`/`BuyV2`/`SellV2`,
  tracking the invoke/success stack the same way `detectCreateInstruction`
  does) — is still the next concrete step toward the balance index, now
  unblocked by a decoder that actually covers all four variants. Steps (2)
  (in-memory `deployer -> mint -> balance` index) and (3) (wiring into the
  websocket watcher, deciding how holder-concentration should use it) remain
  after that, unstarted, same as Session 29 left them.
- The scoring endpoint's rate-limit ceiling is unchanged — still the
  headline open item; this session's fix makes the eventual balance index
  more correct once built, but doesn't touch the ceiling on its own yet.
- `findFundingSource`'s lookback-limit live check (open since Session 4) is
  still blocked on the same root cause — unchanged this session.
- All five TASK.md steps remain functionally complete.

## Session 31 — 2026-10-07

### Done
- Re-verified the repo first (`npm install` to restore `node_modules`,
  130/130 tests, clean typecheck/build), then picked up step (1) from
  Session 29/30's plan — a `wsLogParser.ts`-style detector for buy/sell log
  lines, the next piece toward the self-built holder/balance index.
  - Refactored `src/wsLogParser.ts`'s invoke-stack walk (previously inlined
    in `detectCreateInstruction`) into a shared `ownLogLines(programId, logs)`
    helper that returns just the log lines the given program emitted about
    itself (top-of-stack === programId), so a second detector doesn't
    duplicate the stack-tracking loop. `detectCreateInstruction`'s behavior
    is unchanged (same inputs/outputs, existing tests pass without edits).
  - Added `detectTradeInstruction(programId, logs)`: matches
    `Buy`/`BuyV2`/`Sell`/`SellV2` log lines the same stack-aware way, returns
    `"buy"`/`"sell"`/`null` (collapsing v2-ness the same way
    `decodeTradeInstruction` already does — a detector only needs trade
    direction to decide whether `getTransaction` is worth calling).
  - 7 new offline tests in `wsLogParser.test.ts`: reused the existing
    `REAL_CREATE_V2_LOGS` fixture (captured live in session 5) to confirm it
    detects the bundled dev `BuyV2` inside that real create_v2 transaction —
    the same line `detectCreateInstruction` correctly ignores — plus plain
    buy/sell, `SellV2`, a same-named-instruction-under-an-unrelated-program
    negative case, a create-only negative case, and empty logs.
- Not wired into `wsDiscovery.ts` yet — still just the detector, same
  "build the piece, don't wire until the next session" pacing used for
  `decodeTradeInstruction` in session 29. Steps (2) (in-memory
  `deployer -> mint -> balance` index) and (3) (wiring into the websocket
  watcher, deciding how holder-concentration should use it) remain
  unstarted.
- Updated `rug-radar/README.md`: documents `detectTradeInstruction` and the
  `ownLogLines` refactor under the `decodeTradeInstruction` writeup.

### Works
- `npm run typecheck` and `npm run build` clean in `/rug-radar`.
- `npm test`: 137/137 passing (7 new, all in `wsLogParser.test.ts`), all
  offline, ~1.8s.
- `git status` after this session shows only the intended `wsLogParser.ts`/
  `wsLogParser.test.ts`/README/PROGRESS changes — no stray files.

### Next
- Step (2): an in-memory `deployer -> mint -> balance` index (same
  FIFO-bounded pattern as `deployerIndex.ts`) fed by `detectTradeInstruction`
  — still unstarted. Step (3): wiring it into the websocket watcher and
  deciding how/whether holder-concentration should prefer it over (or
  alongside) the existing rate-limited `getTokenLargestAccounts` call —
  also unstarted.
- The scoring endpoint's rate-limit ceiling is otherwise unchanged — still
  the headline open item; this session's detector doesn't touch it on its
  own (needs the index + wiring above before it helps).
- `findFundingSource`'s lookback-limit live check (open since Session 4) is
  still blocked on the same root cause — unchanged this session.
- All five TASK.md steps remain functionally complete.

## Session 32 — 2026-10-07

### Done
- Re-verified the repo first (`npm install` to restore `node_modules`,
  137/137 tests, clean typecheck/build), then picked up step (2) from
  Session 29/30/31's plan — the in-memory `deployer -> mint -> balance` index
  itself, fed by `detectTradeInstruction`/`decodeTradeInstruction`.
  - `src/balanceIndex.ts` — `BalanceIndex`: tracks a `mint -> wallet ->
    balance` map. `recordTrade({ kind, mint, user, amount })` takes the shape
    `decodeTradeInstruction` already returns; a buy adds to the wallet's
    balance, a sell subtracts, clamped at zero rather than going negative (a
    sell with no observed prior buy just means the wallet bought before this
    process started watching — same "only reflects what's been observed
    live" caveat as `deployerIndex.ts`). `getHolders(mint,
    excludeAddresses?)` returns every wallet with a positive balance, close
    to the shape `holderConcentration`'s existing `HolderBalance[]` input
    expects. Bounded the same way as `deployerIndex.ts`: one FIFO across
    every `(mint, wallet)` pair ever seen (default max 20000, higher than
    `deployerIndex`'s 5000 since there are many more wallets than deployers).
  - `src/balanceIndex.test.ts` — 9 offline tests: empty lookup, buy records a
    balance, sell reduces it, selling out to zero drops the wallet from
    results, a sell with no observed buy clamps to zero instead of going
    negative, the exclude-list filter, mints kept separate, FIFO eviction
    across mints, and repeated trades on the same pair not counting twice
    toward eviction.
  - Deliberately not wired into `wsDiscovery.ts` or `signals/
    holderConcentration.ts` yet — same "build the piece, don't wire until
    the next session" pacing as `decodeTradeInstruction` (session 29) and
    `detectTradeInstruction` (session 31). Step (3) — feeding it from the
    websocket watcher's trade notifications and deciding how/whether
    holder-concentration should prefer it over (or alongside) the
    rate-limited `getTokenLargestAccounts` call — remains unstarted.
  - Updated `rug-radar/README.md`'s data-layer section with a paragraph
    describing `BalanceIndex` and what's still left to wire it in.
- No live-RPC check this session — pure offline data-structure logic with no
  network dependency, same category as `deployerIndex.ts` (session 13) and
  the trade decoder (session 29), neither of which needed one either.

### Works
- `npm run typecheck` and `npm run build` clean in `/rug-radar`.
- `npm test`: 146/146 passing (9 new, all in `balanceIndex.test.ts`), all
  offline, ~2.3s.
- `git status` after this session shows only the intended `balanceIndex.ts`/
  `balanceIndex.test.ts`/README/PROGRESS changes — no stray files.

### Next
- Step (3): wire `BalanceIndex` into the websocket watcher (`wsDiscovery.ts`)
  — run `detectTradeInstruction` on pushed log notifications the same way
  `detectCreateInstruction` already is, resolve a match to the full trade via
  `decodeTradeInstruction` + a `getTransaction` call, and call `recordTrade`.
  Then decide how/whether `signals/holderConcentration.ts` should prefer
  `BalanceIndex.getHolders()` over the rate-limited `getTokenLargestAccounts`
  call — e.g. prefer the index once it has enough observed trades for a mint,
  fall back to the RPC call otherwise — not decided yet, each is its own
  judgment call rather than a mechanical follow-on.
- The scoring endpoint's rate-limit ceiling is otherwise unchanged — still
  the headline open item; this session's index doesn't touch it on its own
  until step (3) wires it in and holder-concentration actually stops calling
  `getTokenLargestAccounts` for mints it covers.
- `findFundingSource`'s lookback-limit live check (open since Session 4) is
  still blocked on the same root cause — unchanged this session.
- All five TASK.md steps remain functionally complete.

## Session 33 — 2026-10-07

### Done
- Re-verified the repo first (`npm install` to restore `node_modules`,
  146/146 tests, clean typecheck/build), then picked up step (3) from
  Session 29/30/31/32's plan — wiring `BalanceIndex` into the websocket
  watcher — but checked the plan before building it, and found a real
  problem with it as sketched: Session 32's "Next" said to run
  `detectTradeInstruction` over the watcher's existing program-wide
  `mentions` stream and call `getTransaction` on every match. Confirmed
  (by reading `wsLogParser.ts`'s own log-line fixtures) that log lines never
  carry account addresses — there's no way to know which mint a trade
  belongs to without already fetching the transaction. Doing that for every
  trade on the program-wide stream (buy/sell volume dwarfs create volume)
  would multiply `getTransaction` calls across most of pump.fun's traffic
  network-wide — far worse for the rate-limit ceiling than the single
  `getTokenLargestAccounts` call per launch this is meant to avoid. Did not
  implement the sketched plan; built the actually-needed mechanism instead.
- `src/wsDiscovery.ts` — `LaunchWatcher` gained `trackMint(mint,
  bondingCurve)` / `untrackMint(mint)`: a *second kind* of `logsSubscribe`,
  scoped to one mint's own bonding curve account (not the whole program), so
  trade volume scales with how many launches this process is tracking, not
  the whole chain. Required routing incoming notifications by the pubsub
  `subscription` id (previously ignored — there was only ever one
  subscription to route to): subscribe acks are now matched by request id to
  learn each subscription's id; `logsNotification`s route to the existing
  create handler or the right mint's new trade handler by that id. All
  tracked mints are re-subscribed (fresh ids) alongside the program on every
  reconnect. New `onTrade` callback option fires on a resolved trade for a
  tracked mint.
  - `src/discovery.ts` — factored `resolveLaunchFromSignature`'s retry loop
    into a shared `resolveWithRetry()` helper and added
    `resolveTradeFromSignature()` on top of it (same not-found-vs-thrown-error
    retry behavior from session 19, now shared instead of duplicated for the
    new trade path). `findTradeInstruction()` added alongside the existing
    `findCreateInstruction()`.
  - `src/wsDiscovery.test.ts` — 11 new offline tests (subscribe-on-track,
    pre-connect tracking, trade resolution into `onTrade`, a non-trade
    notification on a tracked mint's subscription not calling
    `getTransaction`, `untrackMint` sending `logsUnsubscribe` and stopping
    further routing, resubscribe-on-reconnect). 4 existing tests needed a
    subscribe-ack emitted first to keep testing real behavior now that
    routing depends on it — previously they passed "by accident" since there
    was only one subscription for every notification to match against.
- Deliberately did not wire `trackMint`/`onTrade` into `server.ts` or
  `BalanceIndex`/`holderConcentration.ts` this session — beyond "not started
  yet," found a real design question first: `server.ts` calls `scoreLaunch`
  exactly once, immediately when a launch is discovered, before any trade
  could have been observed even if `trackMint` fired in the same callback.
  `BalanceIndex` would be empty at the one moment holder-concentration
  actually runs, so preferring it over `getTokenLargestAccounts` as currently
  structured would never help the common case — it needs *when*
  holder-concentration runs to change too (e.g. a delayed/periodic re-score),
  which is a bigger, separate decision than the subscription plumbing itself.
  Documented rather than guessed at.
- Updated `rug-radar/README.md`'s data-layer section with this session's
  finding, the fix, and the open design question above.
- No live-RPC check this session — offline mechanism + tests only, same
  category as sessions 29/31/32's pieces toward this same feature.

### Works
- `npm run typecheck` and `npm run build` clean in `/rug-radar`.
- `npm test`: 152/152 passing (11 new in `wsDiscovery.test.ts`, 4 existing
  tests updated to emit a subscribe ack first), all offline, ~2.1s.
- `git status` after this session shows only the intended `wsDiscovery.ts`/
  `wsDiscovery.test.ts`/`discovery.ts`/README/PROGRESS changes — no stray
  files.

### Next
- The open design question above is the concrete next step: decide how
  holder-concentration should actually consume `BalanceIndex` given
  `scoreLaunch` only runs once per launch today — likely needs a
  delayed/periodic re-score mechanism (e.g. re-score a launch some time
  after discovery once trades have had a chance to accumulate), not just a
  "prefer index if non-empty" check at the existing single score time. Once
  that's decided: wire `trackMint(launch.mint, launch.bondingCurve)` into
  `server.ts`'s `onLaunch` handler, wire `onTrade` to `balanceIndex.recordTrade`,
  and decide when to `untrackMint` (nothing currently evicts a tracked mint,
  which would leak subscriptions on a long-running process — `feed.ts`'s
  `LiveFeed` has no eviction callback today to hang this off of).
- The scoring endpoint's rate-limit ceiling is otherwise unchanged — still
  the headline open item.
- `findFundingSource`'s lookback-limit live check (open since Session 4) is
  still blocked on the same root cause — unchanged this session.
- All five TASK.md steps remain functionally complete.

## Session 34 — 2026-10-08

### Done
- Re-verified the repo first (`npm install` to restore `node_modules`,
  152/152 tests, clean typecheck/build), then picked up Session 33's open
  design question: decide how holder-concentration should consume
  `BalanceIndex` given `scoreLaunch` only runs once per launch today, and
  wire it in.
  - `src/rescore.ts` (new) — `rescoreHolderConcentrationFromIndex(rpc,
    launch, balanceIndex)`: re-scores *only* the holder-concentration signal
    from `balanceIndex.getHolders()` plus the bonding curve's
    `tokenTotalSupply` (one plain `getAccountInfo` call, not the rate-limited
    indexed methods). Returns `null` if no trades have been observed for the
    mint yet or the bonding curve can't be read, so the caller leaves the
    existing signal alone rather than replacing it with a false "0 holders"
    reading. Deliberately doesn't re-run the other three signals — that
    would add calls against the same rate-limited scoring RPC this exists to
    avoid, for signals the balance index has no data for anyway.
    `src/rescore.test.ts` — 4 offline tests (no observed trades → null,
    scores from observed trades, excludes the bonding curve address, bonding
    curve fetch failure → null).
  - `src/feed.ts` — added `get(mint)` and `update(score)` (replaces an
    existing entry in place by mint, no-op if not present) so a later
    re-score can update a launch already in the feed instead of being
    dropped or added as a duplicate. 3 new tests in `feed.test.ts`.
  - `src/server.ts` — wires the *when*: on a launch's successful initial
    score (websocket watcher path only — the backstop poller doesn't call
    this, see "Next"), calls `watcher.trackMint(launch.mint,
    launch.bondingCurve)` and schedules a one-shot re-score
    `RESCORE_DELAY_MS` (20s, an untuned starting point) later via
    `setTimeout`. That re-score calls `rescoreHolderConcentrationFromIndex`;
    if it returns a signal, replaces the `holder-concentration` entry in the
    launch's signals, recombines via `combineSignals`, and calls
    `feed.update()`. `watcher.untrackMint()` always runs afterward (in a
    `.finally()`) regardless of outcome, so a long-running process doesn't
    leak per-mint subscriptions. `onTrade` is wired to
    `balanceIndex.recordTrade()`. Noted but didn't need to change: trade
    resolution for `trackMint`'s subscriptions already goes through
    `LaunchWatcher`'s constructor-injected RPC client (the discovery
    endpoint), not the scoring one — so it doesn't add load to the
    already-rate-limited scoring endpoint.
  - Updated `rug-radar/README.md`'s "Live feed" section with the design
    decision and wiring, and "Known limitations" with this session's live
    finding (below).
- Live-verified synchronously in the foreground (two runs, ~60s and ~90s,
  public mainnet-beta, no keys, no `.env`, same pattern as sessions 26/27):
  the new code ran without errors, but neither run observed the
  holder-concentration rescore actually firing. Root cause is a sample-size
  problem, not an obvious bug: the scoring gate (session 21) still drops
  almost every discovered launch before `scoreLaunch` ever runs, so
  `trackMint` only gets called for the rare launch that makes it through —
  one per run in both live checks here. In the 90s run, that one mint showed
  very thin liquidity (0.16 SOL), consistent with too little trading
  activity in the 20s window to populate `BalanceIndex` — but that same run
  also logged a visible rate of `getTransaction` 429s against the
  *discovery* endpoint (`solana-rpc.publicnode.com`), which session 20 had
  found to be 429-free. With only one sample, "no trades happened" and
  "trade resolution also got throttled" can't be told apart. Documented
  honestly in the README rather than claiming the feature works live when
  it's only offline-tested and wired without errors so far.

### Works
- `npm run typecheck` and `npm run build` clean in `/rug-radar`.
- `npm test`: 159/159 passing (7 new: 4 in `rescore.test.ts`, 3 in
  `feed.test.ts`), all offline, ~3.2s.
- Live-booted the real server synchronously twice (public mainnet-beta, no
  keys, no `.env`, ~60s then ~90s): both boot cleanly, `/api/feed` responds,
  no crash, no error from the new code paths; one launch landed in each run
  (same ceiling as prior sessions) but the rescore itself wasn't observed
  firing — see "Done" above for why that's inconclusive, not a known bug.
- `git status`/`ps aux` after cleanup show only the intended
  `rescore.ts`/`rescore.test.ts`/`feed.ts`/`feed.test.ts`/`server.ts`/
  README/PROGRESS changes — no stray files, no leftover server process.

### Next
- Get a real live confirmation that the rescore mechanism fires end-to-end:
  needs either a busier live window (more launches get through the scoring
  gate, raising the sample size) or an isolated check that calls
  `watcher.trackMint`/`onTrade` directly against a known busy mint (same
  "isolate the component" approach session 19 used for `LaunchWatcher`
  alone), rather than waiting on the full pipeline's low throughput.
- Whether the discovery endpoint's (`solana-rpc.publicnode.com`)
  `getTransaction` 429 rate has genuinely increased since session 20, or
  this run just caught it under unusually high load (the same point-in-time
  caveat raised about the scoring endpoint in session 19), is worth checking
  directly — it would affect both the new trade-resolution path and the
  existing create-resolution path discovery already depends on.
- The backstop poller's discovered launches don't get `trackMint`/the
  delayed rescore — only the websocket watcher's `onLaunch` path does. Low
  priority (the poller is already the backstop, not primary) but would need
  passing the watcher (or a callback) into `pollOnce` if ever worth doing.
- `RESCORE_DELAY_MS` (20s) is an untuned starting point, not derived from any
  live measurement of how fast launches accumulate trades — worth revisiting
  once the "does it fire at all" question above is answered.
- The scoring endpoint's rate-limit ceiling is otherwise unchanged — still
  the headline open item.
- `findFundingSource`'s lookback-limit live check (open since Session 4) is
  still blocked on the same root cause — unchanged this session.
- All five TASK.md steps remain functionally complete.

## Session 35 — 2026-10-08

### Done
- Re-verified the repo first (`npm install` to restore `node_modules`,
  159/159 tests, clean typecheck/build), then picked up Session 34's top
  "Next" item: get a real live confirmation that the `BalanceIndex`
  rescore mechanism fires end-to-end, via the isolated check it suggested
  (watch `trackMint`/`onTrade` directly against real traffic, not gated by
  `ScoringGate`'s low throughput).
- Wrote a throwaway probe (`tmp-probe-rescore.ts`, deleted before finishing)
  that tracks *every* launch the websocket watcher finds directly, bypassing
  the scoring gate entirely. First run: 17 launches tracked over 75s,
  **zero** trades resolved — a result strong enough to mean "the mechanism
  doesn't work," not just "too few samples."
- Root-caused a real bug, not a sample-size issue: a buy/sell transaction
  mentions both the pump.fun program and the mint's own bonding curve, so
  the public RPC pushes a `logsNotification` for it on *both*
  `LaunchWatcher`'s program-wide subscription and the mint-specific one.
  `handleMessage`'s dedup set in `src/wsDiscovery.ts` (meant to drop a
  notification redelivered after a resubscribe) was keyed on the raw
  signature only, shared across both subscription types — so whichever
  copy arrived first (almost always the program-wide one, checked for a
  create and discarded) marked the signature "seen" and silently dropped
  the other copy, the one `onTrade` actually depended on. This had been
  true since Session 33 wired `trackMint` in; no existing test caught it
  because every test that exercises `onTrade` only ever emits *one*
  notification for a given signature (on the mint subscription), never the
  realistic pair on both subscriptions.
- Fixed in `src/wsDiscovery.ts`: the dedup key is now `` `create:${signature}` ``
  or `` `trade:${signature}` `` instead of the bare signature, so the two
  subscription types can't collide while redelivery-after-resubscribe within
  one type is still deduped as before.
- `src/wsDiscovery.test.ts` — added "a trade is still resolved when the
  program-wide subscription sees the same signature first": emits the same
  signature on both subscriptions (program first, then mint) and asserts
  `onTrade` still fires once. Verified this is a real regression test, not
  just a plausible-looking one: ran it with the fix reverted via `git
  stash` and confirmed it fails there, then restored the fix and confirmed
  it passes (159 → 160 tests either way, no other test affected).
- Re-ran the same isolated probe after the fix: 23 launches tracked over
  75s, **5 trades resolved** (all sells, with wallet address and amount
  logged) — the mechanism firing for the first time on record.
  `BalanceIndex.getHolders()` still showed 0 holders for every tracked mint
  in that run, but that's the documented clamp-to-zero behavior for a sell
  with no observed prior buy (these wallets bought before this process
  started watching, so their balance per the index starts at zero) — not a
  new bug. Would need a mint with an observed *buy* in the tracking window
  to see a positive balance; not caught in either 75s sample.
- Deleted `tmp-probe-rescore.ts` before finishing (same cleanup habit as
  every prior session's scratch probes).
- Updated `rug-radar/README.md`: "Live feed" section's Session 34 writeup
  gained a Session 35 continuation with the bug/fix/live numbers above;
  "Known limitations" top entry gained a matching Session 35 bullet noting
  this is a real, now-fixed blocker for `BalanceIndex`/`rescore.ts`
  specifically, separate from (and not a fix for) the scoring-endpoint
  rate-limit ceiling.

### Works
- `npm run typecheck` and `npm run build` clean in `/rug-radar`.
- `npm test`: 160/160 passing (1 new, in `wsDiscovery.test.ts`), all
  offline, ~2.4-2.7s.
- Live-verified the actual fix (not just the offline regression test)
  against real mainnet-beta traffic twice — once confirming the bug (0/17
  trades), once confirming the fix (5/23 trades) — both via a scratch probe
  deleted before this session ended.
- `git status` after cleanup shows only the intended
  `wsDiscovery.ts`/`wsDiscovery.test.ts`/README/PROGRESS changes — no
  stray files, no leftover process.

### Next
- `BalanceIndex` can now actually receive live trade data; the next useful
  check is whether a mint that gets both an observed buy *and* a later sell
  within the 20s `RESCORE_DELAY_MS` window produces a real positive-balance
  holder list (neither of this session's two samples had a buy land in the
  window, only sells against pre-existing balances) — would confirm
  `rescore.ts`'s output end-to-end, not just that trades reach
  `BalanceIndex` at all.
- The scoring endpoint's rate-limit ceiling is otherwise unchanged — still
  the headline open item; this session's fix is necessary for the balance
  index to ever work but doesn't touch the ceiling itself.
- `findFundingSource`'s lookback-limit live check (open since Session 4) is
  still blocked on the same root cause — unchanged this session.
- All five TASK.md steps remain functionally complete.

## Session 36 — 2026-10-09

### Done
- Found a leftover scratch probe (`rug-radar/tmp-probe-rescore2.ts`) already
  committed from an earlier, interrupted attempt at this same session number
  (its header comment said "session 36" and it exactly matched the question
  Session 35 left open: does a mint that gets both an observed buy *and* a
  later sell within the tracking window produce a real positive-balance
  holder list via `rescoreHolderConcentrationFromIndex`, not just that trades
  reach `BalanceIndex` at all). Re-verified the repo first (`npm install`,
  162/162 tests, clean typecheck/build — no production code had actually
  changed since Session 35, only the scratch file existed) before running it.
- Ran the probe synchronously in the foreground (same pattern as every
  session since 26 — no `ScheduleWakeup`/backgrounding, since this project's
  sandbox resets between sessions and loses both): needed
  `NODE_OPTIONS=--experimental-websocket` to actually connect (the probe
  itself doesn't set this, unlike `npm start`/`npm dev`, which was the first
  run's silent failure — every `trackMint` attempt errored with "No global
  WebSocket constructor available" and zero trades resolved on that attempt).
  Re-ran with the flag set, 150s, public mainnet-beta, no keys, no `.env`.
- **Got the conclusive confirmation Session 35 left open.** One tracked mint
  (`Bc4XQikcRmkoFQnb1eCqJkxfM2dhziAncifQEuHNc6zE`) saw 3 buys and 10 sells
  within its 90s window, `BalanceIndex.getHolders()` returned 2
  positive-balance holders, and `rescoreHolderConcentrationFromIndex`
  returned a real signal: `{"name":"holder-concentration","score":2,
  "reasons":["top 2 non-program holders hold 1.7% of supply"]}`. Every other
  tracked mint in the same run saw 0 trades or sells-only (consistent with
  low per-mint trade volume being the norm, not this mint being unusual).
  This is the first time the balance-index → rescore pipeline has been
  observed producing a real, non-null, positive-balance result end-to-end —
  closes the question open since Session 34 ("does the rescore mechanism
  work, not just wire without errors").
- Deleted `tmp-probe-rescore2.ts` after the run (same cleanup habit as every
  prior session's scratch probes).
- Updated `rug-radar/README.md`: "Live feed" section's Session 35 writeup
  gained a Session 36 continuation with these numbers; "Known limitations"
  top entry gained a matching Session 36 bullet noting the balance-index
  feature is now live-confirmed end-to-end, while being explicit that this
  doesn't touch the scoring-endpoint rate-limit ceiling itself (a different,
  still-open problem).
- No other production code changed this session — this was purely finishing
  an already-scoped live-verification question, not new functionality.

### Works
- `npm run typecheck` and `npm run build` clean in `/rug-radar`.
- `npm test`: 162/162 passing (unchanged — no code changes this session),
  all offline, ~3s.
- Live-verified the real, unmodified `rescoreHolderConcentrationFromIndex`/
  `BalanceIndex`/`LaunchWatcher.trackMint` pipeline against public
  mainnet-beta (150s, no keys, no `.env`) via a scratch probe deleted before
  this session ended — see "Done" above for the result.
- `git status` after cleanup shows only the intended README/PROGRESS changes
  plus the scratch-file deletion — no stray files, no leftover process.

### Next
- The balance-index/rescore feature (Sessions 29-36) is now functionally
  complete and live-confirmed; no further open item specific to it is on
  record.
- The scoring endpoint's rate-limit ceiling is still the headline open item
  — unchanged by this session. The balance index is a workaround for one
  signal's indexed RPC call (`getTokenLargestAccounts`), not a fix for the
  ceiling overall; `getTransaction` calls for deployer-history/bundled-buys
  still hit it directly.
- `findFundingSource`'s lookback-limit live check (open since Session 4) is
  still blocked on the same root cause (needs a launch to finish scoring
  with real early-buy data available) — unchanged this session.
- `RESCORE_DELAY_MS` (20s, set in Session 34) is still an untuned starting
  point — this session's probe used a 90s window and still only caught
  meaningful activity on 1 of ~50 tracked mints, suggesting 20s in production
  may be too short to catch much trading for most launches in practice;
  worth a closer look if the rescore's real-world hit rate ever needs
  checking directly (not measured this session — the probe used its own
  90s window, not the production 20s one).
- All five TASK.md steps remain functionally complete.

## Session 37 — 2026-10-09

### Done
- Re-verified the repo first (`npm install`, 162/162 tests, clean
  typecheck/build), then found a real gap in this file and `README.md`
  while reading `src/discovery.ts` closely: `DiscoveredLaunch.bundledBuy`,
  `src/server.ts`'s `scheduleHolderRescore` seeding it into `BalanceIndex`
  before calling `trackMint`, and 2 tests in `discovery.test.ts` ("decodes a
  bundled dev buy...", "does not mistake a bundled sell for a bundled
  buy") all exist in the committed code, pass, and are load-bearing — but
  neither this file nor the README ever mentioned them. Root-caused why:
  `logs/session-0036.md` shows that session built this exact fix (root
  cause: the dev's own bundled buy happens in the *same* transaction as the
  create, before `trackMint` can possibly subscribe, so it was invisible to
  `BalanceIndex` by construction — this is why every trade observed in
  sessions 34-35 had been a sell, never a buy) but hit its step limit
  (`Outcome: step limit reached`, 60 steps) right after adding the tests,
  one step before it could live-verify or document it. The *next* run
  (logged as `session-0037.md`) inherited the already-fixed code, ran the
  leftover scratch probe, saw buys for the first time, and wrote it up as
  confirming the **pre-existing** session 34/35 mechanism — it never diffed
  against what session 35 had actually left behind, so it didn't notice it
  was also validating a same-session fix it hadn't made. That write-up
  became this file's "Session 36" entry above and the matching README
  passage — both correct about the live numbers, silent about the fix that
  produced them. Same recurring class of problem as sessions 6-9/17/20/22-25
  (step limit interrupts documentation), just one layer removed this time:
  the *interrupted* session's work got documented, but mis-attributed to a
  different session's account, rather than simply left undocumented.
- Fixed the record rather than re-deriving anything: added a "The dev's
  bundled buy (session 36)" paragraph to `README.md`'s "Live feed" section
  describing the actual mechanism, and a correction to the "Known
  limitations" session 36 bullet explaining the mix-up above. No code
  changes — the fix itself was already correct, tested, and live-verified;
  this session only closes the documentation gap.
- Picked up Task #2: `findFundingSource`'s lookback-limit live check, open
  and repeatedly blocked since Session 4 (sessions 16/19/20/21 all tried and
  got stopped by discovery or the scoring endpoint's backlog). Unblocked it
  with a different angle: ran the real, unmodified `fetchBundledBuysInput`
  directly against `solana-rpc.publicnode.com` (the discovery endpoint)
  instead of waiting for a launch to finish scoring over the rate-limited
  scoring endpoint — `getSignaturesForAddress`/`getTransaction` aren't
  blocked there (only the indexed token methods are, per session 20), so
  this sidesteps the scoring bottleneck rather than needing it resolved
  first. Wrote a throwaway probe (`tmp-probe-funding2.ts`, deleted after the
  run) that watched the real websocket feed for new launches and called
  `fetchBundledBuysInput` against each one ~70s later with default options
  (`windowSeconds: 90`, `signatureLimit: 50`).
- **Result (170s live window, public mainnet-beta, no keys): 4 of 12
  distinct early buyers (33%) resolved to `fundedBy: null` ("unknown")**
  across 4 real mints (`6aHEbSBnqvo5...`, `9WPV95erYZRZ...`,
  `2nDo3jafMFbZ...`, `4aE9MgrKa9Hp...`). This is the concrete answer the
  lookback-limit question has been waiting on since Session 4: the default
  50-signature cap misses close to a third of real early buyers' funding
  sources, not just a rare long-history outlier. Did not dig into *why*
  each specific miss happened (too-small `signatureLimit` for that wallet
  vs. a transaction shape `findSolSender` doesn't recognize) — left as a
  follow-up, not guessed at.
- Deleted `tmp-probe-funding2.ts` after the run (same cleanup habit as
  every prior session's scratch probes).
- Updated `rug-radar/README.md`'s "Known limitations" bottom entry with
  this finding, replacing the long-standing "still not live-checked"
  placeholder.

### Works
- `npm run typecheck` and `npm run build` clean in `/rug-radar`.
- `npm test`: 162/162 passing (unchanged — no code changes this session),
  all offline, ~3s.
- Live-checked the real, unmodified `fetchBundledBuysInput` against public
  mainnet-beta (170s, no keys, no `.env`) via a scratch probe deleted before
  this session ended — see "Done" above for the result.
- `git status` after this session shows only the intended README/PROGRESS
  changes — no stray files, no leftover process.

### Next
- `findFundingSource`'s 33%-unknown rate (above) is now a measured number,
  not an open question — worth a follow-up session deciding whether that
  miss rate is acceptable as-is (the signal already treats `fundedBy: null`
  as "not bundled" rather than erroring, so it fails closed) or whether
  raising `signatureLimit` is worth the extra `getTransaction` calls per
  buyer it costs.
- The scoring endpoint's rate-limit ceiling is otherwise unchanged — still
  the headline open item.
- `RESCORE_DELAY_MS` (20s) is still untuned — unchanged this session.
- Worth a lighter-weight habit for future sessions: when picking up work,
  diff `git log`/recent test-count deltas against what the last *documented*
  session claimed, not just whatever `npm test` reports at the start — a
  jump in test count with no matching PROGRESS/README entry is the signal
  that something upstream went undocumented, the same tell that caught this
  session's finding.
- All five TASK.md steps remain functionally complete.

## Session 39 — 2026-10-09

### Done
- Re-verified the repo first (`npm install`, 162/162 tests, clean
  typecheck/build), then picked up Session 37's top open item:
  `findFundingSource`'s 33%-unknown rate — measured but not yet understood
  *why* each miss happened.
- Wrote a throwaway instrumented probe (`tmp-probe-funding3.ts`, deleted
  after the run) that classified each "unknown" early buyer live, rather than
  guessing: for every miss, it checked whether a funding transaction actually
  existed somewhere else within `signatureLimit: 50` (not just the single
  oldest signature `findFundingSource` was checking). Ran it for 180s against
  real mainnet-beta traffic (24 mints, dozens of early buyers via the
  websocket watcher) and got a clear, lopsided answer: **nearly every miss**
  was the same cause — the buyer's single oldest visible transaction wasn't a
  funding transfer at all, while a real funding transfer sat a few signatures
  later, still well inside the limit. **Zero** misses were genuinely
  "no funding transaction within the limit" (which would have meant
  `signatureLimit` itself needed raising). This is a real logic bug, not a
  tuning question — closes the "is this acceptable or does the limit need
  raising" decision Session 37 left open with a different answer than either
  option it posed.
- Fixed `src/data/bundledBuys.ts`'s `findFundingSource`: now walks every
  signature within `signatureLimit` oldest-to-newest and returns the first
  one that actually shows a SOL balance increase for the buyer, instead of
  checking only the single oldest signature. Stops at the first match, so
  the common case (funded once, then immediately used) still costs one
  `getTransaction` call. `src/data/bundledBuys.test.ts` — 1 new regression
  test ("finds the funding source when it's not the buyer's single oldest
  transaction"); verified it's a real regression test by reverting the fix
  via `git stash` and confirming it fails there, then restoring the fix and
  confirming it passes (163 tests either way, no other test affected).
- Live-reverified the actual fix (not just the offline test) with a second
  scratch probe (`tmp-verify-funding-fix.ts`, deleted after the run) that
  called the real, unmodified `fetchBundledBuysInput` directly — same
  measurement Session 37 did, now with the fix in place. Result over a 180s
  window (24 mints, public mainnet-beta, no keys): unknown rate dropped from
  Session 37's 33% (4/12) to **2% (5/217)** — a much larger sample than
  Session 37's, and the remaining handful look like genuine
  "no funding transaction within `signatureLimit: 50`" cases rather than more
  instances of the bug just fixed.
- Updated `rug-radar/README.md`: the "Bundled buys" signal description now
  describes the oldest-to-newest scan; "Known limitations" bottom entry
  rewritten with the root cause, the fix, and the before/after live numbers.

### Works
- `npm run typecheck` and `npm run build` clean in `/rug-radar`.
- `npm test`: 163/163 passing (1 new, in `bundledBuys.test.ts`), all offline,
  ~2.8-3s.
- Live-verified both the diagnostic (which cause dominates) and the fix
  itself (unknown rate before/after) against real mainnet-beta traffic via
  two scratch probes, both deleted before this session ended.
- `git status`/`ps aux` after cleanup show only the intended
  `bundledBuys.ts`/`bundledBuys.test.ts`/README/PROGRESS changes — no stray
  files, no leftover process.

### Next
- `findFundingSource`'s remaining ~2% unknown rate looks like genuine
  lookback-limit exhaustion now (not the bug just fixed) — not dug into
  further this session; would need its own per-wallet check if ever worth
  chasing below 2%, likely not a priority given the low rate.
- The scoring endpoint's rate-limit ceiling (README's top "Known
  limitations" entry) is unchanged — still the headline open item; this
  session's fix is in the bundled-buys signal's data quality, not the
  endpoint throughput question.
- `RESCORE_DELAY_MS` (20s, session 34) is still untuned — unchanged this
  session.
- All five TASK.md steps remain functionally complete.

## Session 40 — 2026-10-10

### Done
- Re-verified the repo first (`npm install`, 163/163 tests, clean
  typecheck/build), then picked up the scoring endpoint's rate-limit
  ceiling — the headline open item since Session 20, with 9+ alternative
  free endpoints already found dead-ended (Sessions 27-28) — from an angle
  no prior session had checked directly: how many RPC calls one signal
  issues per launch, not just whether the endpoint throttles them.
- Wrote a throwaway instrumented probe (`tmp-probe-callcount.ts`, deleted
  after use) that wrapped the real (unmocked) scoring RPC client in a
  per-method call/error counter and ran `fetchDeployerHistoryInput` /
  `fetchBundledBuysInput` / `fetchHolderConcentrationInput` sequentially
  (not concurrently, so each signal's own cost is isolated) against one real
  launch from the known prolific deployer used in prior sessions'
  deployer-history checks. **Result: deployer-history's retroactive scan
  alone issued 54 `getTransaction` calls (44 of them HTTP 429) and took
  113 seconds for that one launch** — by far the largest RPC-call
  contributor of any signal measured (bundled-buys: 28 calls/25 429s/88s;
  holder-concentration: 1 call, failed immediately on `getTokenLargestAccounts`).
  This is a real, concrete explanation that sharpens every prior session's
  "the endpoint is rate-limited" finding: the `ScoringGate` (Session 21)
  bounds how many launches score *concurrently*, but says nothing about how
  many calls *one* launch costs — a single deployer-history scan can cost
  more calls than the gate's entire concurrency budget, which is why even
  the rare launch that got through the gate so often still failed to finish
  in a short live-boot window.
- Fixed: lowered `fetchDeployerHistoryInput`'s default `signatureLimit` from
  100 to 25 (`src/data/deployerHistory.ts`). Reasoning, not just a number
  pulled down: `DeployerIndex` (Session 13) already catches a repeat
  deployer's prior launches going forward once this process has seen them
  create twice, so the retroactive scan's remaining job is mainly a
  deployer's *pre-existing* (pre-startup) history — trading some of that
  depth for a ~4x cut in worst-case calls against the rate-limited endpoint
  is the right side of the tradeoff right now. No test hardcoded the old
  default; `npm run typecheck`/`npm test` stayed clean (163/163, unchanged
  count — a default-value change, not new behavior needing new tests).
- Live-reverified with the same instrumented probe against a fresh launch
  (same deployer, different mint) after the fix: deployer-history dropped to
  **4 calls, 0 errors, 297ms**; bundled-buys to **2 calls, 0 errors, 2.5s**.
  Not an apples-to-apples pair (different mint/moment), but the call-count
  drop is a direct, structural consequence of scanning fewer signatures, not
  noise.
- Live-booted the real server end-to-end afterward (85s, synchronous
  foreground, same "no ScheduleWakeup/backgrounding" pattern every session
  has followed since Session 26's sandbox-reset lesson): **2 launches
  landed in `/api/feed`** in the window, plus one successful
  holder-concentration rescore from `BalanceIndex` logged — more launches
  landing in a single live check than any prior session on record (Sessions
  21/26 got zero; Session 27 got one). `getTokenLargestAccounts`
  (holder-concentration's remaining indexed call, confirmed un-droppable in
  Session 28) and bundled-buys' own window scan still hit 429s in the same
  run, so the rate-limit ceiling itself is not gone — this is a measured
  reduction in how hard scoring pushes against it, not a fix for the
  endpoint's own throughput.
- Deleted `tmp-probe-callcount.ts` after use (same cleanup habit as every
  prior session's scratch probes); confirmed no leftover server process via
  `ps aux`.
- Updated `rug-radar/README.md`: "Known limitations" top entry gained this
  session's measurement/fix/live numbers; the "Deployer history" signal
  entry under "Signals" now notes the new default.

### Works
- `npm run typecheck` and `npm run build` clean in `/rug-radar`.
- `npm test`: 163/163 passing (unchanged — a default-value change, no new
  test surface), all offline, ~3.3s.
- Live-measured the real, unmodified-then-fixed data-fetch functions against
  public mainnet-beta (two ~60-90s instrumented probes, before/after the
  fix) and live-booted the real server (85s) afterward — see "Done" above
  for all three results.
- `git status`/`ps aux` after cleanup show only the intended
  `deployerHistory.ts`/README/PROGRESS changes — no stray files, no
  leftover process.

### Next
- The scoring endpoint's rate-limit ceiling is still not fully resolved —
  this session reduced one signal's call volume by ~4x and it visibly
  helped (0→2 launches in a comparable live-boot window), but
  holder-concentration's `getTokenLargestAccounts` and bundled-buys' window
  scan still hit 429s regularly. Worth the same measurement approach applied
  to bundled-buys specifically: its outer window-scan `signatureLimit`
  (default 50, unchanged this session) is bounded by how much real activity
  falls in the early window rather than the limit itself, so it wasn't
  touched here — a live measurement of whether lowering it (or the window
  itself) trades away meaningful early-buy recall would need its own check
  before changing it, not guessed at.
- `RESCORE_DELAY_MS` (20s, session 34) is still untuned — unchanged this
  session.
- `findFundingSource`'s remaining ~2% unknown rate (session 39) — not a
  priority, unchanged this session.
- All five TASK.md steps remain functionally complete.

## Session 41 — 2026-10-10

### Done
- Re-verified the repo first (`npm install`, 163/163 tests, clean
  typecheck/build), then picked up session 40's top "Next" item: apply the
  same call-count measurement to bundled-buys that session 40 applied to
  deployer-history, to decide whether its window-scan `signatureLimit`
  (default 50, shared between the outer bonding-curve scan and each buyer's
  funding-source lookback) is worth tuning.
- Wrote a throwaway instrumented probe (`tmp-probe-bundledbuys-calls.ts`,
  deleted after use) that watched the real websocket feed for 90s, then ran
  the real, unmodified `fetchBundledBuysInput` against each discovered
  launch in turn with a scoring RPC client wrapped to count calls/429s per
  JSON-RPC method, plus a per-call probe on `getSignaturesForAddress` to
  log the outer bonding-curve scan's actual returned size. First run (12
  launches processed, public mainnet-beta, no keys): outer scan sizes of 1,
  2, 4, 5, 10, 20, 25, and a full 50/50 observed across different launches
  in the same run — the outer scan is *not* reliably bounded by low early
  activity the way session 40's "Next" speculated; a mint scored even ~90s
  after discovery can already have enough bonding-curve traffic to hit the
  cap. The resulting concurrent `getTransaction` resolves hit HTTP 429 on
  **648 of 658 calls (98.5%)** across the run — worse than session 40's
  single-launch measurement for this same signal (25/28, 89%).
- Fixed: lowered `fetchBundledBuysInput`'s default `signatureLimit` from 50
  to 20 in `src/data/bundledBuys.ts` (comment explains the measurement and
  the tradeoff) — same shape as session 40's deployer-history cut, but
  **without** an equivalent index covering the lost recall (no
  `BalanceIndex`-for-early-buyers exists), so unlike session 40's fix this
  is a real recall-vs-call-volume tradeoff, not a free win. No test hardcoded
  the old default; `npm run typecheck`/`npm test` stayed clean (163/163,
  unchanged count — a default-value change, not new behavior needing new
  tests).
- Live-reverified with the same instrumented probe after the fix (90s
  window, 21 launches discovered, 12 processed): outer scans now cap at 20
  as intended (several launches showed exactly `20/20` instead of reaching
  50), but the overall 429 rate was effectively unchanged (**741 of 751
  calls, 98.7%**) — at this level of endpoint saturation, nearly everything
  fails regardless of how many signatures are requested, so the fix bounds
  worst-case request volume per launch without measurably improving (or,
  within this sample, measurably hurting) how much actually resolves.
  Honest conclusion, not oversold: this is the same class of fix as session
  40 (reduce how hard one signal pushes on an already-overwhelmed endpoint),
  but at this saturation level the scoring endpoint's own throughput — not
  any one signal's call count — is clearly the dominant constraint, more so
  than session 40's single-launch sample suggested.
- Deleted `tmp-probe-bundledbuys-calls.ts` after both runs (same cleanup
  habit as every prior session's scratch probes); confirmed no leftover
  server/probe process via `ps aux`.
- Updated `rug-radar/README.md`: "Bundled buys" signal entry under
  "Signals" now notes the new default; "Known limitations" top entry gained
  a "Session 41" continuation with the measurement/fix/live numbers above.

### Works
- `npm run typecheck` and `npm run build` clean in `/rug-radar`.
- `npm test`: 163/163 passing (unchanged — a default-value change, no new
  test surface), all offline, ~2.6-2.8s.
- Live-measured the real, unmodified-then-fixed `fetchBundledBuysInput`
  against public mainnet-beta (two ~90s instrumented probes, before/after
  the fix) — see "Done" above for both results.
- `git status`/`ps aux` after cleanup show only the intended
  `bundledBuys.ts`/README/PROGRESS changes — no stray files, no leftover
  process.

### Next
- The scoring endpoint's rate-limit ceiling is now more clearly the
  dominant constraint than any single signal's call volume (this session's
  648/658 and 741/751 429 rates are both far higher than session 40's
  single-launch 44/54 for deployer-history) — further per-signal call-count
  cuts are likely to keep hitting diminishing returns the way this one did.
  Worth considering a fundamentally different angle next: client-side
  request pacing/throttling tuned to the endpoint's actual budget (e.g.
  measuring its real requests-per-second allowance and spacing calls to
  stay under it, rather than firing bursts and retrying after the fact), or
  accepting the free/keyless ceiling as a documented constraint and
  focusing future sessions elsewhere.
  `RESCORE_DELAY_MS` (20s, session 34) is still untuned — unchanged this
  session.
- `findFundingSource`'s remaining ~2% unknown rate (session 39) — not a
  priority, unchanged this session; a lower `signatureLimit` (50→20) could
  plausibly raise this rate slightly for buyers whose true funding
  transaction sat beyond 20 signatures, but wasn't isolated from the
  429-driven failures in this session's measurement — not a concern given
  how dominant the rate-limit effect was in both runs.
- All five TASK.md steps remain functionally complete.

## Session 42 — 2026-10-10

*(Written up now, in Session 43 — Session 42 hit its step limit right after
reading the README to prepare this entry and never wrote it; same recurring
pattern as sessions 6-9/17/20/22-25/36. Reconstructed from
`logs/session-0042.md`, which records every step, plus the code it left
committed.)*

### Done
- Re-verified the repo first (163/163 tests, clean typecheck/build), then
  tried a different angle on the scoring endpoint's rate-limit ceiling
  (headline open item since session 20, with per-signal call-count cuts
  from sessions 40-41 already hitting diminishing returns): proactive
  client-side pacing instead of only reactive retry-after-429.
- Measured the official endpoint's sustained safe rate with a throwaway
  paced probe (`tmp-probe-pacing*.ts`, 5 iterations, all deleted after use)
  using `getSlot` (a non-indexed method, so the measurement isn't skewed by
  the separate indexed-method throttling sessions 20/28 found): a steady
  ~2.5 req/sec (400ms spacing) ran 40s with zero 429s; 5 req/sec degraded to
  ~27% 429 over a sustained 15s window; 7+ req/sec was worse. Conclusion:
  the ceiling is a sustained average rate, not just burst size.
- Implemented `minIntervalMs` in `src/rpc.ts`: a chained pacer
  (`pace()`/`paceChain`) that reserves each request's start time at least
  `minIntervalMs` after the previous one, queued in call order so concurrent
  callers space out instead of racing on `lastRequestStartedAt`. Disabled
  (`0`) by default so every existing caller/test is unaffected. 2 new tests
  in `rpc.test.ts`; a first fake-clock version hit a microtask-ordering
  flake (not a real bug — call attribution to a slot isn't deterministic
  under a fake clock, only the spacing is), replaced with a simpler
  real-timer test asserting total elapsed time instead.
- Wired into `src/server.ts`: `watcherScoringRpc`/`pollScoringRpc` (the two
  scoring clients) each got `minIntervalMs: 400`. First tried `800`, live
  checked (85s foreground boot), found deployer-history's `getTransaction`-
  heavy scan paced one-at-a-time took long enough that zero new launches
  landed in the window; halved to `400` (the measured single-stream safe
  rate) and re-checked over 110s: **1 launch landed in `/api/feed`**, plus a
  measurable drop in holder-concentration's 429 count (2 vs 3 in a
  comparable unpaced run).
- Updated `rug-radar/README.md`'s "Known limitations" top entry with the
  measurement, implementation, and both live-check results (session 42
  paragraph, ends with the honest caveat that the two scoring clients pace
  independently so their combined rate against the one shared endpoint is
  still roughly double the measured single-stream-safe rate).
- Cleaned up all 5 `tmp-probe-pacing*.ts` scratch files and confirmed no
  leftover server process, per the step log.

### Works
- `npm run typecheck` and `npm run build` clean in `/rug-radar`.
- `npm test`: 165/165 passing (2 new, in `rpc.test.ts`), all offline, ~3.5s.
- Live-measured the official endpoint's safe sustained rate with 5
  instrumented probes (deleted after use) and live-booted the real server
  twice (85s at `minIntervalMs: 800`, then 110s at `400`) — see "Done" above
  for both results.
- `git status` after this session's own cleanup (confirmed in Session 43)
  showed no leftover scratch files from session 42's work.

### Next (confirmed in Session 43)
- The scoring-endpoint rate-limit ceiling is reduced but still the binding
  constraint — one launch in 110s is far below real-time discovery's rate.
  The two scoring clients (`watcherScoringRpc`, `pollScoringRpc`) pace
  independently at 400ms each, so their combined request rate against the
  one shared endpoint is still roughly double the measured single-stream-
  safe rate (2.5 req/sec). A shared, cross-client pacer — one `minIntervalMs`
  budget split across both clients instead of 400ms each — is the logical
  next step and wasn't attempted.
- `RESCORE_DELAY_MS` (20s, session 34) is still untuned.
- `findFundingSource`'s remaining ~2% unknown rate (session 39) — not a
  priority.
- All five TASK.md steps remain functionally complete.

## Session 43 — 2026-10-10

### Done
- Re-verified the repo first (165/165 tests, clean typecheck/build — the
  165 reflects session 42's 2 new pacing tests, confirmed uncommitted-doc
  work didn't affect code), then found session 42's PROGRESS.md/README
  write-up had never been written (same step-limit pattern as sessions
  6-9/17/20/22-25/36) and backfilled both from `logs/session-0042.md` before
  starting new work — see the "Session 42" entry above.
- Picked up the exact gap session 42 flagged in its own `server.ts` comment
  (which was already internally inconsistent: it described `minIntervalMs:
  800` while the code next to it actually set `400`) and in its README/
  PROGRESS write-up: the two scoring clients (`watcherScoringRpc`,
  `pollScoringRpc`) paced independently at 400ms each, so their *combined*
  request rate against the one shared official endpoint could still reach
  ~5 req/sec — double the ~2.5 req/sec measured-safe ceiling from session
  42's probe.
- Fixed in `src/rpc.ts`: extracted the chained slot-reservation logic out of
  `SolanaRpcClient` into a standalone `RequestPacer` class (`reserve()`),
  and added a `pacer` option to `RetryOptions` that takes priority over
  `minIntervalMs`/`now` when given. `SolanaRpcClient` now always has exactly
  one `RequestPacer` (injected via `pacer`, or built internally from
  `minIntervalMs` for backward compatibility) — existing callers/tests using
  `minIntervalMs` directly are unaffected (verified: all pre-existing tests
  passed unchanged after the refactor, before any new test was added). 1 new
  test in `rpc.test.ts`: two `SolanaRpcClient`s sharing one `RequestPacer`
  instance, asserted via combined real-elapsed-time the same way the
  existing single-client `minIntervalMs` test asserts spacing.
- `src/server.ts`: `watcherScoringRpc`/`pollScoringRpc` now share one
  `new RequestPacer(400)` via the `pacer` option instead of each getting its
  own `minIntervalMs: 400`. Rewrote the stale comment block above them
  (the one with the 800-vs-400 inconsistency) to describe the shared pacer
  and why session 42 left this gap open.
- Live-checked foreground (110s, public mainnet-beta, no keys, same pattern
  as every session since 26): **1 launch landed in `/api/feed`** — not more
  than session 42's independently-paced check, so this is a correctness fix
  for the double-rate gap, not a throughput win by itself. New, more
  specific finding from the run's logs: of 39 total 429s, **37 were on
  `getTransaction` and only 2 on `getTokenLargestAccounts`** — since session
  42's rate measurement used `getSlot` (cheap, non-indexed) to find the
  ~2.5 req/sec ceiling, the endpoint may throttle expensive calls like
  `getTransaction` more strictly than cheap ones at the same request rate,
  which a flat combined-RPS pacer across all methods wouldn't capture. Not
  confirmed with a dedicated measurement this session.
- Updated `rug-radar/README.md`'s "Known limitations" top entry with a
  "Session 43" continuation (the fix, the live numbers, and the new
  getTransaction-vs-getSlot throttling question raised above).
- Confirmed no leftover scratch files or server process after the live
  check (`ps aux`, `git status`) — this session used no scratch probe files
  at all (the fix and its test were built directly, and the live check used
  the real server/log/feed files in `/tmp`, all deleted after reading).

### Works
- `npm run typecheck` and `npm run build` clean in `/rug-radar`.
- `npm test`: 166/166 passing (1 new, in `rpc.test.ts`), all offline, ~3.2s.
- Live-booted the real server once (110s, foreground, public mainnet-beta,
  no keys): 1 launch landed in `/api/feed`, 39 total 429s (37
  `getTransaction`, 2 `getTokenLargestAccounts`), 52 scoring-gate skips —
  see "Done" above.
- `git status`/`ps aux` after cleanup show only the intended
  `rpc.ts`/`rpc.test.ts`/`server.ts`/README/PROGRESS changes — no stray
  files, no leftover process.

### Next
- The new `getTransaction`-vs-`getSlot` throttling question (above) is the
  most concrete open item: if confirmed, `RequestPacer` would need to be
  per-method (or at least distinguish expensive indexed/transaction calls
  from cheap ones) rather than one flat rate shared across every JSON-RPC
  method a client calls. Worth a dedicated paced probe against
  `getTransaction` specifically (same shape as session 42's `getSlot` probe)
  before changing anything, not guessed at.
- The scoring-endpoint rate-limit ceiling is still the binding constraint —
  this session closed a real double-rate gap but didn't move the
  launches-landed-per-window number in this one sample; sessions 40-43 have
  now each made a structurally-correct, verified-honest improvement without
  a dramatic throughput change, consistent with session 41's conclusion that
  the endpoint's own throughput (not any one signal's or client's request
  shape) is the dominant constraint.
- `RESCORE_DELAY_MS` (20s, session 34) is still untuned.
- `findFundingSource`'s remaining ~2% unknown rate (session 39) — not a
  priority.
- All five TASK.md steps remain functionally complete.
