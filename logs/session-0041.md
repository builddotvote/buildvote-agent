# Session 41: Rug radar: live launch scoring

- Started: 2026-10-10T09:47:11Z
- Ended: 2026-10-10T10:08:24Z
- Steps: 54
- Model turns: 55
- Billing: Claude subscription (API value $3.3364, not billed)
- Outcome: ok

## Summary

Clean — only the intended files changed, no stray scratch files, no leftover processes. Build, typecheck, and the full 163/163 test suite are all green.  ## Session 41 summary  Picked up session 40's open item: measure bundled-buys' RPC call cost the same way session 40 measured deployer-history's. Live-probed the real `fetchBundledBuysInput` against 12 real pump.fun launches (public mainnet-beta, no keys) and found its outer bonding-curve scan regularly reaches toward its 50-signature cap (saw 20, 25, even a full 50/50), and the resulting concurrent `getTransaction` calls hit HTTP 429 on **9…

## Steps

- `run` echo "--- TASK.md ---" && cat TASK.md && echo "--- PROGRESS.md ---" && cat PROGRESS.md 2>/dev/null && echo "--- repo tree ---" && find . -maxdepth 2 -not -path './.git*' | sort
- `read` PROGRESS.md
- `read` PROGRESS.md
- `read` PROGRESS.md
- `run` cd /home/runner/work/buildvote-agent/buildvote-agent/rug-radar && ls && git status && git log --oneline -5
- `run` npm install --silent 2>&1 | tail -20 && npm run typecheck 2>&1 | tail -20 && npm test 2>&1 | tail -40
- `run` cat src/data/bundledBuys.ts
- `run` cd /home/runner/work/buildvote-agent/buildvota-agent 2>/dev/null; sed -n '1,400p' README.md | grep -n "Known limitations"
- `run` sed -n '380,520p' README.md
- `run` cat src/config.ts
- `run` sed -n '1,80p' src/wsDiscovery.ts
- `run` grep -n "class LaunchWatcher\|constructor\|export class SolanaRpcClient\|bondingCurve\b" src/wsDiscovery.ts | head -30; echo ---; grep -n "class SolanaRpcClient\|constructor(" src/rpc.ts
- `run` sed -n '125,180p' src/rpc.ts; echo ---watcher---; sed -n '129,160p' src/wsDiscovery.ts
- `run` sed -n '1,260p' src/rpc.ts
- `run` grep -n "interface DiscoveredLaunch" -A 10 src/discovery.ts
- `think` Good, now I have everything needed. Let me first update PROGRESS.md to log the start of this session, then write and run the probe.
- `edit` PROGRESS.md
- `think` Now let me write the instrumented probe.
- `edit` rug-radar/tmp-probe-bundledbuys-calls.ts
- `run` cat package.json | grep -A3 '"scripts"'
- `run` NODE_OPTIONS=--experimental-websocket timeout 280 npx tsx tmp-probe-bundledbuys-calls.ts 2>&1 | tail -150
- `run` pkill -f tmp-probe-bundledbuys-calls 2>/dev/null; echo done
- `edit` rug-radar/tmp-probe-bundledbuys-calls.ts
- `edit` rug-radar/tmp-probe-bundledbuys-calls.ts
- `read` rug-radar/tmp-probe-bundledbuys-calls.ts
- `edit` rug-radar/tmp-probe-bundledbuys-calls.ts
- `edit` rug-radar/tmp-probe-bundledbuys-calls.ts
- `edit` rug-radar/tmp-probe-bundledbuys-calls.ts
- `think` Now run it with output redirected to a file so partial progress survives even if the overall command gets cut off.
- `run` rm -f /tmp/probe41.log && (NODE_OPTIONS=--experimental-websocket npx tsx tmp-probe-bundledbuys-calls.ts > /tmp/probe41.log 2>&1; echo "EXIT:$?" >> /tmp/probe41.log) & echo "started pid $!"
- `run` sleep 130; cat /tmp/probe41.log
- `run` until grep -q "^EXIT:" /tmp/probe41.log 2>/dev/null; do sleep 3; done; echo "probe finished"
- `run` cat /tmp/probe41.log
- `edit` rug-radar/tmp-probe-bundledbuys-calls.ts
- `edit` rug-radar/tmp-probe-bundledbuys-calls.ts
- `run` rm -f /tmp/probe41.log && (NODE_OPTIONS=--experimental-websocket npx tsx tmp-probe-bundledbuys-calls.ts > /tmp/probe41.log 2>&1; echo "EXIT:$?" >> /tmp/probe41.log) & echo "started pid $!"
- `run` until grep -q "^EXIT:" /tmp/probe41.log 2>/dev/null; do sleep 5; done; echo "probe finished"
- `run` cat /tmp/probe41.log
- `read` rug-radar/src/data/bundledBuys.ts
- `edit` rug-radar/src/data/bundledBuys.ts
- `think` Now let's run the test suite and typecheck to make sure nothing broke.
- `run` npm run typecheck 2>&1 | tail -20 && npm test 2>&1 | tail -20
- `think` Clean — 163/163 pass, no test hardcoded the old default. Now let's re-run the probe with the new default to see the live effect.
- `edit` rug-radar/tmp-probe-bundledbuys-calls.ts
- `run` rm -f /tmp/probe41b.log && (NODE_OPTIONS=--experimental-websocket npx tsx tmp-probe-bundledbuys-calls.ts > /tmp/probe41b.log 2>&1; echo "EXIT:$?" >> /tmp/probe41b.log) & echo "started pid $!"
- `run` until grep -q "^EXIT:" /tmp/probe41b.log 2>/dev/null; do sleep 5; done; echo "probe finished"
- `run` grep -E "^(discovered .*|---|.*: outerScanSize|.*: [0-9]+ms|getSignaturesForAddress:|getTransaction:|EXIT)" /tmp/probe41b.log | grep -v "^discovered"
- `run` rm -f tmp-probe-bundledbuys-calls.ts && rm -f /tmp/probe41.log /tmp/probe41b.log && ps aux | grep -i tsx | grep -v grep
- `think` Good, probe deleted and no leftover processes. Now let's update the README's "Known limitations" and bundled-buys signal description.
- `run` grep -n "Bundled buys" README.md | head -10
- `read` rug-radar/README.md
- `edit` rug-radar/README.md
- `edit` rug-radar/README.md
- `think` Now let's add the detailed finding to "Known limitations" at the end of the existing top entry (session 40's writeup).
- `run` grep -n "Session 40\|session 40" README.md
- `read` rug-radar/README.md
- `read` rug-radar/README.md
- `think` Now I'll insert a Session 41 continuation right after the session 40 paragraph (line 592).
- `edit` rug-radar/README.md
- `think` Now let's update PROGRESS.md with the full session 41 writeup, replacing the "in progress" marker.
- `edit` PROGRESS.md
- `think` Now let's add the "Works" and "Next" sections for this session.
- `edit` PROGRESS.md
- `think` Let's do final verification: typecheck, tests, build, and git status.
- `run` npm run typecheck 2>&1 | tail -5 && npm run build 2>&1 | tail -10 && npm test 2>&1 | tail -8 && echo "---git status---" && cd .. && git status
- `think` Clean — only the intended files changed, no stray scratch files, no leftover processes. Build, typecheck, and the full 163/163 test suite are all green.
