# Session 44: Rug radar: live launch scoring

- Started: 2026-10-11T05:42:54Z
- Ended: 2026-10-11T05:58:08Z
- Steps: 47
- Model turns: 48
- Billing: Claude subscription (API value $2.8789, not billed)
- Outcome: ok

## Summary

Everything is clean: typecheck, build, and tests (167/167) pass; `git status` shows only the intended files changed; no stray processes or scratch files.  ## Session 44 summary  Picked up Session 43's open question — whether `getTransaction` is throttled more strictly than other RPC methods on the official Solana endpoint. Ran a dedicated paced probe and confirmed it decisively: at 2.5 req/sec (the rate `getSlot` handled with zero 429s), `getTransaction` hit **90% 429s**; its real safe rate is ~0.5 req/sec.  Fixed by giving `RequestPacer` (`src/rpc.ts`) per-method pacing lanes via a new `meth…

## Steps

- `think` I'll start by reading the task and progress files.
- `read` TASK.md
- `read` PROGRESS.md
- `read` PROGRESS.md
- `read` PROGRESS.md
- `run` cd /home/runner/work/buildvote-agent/buildvote-agent/rug-radar && git status && git log --oneline -5 && ls
- `think` This is Session 44. The repo is clean and the top open item is the `getTransaction`-vs-`getSlot` throttling question from Session 43: whether the official RPC endpoint throttles expensive calls like `getTransaction` more strictly than cheap ones like `getSlot` at the same request rate. Let me verify the test suite first, then investigate.
- `run` npm install --silent 2>&1 | tail -5 && npm run typecheck 2>&1 | tail -20 && npm test 2>&1 | tail -20
- `think` 166/166 pass, clean typecheck. Now let me run the dedicated paced probe against `getTransaction` that Session 43 proposed, to see if it's throttled more strictly than `getSlot` at the same rate.
- `run` cat src/config.ts | head -30
- `run` sed -n '1,50p' src/rpc.ts | head -80
- `run` grep -n "getSlot\|getTransaction\|class SolanaRpcClient\|constructor\|minIntervalMs\|RequestPacer\|maxConcurrent" src/rpc.ts | head -60
- `edit` rug-radar/tmp-probe-gettx-pacing.ts
- `run` timeout 90 npx tsx tmp-probe-gettx-pacing.ts 2>&1
- `think` This confirms the hypothesis strongly: at the same 2.5 req/sec rate where `getSlot` had zero 429s, `getTransaction` hits 90% 429s. Let me find the actual safe rate for `getTransaction` specifically.
- `edit` rug-radar/tmp-probe-gettx-pacing.ts
- `run` timeout 90 npx tsx tmp-probe-gettx-pacing.ts 2>&1
- `read` rug-radar/src/rpc.ts
- `run` grep -n "RequestPacer\|minIntervalMs\|ScoringRpc\|pacer" src/server.ts
- `think` Good, now let me implement per-method pacing in `rpc.ts`.
- `read` rug-radar/src/rpc.test.ts
- `run` grep -n "minIntervalMs\|RequestPacer\|paces\|pacer" src/rpc.test.ts
- `read` rug-radar/src/rpc.test.ts
- `think` Now let me implement per-method pacing in `rpc.ts`.
- `edit` rug-radar/src/rpc.ts
- `edit` rug-radar/src/rpc.ts
- `think` Now update the `SolanaRpcClient` constructor and `request` method to pass through `methodIntervalsMs` and the method name:
- `edit` rug-radar/src/rpc.ts
- `edit` rug-radar/src/rpc.ts
- `think` Now update `server.ts` to give `getTransaction` its own, slower lane on the shared scoring pacer:
- `read` rug-radar/src/server.ts
- `edit` rug-radar/src/server.ts
- `think` Now let's add tests to `rpc.test.ts` for per-method pacing:
- `read` rug-radar/src/rpc.test.ts
- `edit` rug-radar/src/rpc.test.ts
- `run` npm run typecheck 2>&1 | tail -30
- `think` Clean. Now let's run the tests.
- `run` npm test 2>&1 | tail -40
- `think` 167/167 passing, offline, ~2.5s. Now let's live-verify the actual fix end-to-end with a foreground boot.
- `run` npm run build 2>&1 | tail -10
- `run` NODE_OPTIONS=--experimental-websocket timeout 120 node --import tsx src/server.ts > /tmp/server-session44.log 2>&1 & echo "started PID $!" sleep 112 curl -s http://localhost:3000/api/feed | head -c 2000 echo echo "--- log tail ---" tail -80 /tmp/server-session44.log pkill -f "tsx src/server.ts" 2>/dev/null sleep 1 ps aux | grep -i "server.ts" | grep -v grep
- `run` grep -c "429" /tmp/server-session44.log; grep -o "RPC HTTP error 429 for [a-zA-Z]*" /tmp/server-session44.log | sort | uniq -c; grep -i "listening\|rescored\|^rug-radar" /tmp/server-session44.log
- `run` grep -c "getTransaction failed" /tmp/server-session44.log; grep "getTransaction failed" /tmp/server-session44.log | head -5; curl -s http://localhost:8787/api/feed | head -c 3000; echo; ps aux | grep "server.ts" | grep -v grep
- `run` grep -n "console.log\|console.error" src/server.ts src/poller.ts src/pipeline.ts
- `run` cd /home/runner/work/buildvote-agent/buildvote-agent/rug-radar NODE_OPTIONS=--experimental-websocket nohup node --import tsx src/server.ts > /tmp/server-session44b.log 2>&1 & SERVER_PID=$! echo "started PID $SERVER_PID" sleep 100 echo "--- feed ---" curl -s http://localhost:8787/api/feed echo echo "--- 429 counts by method ---" grep -o "RPC HTTP error 429 for [a-zA-Z]*" /tmp/server-session44b.log…
- `run` cat /tmp/server-session44b.log | grep -v "too many pending scores"
- `read` rug-radar/src/server.ts
- `think` The scoring gate let 3 launches through but none landed in the feed within 100s — the slower `getTransaction` lane (2000ms) may be serializing signal fetches too much. Let me check with a longer window to see if this is a latency tradeoff, not just a correctness fix.
- `run` cd /home/runner/work/buildvote-agent/buildvote-agent/rug-radar NODE_OPTIONS=--experimental-websocket nohup node --import tsx src/server.ts > /tmp/server-session44c.log 2>&1 & SERVER_PID=$! echo "started PID $SERVER_PID" sleep 200 echo "--- feed ---" curl -s http://localhost:8787/api/feed echo echo "--- 429 counts by method ---" grep -o "RPC HTTP error 429 for [a-zA-Z]*" /tmp/server-session44c.log…
- `think` Confirmed: 2 launches landed in `/api/feed` within 200s, **zero** `getTransaction` 429s or failures (vs. Session 43's 37/39), with the only 429s now on `getTokenLargestAccounts` (the method still on the shared 400ms lane). Let me clean up and update the documentation.
- `run` cd /home/runner/work/buildvote-agent/buildvote-agent/rug-radar ps aux | grep -i "server.ts\|tmp-probe" | grep -v grep rm -f tmp-probe-gettx-pacing.ts git status
- `think` No stray processes or scratch files. Now let's update the README and PROGRESS.md.
- `run` grep -n "Known limitations" README.md
- `read` rug-radar/README.md
- `run` grep -n "Session 42\|Session 43\|session 42\|session 43" README.md | head -30
- `read` rug-radar/README.md
- `think` Now let me add the Session 44 continuation right after this paragraph.
- `edit` rug-radar/README.md
- `think` Now let's add the Session 44 entry to PROGRESS.md.
- `edit` PROGRESS.md
- `read` PROGRESS.md
- `think` This is the end of the file (Session 43's entry). Let me append the Session 44 entry here with sufficient unique context.
- `edit` PROGRESS.md
- `think` Let me do a final verification pass: typecheck, build, tests, and confirm no stray files or processes.
- `run` cd /home/runner/work/buildvote-agent/buildvote-agent/rug-radar npm run typecheck 2>&1 | tail -10 npm run build 2>&1 | tail -10 npm test 2>&1 | tail -10 echo "--- git status ---" cd /home/runner/work/buildvote-agent/buildvote-agent && git status ps aux | grep -i "server.ts\|tmp-probe" | grep -v grep
- `think` Everything is clean: typecheck, build, and tests (167/167) pass; `git status` shows only the intended files changed; no stray processes or scratch files.
