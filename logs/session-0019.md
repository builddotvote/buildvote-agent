# Session 19: Rug radar: live launch scoring

- Started: 2026-10-03T21:12:19Z
- Ended: 2026-10-03T21:29:14Z
- Steps: 52
- Model turns: 53
- Billing: Claude subscription (API value $2.5406, not billed)
- Outcome: ok

## Summary

Working tree is clean of scratch files, only intended changes remain. Session summary:  **Done:** Set out to live-check `findFundingSource`'s lookback limit (open since Session 4), but discovered something more urgent: the live watcher resolved **zero** launches over 3 minutes against real mainnet-beta, even in isolation at production's own concurrency settings — far worse than the previously-documented "occasional 429s." Root-caused a real bug: `resolveLaunchFromSignature` treated a thrown 429-exhaustion error exactly like a genuine "not found yet" replication-lag result, retrying it with th…

## Steps

- `think` I'll start by reading the task and progress files.
- `run` cat TASK.md 2>/dev/null; echo "---PROGRESS---"; cat PROGRESS.md 2>/dev/null
- `read` PROGRESS.md
- `read` TASK.md
- `run` cd /home/runner/work/buildvote-agent/buildvote-agent/rug-radar && git status && echo "---ls---" && ls -la && echo "---src---" && ls src && echo "---node_modules?---" && ls node_modules >/dev/null 2>&1 && echo "present" || echo "absent"
- `think` Repo is clean, all five TASK.md steps are functionally complete per PROGRESS.md. Let me install deps and verify current state before picking up the next open item.
- `run` npm install --silent 2>&1 | tail -20 && echo "---typecheck---" && npm run typecheck 2>&1 | tail -30 && echo "---test---" && time npm test 2>&1 | tail -40
- `think` All 111 tests pass, clean typecheck, suite runs in ~3s as fixed last session. Now let me look at the most concrete open item — `findFundingSource`'s lookback-limit live check — which has been deferred since Session 4.
- `read` rug-radar/src/data/bundledBuys.ts
- `read` rug-radar/src/server.ts
- `tool` ToolSearch
- `tool` TaskCreate
- `tool` TaskCreate
- `tool` TaskCreate
- `tool` TaskCreate
- `think` Baseline already verified (111/111 tests, clean typecheck/build).
- `tool` TaskUpdate
- `tool` TaskUpdate
- `think` Now let me write a scratch probe to watch the live websocket feed for a fresh mint, then test `fetchBundledBuysInput` against it once early-buy activity accumulates.
- `read` rug-radar/src/wsDiscovery.ts
- `read` rug-radar/src/config.ts
- `run` grep -n "DiscoveredLaunch" -A 10 src/discovery.ts | head -30
- `think` Now I'll write the scratch probe script.
- `edit` rug-radar/tmp-probe-funding.ts
- `run` NODE_OPTIONS=--experimental-websocket node --import tsx tmp-probe-funding.ts 2>&1
- `read` rug-radar/src/discovery.ts
- `run` grep -n "safeGetTransaction\|maxRetries\|maxConcurrent\|class SolanaRpcClient" -A 15 src/rpc.ts | head -150
- `edit` rug-radar/tmp-probe-watcher-only.ts
- `run` NODE_OPTIONS=--experimental-websocket node --import tsx tmp-probe-watcher-only.ts 2>&1 | grep -E "^\[launch|^\[status|^done"
- `run` NODE_OPTIONS=--experimental-websocket node --import tsx tmp-probe-watcher-only.ts > /tmp/watcher_probe.log 2>&1 & PROBE_PID=$! sleep 90 kill $PROBE_PID 2>/dev/null wait $PROBE_PID 2>/dev/null echo "--- total lines ---" wc -l /tmp/watcher_probe.log echo "--- unique signatures with errors ---" grep -oE "getTransaction failed for [A-Za-z0-9]+" /tmp/watcher_probe.log | sort | uniq -c | sort -rn | hea…
- `run` grep -n "getTransaction\b" -A 20 src/rpc.ts | head -40
- `think` I've confirmed something more serious than documented: with production's own concurrency settings, the live watcher resolved **zero** launches in 3 minutes of real time — not just "under-reporting," but a near-total stall. Let me trace the root cause.
- `run` grep -n "safeGetTransaction" -r src --include="*.ts" | grep -v test
- `think` I found the root cause. `resolveLaunchFromSignature` (src/discovery.ts:133) calls `safeGetTransaction`, which collapses two different failures into the same `null`: a genuine "not found yet" (RPC returns null natively, the replication-lag case Session 17 fixed) and a thrown error (429-exhausted after rpc.ts's own 4 retries). The not-found retry loop then retries a 429-exhaustion the same way it r…
- `read` rug-radar/src/discovery.test.ts
- `edit` rug-radar/src/discovery.ts
- `edit` rug-radar/src/discovery.ts
- `edit` rug-radar/src/discovery.ts
- `run` npm run typecheck 2>&1 | tail -30
- `think` Clean. Now let's run the test suite.
- `run` time npm test 2>&1 | tail -50
- `think` Now let's add a dedicated test for this exact fix — confirming a thrown error does NOT trigger the retry loop even when retries > 0.
- `edit` rug-radar/src/discovery.test.ts
- `read` rug-radar/src/discovery.test.ts
- `think` This workaround is no longer needed now that a thrown error never retries — removing it so the test doesn't imply retries still matter here.
- `edit` rug-radar/src/discovery.test.ts
- `run` npm run typecheck 2>&1 | tail -20 && echo "---test---" && time npm test 2>&1 | tail -20
- `think` All 112 tests pass (1 new), clean typecheck, fast suite. Now let's re-run the live watcher-only probe to confirm this actually fixes the stall.
- `run` timeout 180 env NODE_OPTIONS=--experimental-websocket node --import tsx tmp-probe-watcher-only.ts 2>&1 | grep -E "^\[launch|^\[status|^done|429" | head -60
- `run` pgrep -fa "tmp-probe\|tsx src/server" 2>/dev/null; echo "---"; ps aux | grep -i node | grep -v grep
- `think` Good, no stray processes. Confirmed the amplification fix is correct but current RPC rate-limiting is severe enough that even a single, non-amplified attempt per signature mostly fails. Let's clean up scratch files and move to documenting findings.
- `run` rm -f tmp-probe-funding.ts tmp-probe-watcher-only.ts && git status
- `think` Clean. Now let's update the README's Known limitations section.
- `run` grep -n "Known limitations" -A 60 README.md | head -90
- `run` grep -n "Known limitations" README.md
- `read` rug-radar/README.md
- `think` Now I'll update the "Known limitations" section with the new finding and the fix's effect, and update `resolveLaunchFromSignature`'s description.
- `edit` rug-radar/README.md
- `edit` rug-radar/README.md
- `edit` rug-radar/README.md
- `think` Now let's run the full test suite one final time to confirm everything is clean, then update PROGRESS.md.
- `run` npm run typecheck 2>&1 | tail -10 && echo "---build---" && npm run build 2>&1 | tail -10 && echo "---test---" && time npm test 2>&1 | tail -10 && echo "---status---" && git status
- `think` Everything is clean. Only intended files changed, no stray scratch files. Now let's update PROGRESS.md.
- `tool` TaskUpdate
- `tool` TaskUpdate
- `tool` TaskUpdate
- `edit` PROGRESS.md
- `tool` TaskUpdate
- `run` cd /home/runner/work/buildvote-agent/buildvote-agent && git status && git diff --stat
- `think` Working tree is clean of scratch files, only intended changes remain. Session summary:
