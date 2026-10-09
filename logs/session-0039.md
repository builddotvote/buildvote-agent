# Session 39: Rug radar: live launch scoring

- Started: 2026-10-09T18:20:33Z
- Ended: 2026-10-09T18:31:15Z
- Steps: 46
- Model turns: 47
- Billing: Claude subscription (API value $3.0736, not billed)
- Outcome: ok

## Summary

## Summary  This session root-caused and fixed the long-open `findFundingSource` miss-rate question (open since Session 4, measured at 33% in Session 37 but never diagnosed).  Built an instrumented live probe against real mainnet-beta traffic and found the 33% "unknown" rate wasn't signature-limit exhaustion — it was a real bug: `findFundingSource` only ever checked a buyer wallet's single *oldest* visible transaction for a SOL funding transfer, but that oldest transaction often wasn't the funding transfer at all (some unrelated activity), while the real funding transfer sat a few signatures …

## Steps

- `run` cat /home/runner/work/buildvote-agent/buildvote-agent/TASK.md 2>/dev/null; echo "---PROGRESS---"; cat /home/runner/work/buildvote-agent/buildvote-agent/PROGRESS.md 2>/dev/null
- `read` PROGRESS.md
- `run` ls -la /home/runner/work/buildvote-agent/buildvote-agent/rug-radar 2>/dev/null && echo "---" && find /home/runner/work/buildvote-agent/buildvote-agent/rug-radar -type f -not -path "*/node_modules/*" -not -path "*/.git/*" | sort
- `read` PROGRESS.md
- `run` wc -l /home/runner/work/buildvote-agent/buildvote-agent/PROGRESS.md
- `read` PROGRESS.md
- `run` git log --oneline -15 && echo "---" && git show --stat HEAD | head -30
- `run` ls /home/runner/work/buildvote-agent/buildvote-agent/logs/ | sort -V | tail -10
- `run` cat /home/runner/work/buildvote-agent/buildvote-agent/logs/session-0038.md
- `think` I'll pick up where Session 37 left off. Let me start by verifying the repo baseline matches what PROGRESS.md documented.
- `run` cd /home/runner/work/buildvote-agent/buildvote-agent/rug-radar && npm install --silent 2>&1 | tail -20 && echo ---TYPECHECK--- && npm run typecheck 2>&1 | tail -20 && echo ---BUILD--- && npm run build 2>&1 | tail -20 && echo ---TEST--- && npm test 2>&1 | tail -15
- `think` Baseline confirmed (162/162, clean typecheck/build). Now let's dig into the `findFundingSource` miss-rate question Session 37 left open — specifically *why* the 33% of early buyers resolve to unknown funding source.
- `tool` ToolSearch
- `tool` TaskCreate
- `read` rug-radar/src/data/bundledBuys.ts
- `run` sed -n '1,60p' src/config.ts
- `run` grep -n "class LaunchWatcher\|constructor(\|onLaunch\|export function deriveWsUrl\|export interface LaunchWatcherOptions" src/wsDiscovery.ts | head -30
- `read` 
- `read` rug-radar/src/wsDiscovery.ts
- `run` sed -n '1,60p' src/server.ts
- `run` grep -n "export function safeGetTransaction\|export class SolanaRpcClient\|getSignaturesForAddress\|getTransaction(" src/rpc.ts | head -20
- `think` Now let me write the instrumented probe.
- `edit` rug-radar/tmp-probe-funding3.ts
- `run` grep -n "interface DiscoveredLaunch" -A 15 src/discovery.ts
- `edit` rug-radar/tmp-probe-funding3.ts
- `tool` TaskUpdate
- `think` Now let's run it live against mainnet-beta synchronously (foreground, per Session 26's lesson about avoiding background+ScheduleWakeup).
- `run` NODE_OPTIONS=--experimental-websocket timeout 200 node --import tsx tmp-probe-funding3.ts 2>&1 | tail -200; echo "PROBE_EXIT=$?"
- `run` NODE_OPTIONS=--experimental-websocket timeout 5 node -e "1" 2>/dev/null; echo done
- `think` Clear result: nearly every "unknown" case is the same root cause — `earliest-tx-not-funding-BUT-a-later-one-within-limit-is`. This is a real logic bug (only checking the single oldest signature), not signature-limit exhaustion. Let me confirm by tallying and then look at the existing tests before fixing.
- `run` rm -f tmp-probe-funding3.ts && git status --short
- `think` Good, clean. Now let's look at the existing tests for `findFundingSource` before changing the implementation.
- `read` rug-radar/src/data/bundledBuys.test.ts
- `edit` rug-radar/src/data/bundledBuys.ts
- `think` Now let's add a regression test for this specific scenario, and verify it fails without the fix.
- `edit` rug-radar/src/data/bundledBuys.test.ts
- `run` npm run typecheck 2>&1 | tail -20 && npm test 2>&1 | tail -20
- `think` 163/163 passing. Let me verify the new test actually catches the bug by reverting the fix temporarily.
- `run` git stash -- src/data/bundledBuys.ts && node --test src/data/bundledBuys.test.ts 2>&1 | tail -30; git stash pop
- `run` cat package.json | grep -A2 '"test"'
- `run` git stash -- src/data/bundledBuys.ts && node --import tsx --test --test-reporter spec src/data/bundledBuys.test.ts 2>&1 | tail -40; git stash pop
- `think` Confirmed: the new test fails without the fix (proving it's a real regression test) and passes with it. Now let's run the full suite again with the fix restored, then live-verify against mainnet.
- `run` npm run typecheck 2>&1 | tail -10 && npm run build 2>&1 | tail -10 && npm test 2>&1 | tail -10
- `think` Clean. Now let's live-verify the actual fix with the real `fetchBundledBuysInput` function against mainnet-beta.
- `edit` rug-radar/tmp-verify-funding-fix.ts
- `run` NODE_OPTIONS=--experimental-websocket timeout 200 node --import tsx tmp-verify-funding-fix.ts 2>&1 | tail -100; echo "PROBE_EXIT=$?"
- `think` Excellent result: unknown rate dropped from 33% to 2% (5 of 217 buyers). Let's clean up and finalize.
- `run` rm -f tmp-verify-funding-fix.ts && git status --short && ps aux | grep -i "tsx\|node" | grep -v grep
- `think` No stray files or processes. Now let's update the README and PROGRESS.md.
- `run` grep -n "signatureLimit\|findFundingSource\|33%\|lookback-limit\|Known limitations" README.md | head -40
- `read` rug-radar/README.md
- `think` Now let's find the "Bundled buys" signal description section to add context about the fix itself (not just the limitations entry).
- `run` grep -n "fetchBundledBuysInput\|### Bundled\|## Bundled\|Bundled buys" README.md | head -20
- `read` rug-radar/README.md
- `edit` rug-radar/README.md
- `edit` rug-radar/README.md
- `think` Now let's update PROGRESS.md with the Session 39 entry.
- `edit` PROGRESS.md
- `think` Let's do a final verification pass to confirm everything is clean before finishing.
- `run` npm run typecheck 2>&1 | tail -10 && npm run build 2>&1 | tail -10 && npm test 2>&1 | tail -10 && echo --- && cd .. && git status --short && ps aux | grep -i "tsx\|node" | grep -v grep
- `think` Clean: typecheck/build/tests all pass, only the intended files changed, no stray scratch files or processes.
- `tool` TaskUpdate
- `think` ## Summary
