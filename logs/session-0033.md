# Session 33: Rug radar: live launch scoring

- Started: 2026-10-07T18:56:25Z
- Ended: 2026-10-07T19:06:00Z
- Steps: 45
- Model turns: 46
- Billing: Claude subscription (API value $3.4300, not billed)
- Outcome: ok

## Summary

Clean — only the intended files changed, no stray scratch files. 152/152 tests pass, typecheck and build are clean.  ## Summary  This session (33) continued the live-feed "balance index" feature from Sessions 29-32. Before implementing Session 32's sketched plan (run trade detection over the websocket watcher's existing program-wide stream and fetch every match), I checked it against the codebase's own log-line fixtures and found a real problem: log lines never carry account addresses, so there's no way to know which mint a trade belongs to without already fetching the transaction — doing tha…

## Steps

- `think` I'll start by reading TASK.md and PROGRESS.md to see what's been done and what's next.
- `run` cat TASK.md 2>/dev/null; echo "---PROGRESS---"; cat PROGRESS.md 2>/dev/null; echo "---LS---"; ls -la
- `read` PROGRESS.md
- `read` PROGRESS.md
- `think` This is session 33. Sessions have built up a rug-radar risk-scoring service incrementally. Session 32 left off with a `BalanceIndex` built but unwired. Let me verify repo state and look at the relevant files to continue step (3): wiring `BalanceIndex` into the websocket watcher and holder-concentration signal.
- `run` cd /home/runner/work/buildvote-agent/buildvote-agent/rug-radar && npm install --silent 2>&1 | tail -20 && npm run typecheck 2>&1 | tail -20 && npm test 2>&1 | tail -30
- `think` Repo is clean: 146/146 tests, typecheck clean. Let me look at the relevant files for wiring step (3).
- `run` for f in src/wsDiscovery.ts src/balanceIndex.ts src/signals/holderConcentration.ts src/data/holderConcentration.ts src/pipeline.ts src/server.ts; do echo "=== $f ==="; cat -n "$f"; echo; done
- `run` cat -n src/discovery.ts
- `run` cat -n src/pumpfun.ts | sed -n '1,40p'; echo ...; grep -n "decodeTradeInstruction" -A 40 src/pumpfun.ts | head -80
- `run` sed -n '110,160p' src/pumpfun.ts
- `run` sed -n '1,60p' src/wsLogParser.test.ts | grep -n "REAL_CREATE_V2_LOGS" -A 30 | head -60
- `run` cat -n src/wsDiscovery.test.ts
- `think` Now I understand the architecture. Before wiring `BalanceIndex` the way Session 32 sketched, I need to check an important detail: whether log lines carry enough info to know which mint a trade belongs to without fetching the full transaction.
- `run` grep -n "mentions\|logsSubscribe" src/wsDiscovery.ts README.md | head -20
- `run` cat -n src/wsLogParser.ts
- `think` Confirmed: log lines carry no account/mint info — only instruction names. This means Session 32's sketched plan ("run `detectTradeInstruction` on the full program-wide `mentions` stream, `getTransaction` every match") would multiply `getTransaction` calls across *all* pump.fun trades network-wide — the vast majority of the ~500 tx/sec firehose — making the already-severe rate-limit problem drasti…
- `read` rug-radar/src/rpc.ts
- `think` Now let's implement. First, refactor `discovery.ts` to add a shared retry-resolve helper and a trade-resolving function:
- `edit` rug-radar/src/discovery.ts
- `edit` rug-radar/src/discovery.ts
- `think` Now let's rewrite `wsDiscovery.ts` to support per-mint scoped subscriptions:
- `edit` rug-radar/src/wsDiscovery.ts
- `read` rug-radar/src/wsDiscovery.ts
- `think` Now I'll write the full updated file:
- `edit` rug-radar/src/wsDiscovery.ts
- `think` Now let's update the existing tests to emit the subscribe ack (now required for routing), and add new tests for `trackMint`/`untrackMint`/`onTrade`.
- `run` npx tsc --noEmit 2>&1 | head -40
- `think` Typecheck passes already. Now let's fix the tests that implicitly relied on no subscription routing.
- `edit` rug-radar/src/wsDiscovery.test.ts
- `edit` rug-radar/src/wsDiscovery.test.ts
- `edit` rug-radar/src/wsDiscovery.test.ts
- `edit` rug-radar/src/wsDiscovery.test.ts
- `run` npm test 2>&1 | tail -40
- `think` All existing tests pass. Now let's add new tests for `trackMint`/`untrackMint`/`onTrade`.
- `read` rug-radar/src/wsDiscovery.test.ts
- `run` grep -n "BUY_DISCRIMINATOR\|base58Encode\|amount\|TRADE_ACCOUNT_INDEX" src/pumpfun.test.ts | head -30
- `run` sed -n '100,155p' src/pumpfun.test.ts
- `edit` rug-radar/src/wsDiscovery.test.ts
- `edit` rug-radar/src/wsDiscovery.test.ts
- `think` Now add the trade fixture helper and new tests at the end of the file:
- `edit` rug-radar/src/wsDiscovery.test.ts
- `run` npm run typecheck 2>&1 | tail -30
- `run` npm test 2>&1 | tail -60
- `run` npm test 2>&1 | grep -i "discovery\|fail"
- `think` Good, all green: 152/152 tests, typecheck and build clean. Let's also run the build to be sure.
- `run` npm run build 2>&1 | tail -20
- `run` cat -n src/feed.ts
- `think` Given that pipeline scoring happens once, immediately on discovery, I should check: would feeding holder-concentration from a freshly-empty `BalanceIndex` even help at score time? Let me verify how `pipeline.ts`/`server.ts` score launches to confirm this matters before documenting it as the next step.
- `run` grep -n "scoreLaunch\|onLaunch" src/server.ts
- `run` grep -n "BalanceIndex\|balanceIndex\|detectTradeInstruction\|decodeTradeInstruction\|Known limitations\|Live feed" README.md | head -50
- `read` rug-radar/README.md
- `think` Now let's add the Session 33 writeup after the Session 32 paragraph:
- `edit` rug-radar/README.md
- `think` Now let's update PROGRESS.md with the Session 33 entry.
- `edit` PROGRESS.md
- `run` tail -15 PROGRESS.md
- `run` tail -15 /home/runner/work/buildvote-agent/buildvote-agent/PROGRESS.md
- `think` Now I'll append the new session entry using unique preceding context.
- `edit` PROGRESS.md
- `think` Now let's do a final full verification pass and check git status for cleanliness.
- `run` npm run typecheck 2>&1 | tail -10 && npm run build 2>&1 | tail -10 && npm test 2>&1 | tail -15
- `run` cd /home/runner/work/buildvote-agent/buildvote-agent && git status --short
- `think` Clean — only the intended files changed, no stray scratch files. 152/152 tests pass, typecheck and build are clean.
