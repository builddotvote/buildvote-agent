# Session 38: Rug radar: live launch scoring

- Started: 2026-10-09T10:30:45Z
- Ended: 2026-10-09T10:39:50Z
- Steps: 45
- Model turns: 46
- Billing: Claude subscription (API value $3.4047, not billed)
- Outcome: ok

## Summary

## Summary  This session had two parts:  1. **Fixed a documentation gap.** Found that `discovery.ts`'s `launch.bundledBuy` decoding and `server.ts`'s `scheduleHolderRescore` seeding step (plus 2 tests) were real, tested, working code in the repo — but completely undocumented. A prior run (`logs/session-0036.md`) built this fix but hit its step limit right before documenting it; the next run inherited the fixed code and mis-wrote it up as confirming a pre-existing mechanism rather than this fix. Corrected `README.md` and `PROGRESS.md` to reflect what actually happened.  2. **Closed the oldest …

## Steps

- `run` cat TASK.md 2>/dev/null; echo "---PROGRESS---"; cat PROGRESS.md 2>/dev/null
- `read` PROGRESS.md
- `read` PROGRESS.md
- `read` PROGRESS.md
- `read` PROGRESS.md
- `run` git log --oneline -5 && echo --- && git show --stat HEAD
- `read` logs/session-0037.md
- `run` cd /home/runner/work/buildvote-agent/buildvote-agent/rug-radar && ls && echo --- && npm install --silent 2>&1 | tail -20 && echo INSTALL_DONE
- `run` npm run typecheck 2>&1 | tail -20 && echo ---BUILD--- && npm run build 2>&1 | tail -20 && echo ---TEST--- && npm test 2>&1 | tail -15
- `think` Repo is clean: 162/162 tests pass, typecheck and build clean. All five TASK.md steps remain functionally complete per history; the two oldest open items are the scoring-endpoint rate-limit ceiling and `findFundingSource`'s lookback-limit live check (blocked since Session 4). Let me look at the bundledBuys data fetch and the relevant README section before deciding how to spend this session.
- `read` rug-radar/src/data/bundledBuys.ts
- `run` sed -n '1,80p' src/config.ts
- `run` sed -n '1,60p' src/wsDiscovery.ts | head -100
- `run` grep -n "class LaunchWatcher\|constructor(\|export interface\|export function\|onLaunch\|onTrade\|trackMint\|untrackMint\|DiscoveredLaunch" src/wsDiscovery.ts src/discovery.ts | head -60
- `run` sed -n '1,35p' src/discovery.ts; echo ---; sed -n '125,160p' src/wsDiscovery.ts; echo ---TRADE---; sed -n '1,40p' src/pumpfun.ts | grep -n "TradeInstruction" -A5
- `run` cd /home/runner/work/buildvote-agent/buildvote-agent && grep -n "bundledBuy\|scheduleHolderRescore" -r rug-radar/src rug-radar/README.md PROGRESS.md | head -60
- `run` ls logs/ | sort -V | tail -10
- `run` cd /home/runner/work/buildvote-agent/buildvote-agent/rug-radar && grep -n "dev buy\|bundledBuy\|scheduleHolderRescore\|RESCORE_DELAY_MS" README.md
- `read` rug-radar/README.md
- `run` grep -n "^Session\|bundled dev buy\|scheduleHolderRescore\|^## " README.md
- `read` rug-radar/README.md
- `run` cd /home/runner/work/buildvote-agent/buildvote-agent && grep -l "discovery.ts\|bundledBuy" logs/*.md
- `run` grep -n "bundledBuy" logs/session-0033.md logs/session-0034.md logs/session-0036.md
- `read` logs/session-0036.md
- `run` cd /home/runner/work/buildvote-agent/buildvote-agent/rug-radar && sed -n '1,230p' src/discovery.ts
- `think` Now let me check `server.ts`'s `scheduleHolderRescore` to see exactly how `bundledBuy` is used:
- `run` sed -n '1,155p' src/server.ts
- `run` grep -n "bundledBuy\|bundled" src/discovery.test.ts
- `tool` ToolSearch
- `tool` TaskCreate
- `tool` TaskCreate
- `tool` TaskUpdate
- `think` Now let's update README.md. First the "Live feed" section's discovery bullet, then "Known limitations":
- `read` rug-radar/README.md
- `edit` rug-radar/README.md
- `think` Now update the "Known limitations" section's session 36 bullet to correctly attribute the fix:
- `edit` rug-radar/README.md
- `think` Now let's add a PROGRESS.md entry documenting this correction as the next session:
- `edit` PROGRESS.md
- `think` Documentation gap fixed. Now let's verify the suite is still clean, then attempt the `findFundingSource` live check against the less-throttled discovery endpoint since there's room this session.
- `run` npm run typecheck 2>&1 | tail -10 && npm test 2>&1 | tail -10 && git status --short
- `think` Clean. Let's mark task #1 complete and move to the live check.
- `tool` TaskUpdate
- `tool` TaskUpdate
- `run` grep -n "SignatureFetcher\|private readonly rpc\|rpc:" src/wsDiscovery.ts | head -20
- `think` Good, now let me write the probe script.
- `edit` rug-radar/tmp-probe-funding2.ts
- `run` NODE_OPTIONS=--experimental-websocket timeout 180 node --import tsx tmp-probe-funding2.ts 2>&1 | tail -150; echo "PROBE_EXIT=$?"
- `think` Got a conclusive result: **4 of 12 distinct early buyers (33%) resolved to `UNKNOWN` funding source** with the default 50-signature lookback, across 4 real mints over a live mainnet-beta session. This finally closes the question open since Session 4. Let me clean up and document it.
- `run` rm -f tmp-probe-funding2.ts && git status --short
- `edit` rug-radar/README.md
- `think` Now add this to PROGRESS.md's Session 37 entry:
- `edit` PROGRESS.md
- `think` Now let's do a final verification pass and check for cleanliness.
- `run` npm run typecheck 2>&1 | tail -10 && npm run build 2>&1 | tail -10 && npm test 2>&1 | tail -10 && echo --- && cd .. && git status --short && ps aux | grep -i "tsx\|node" | grep -v grep
- `think` Everything's clean: 162/162 tests pass, typecheck/build clean, only the intended `PROGRESS.md`/`README.md` changes, no stray files or processes.
- `tool` TaskUpdate
- `think` ## Summary
