# Session 40: Rug radar: live launch scoring

- Started: 2026-10-10T00:48:14Z
- Ended: 2026-10-10T00:59:26Z
- Steps: 39
- Model turns: 40
- Billing: Claude subscription (API value $2.6333, not billed)
- Outcome: ok

## Summary

Everything is clean: typecheck/build pass, 163/163 tests pass, no leftover processes, and `git status` shows only the intended files changed.  ## Summary  This session picked up the long-standing scoring-endpoint rate-limit ceiling (open since session 20) from a new angle: measuring how many RPC calls one signal issues per launch, not just whether the endpoint throttles them.  **Finding:** instrumented the real data-fetch functions against a live launch and found `fetchDeployerHistoryInput`'s retroactive scan alone issued 54 `getTransaction` calls (44 of them HTTP 429) and took 113 seconds fo…

## Steps

- `think` I'll start by reading TASK.md and PROGRESS.md to understand the current task and status.
- `read` TASK.md
- `read` PROGRESS.md
- `think` This is a large progress file. Let me read the rest to see the most recent sessions and current state.
- `read` PROGRESS.md
- `read` PROGRESS.md
- `read` PROGRESS.md
- `think` I've read the task and the full 39-session history. The project is functionally complete (all 5 TASK.md steps built), with the main open item being the scoring RPC endpoint's rate-limit ceiling, plus a minor ~2% residual issue in funding-source lookback. Let me verify the current repo state before deciding what to do this session.
- `run` cd /home/runner/work/buildvote-agent/buildvote-agent/rug-radar && git log --oneline -5 && echo --- && git status && echo --- && ls
- `run` npm install --no-audit --no-fund >/tmp/npminstall.log 2>&1; tail -20 /tmp/npminstall.log; echo "---TYPECHECK---"; npm run typecheck 2>&1 | tail -30; echo "---TEST---"; npm test 2>&1 | tail -40
- `run` npm run build 2>&1 | tail -20 && echo OK
- `think` Repo is clean and matches the documented state (163/163 tests, clean typecheck/build). Let me look at the current scoring pipeline to see which RPC calls still hit the rate-limited scoring endpoint, to find a concrete next step.
- `read` rug-radar/src/pipeline.ts
- `read` rug-radar/src/data/deployerHistory.ts
- `read` rug-radar/src/data/bundledBuys.ts
- `run` grep -n "Known limitations" -A 150 README.md | head -250
- `run` grep -n "^## Known limitations" -A 400 README.md | tail -250
- `run` grep -n "^## " README.md
- `run` grep -n "Known limitations" README.md
- `read` rug-radar/README.md
- `read` rug-radar/src/rpc.ts
- `think` This is a well-documented, mature codebase where the scoring RPC rate-limit ceiling has been the headline open item across many sessions (20-39), with several endpoint alternatives already exhausted (sessions 27-28). Let me check something none of those sessions directly measured: the actual RPC call volume each signal generates per launch — `deployerHistory` scans up to 100 signatures and `bundl…
- `run` cat src/config.ts
- `read` rug-radar/src/server.ts
- `think` Let me write a scratch probe to measure, for a real launch, how many RPC calls each signal's data-fetch actually issues against the scoring endpoint — no prior session measured this directly.
- `edit` rug-radar/tmp-probe-callcount.ts
- `run` NODE_OPTIONS=--experimental-websocket timeout 240 npx tsx tmp-probe-callcount.ts 2>&1 | tail -100
- `run` grep -n "signatureLimit\|DEFAULT_SIGNATURE_LIMIT\|100" src/data/deployerHistory.test.ts
- `run` grep -rn "signatureLimit" src/ | grep -v test
- `think` Good, no test pins the default value. Now let's make the bounded, measured fix: lower `deployerHistory`'s default signature-scan limit.
- `read` rug-radar/src/data/deployerHistory.ts
- `edit` rug-radar/src/data/deployerHistory.ts
- `think` Now let's run the offline tests, typecheck, and build to confirm nothing broke.
- `run` npm run typecheck 2>&1 | tail -20 && echo "---TEST---" && npm test 2>&1 | tail -15
- `think` 163/163 still pass. Now let's live-verify the actual effect of this change with the same measurement probe, against a fresh real launch.
- `run` NODE_OPTIONS=--experimental-websocket timeout 180 npx tsx tmp-probe-callcount.ts 2>&1 | grep -v "RPC HTTP error 429"
- `think` Dramatic improvement: deployer-history dropped from 54 calls/113s/44 errors to 4 calls/0.3s/0 errors; bundled-buys from 28 calls/88s/25 errors to 2 calls/2.5s/0 errors. Let's now verify this helps the full pipeline land launches in `/api/feed`.
- `run` (NODE_OPTIONS=--experimental-websocket npx tsx src/server.ts > /tmp/server-session40.log 2>&1 &) ; sleep 85; curl -s http://localhost:8787/api/feed; echo; echo "---LOG TAIL---"; tail -60 /tmp/server-session40.log; pkill -f "tsx src/server.ts" || true
- `run` ps aux | grep -i "tsx src/server" | grep -v grep; echo "---"; ps aux | grep node | grep -v grep
- `think` Good, no leftover process. Now let's clean up the scratch probe and check `git status`.
- `run` rm -f tmp-probe-callcount.ts && git status
- `think` Only the intended code change remains. Now let's update the README and PROGRESS.md with this session's measured finding, fix, and live-verified results.
- `run` grep -n "A real fix would need either a paid/less-restricted endpoint" README.md
- `read` rug-radar/README.md
- `edit` rug-radar/README.md
- `think` Now let's also update the signal-1 description in the "Signals" section to mention the new default, and update PROGRESS.md.
- `run` sed -n '230,243p' README.md
- `edit` rug-radar/README.md
- `think` Now let's append the Session 40 entry to PROGRESS.md.
- `edit` PROGRESS.md
- `read` PROGRESS.md
- `edit` PROGRESS.md
- `think` Now let's do a final verification pass: tests, typecheck, build, and git status.
- `run` npm run typecheck 2>&1 | tail -10 && npm run build 2>&1 | tail -10 && npm test 2>&1 | tail -10 && echo "---STATUS---" && cd /home/runner/work/buildvote-agent/buildvote-agent && git status && ps aux | grep -i tsx | grep -v grep
- `think` Everything is clean: typecheck/build pass, 163/163 tests pass, no leftover processes, and `git status` shows only the intended files changed.
