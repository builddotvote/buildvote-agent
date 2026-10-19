# Session 79: Rug radar: live launch scoring

- Started: 2026-10-19T20:34:44Z
- Ended: 2026-10-19T20:44:10Z
- Steps: 57
- Model turns: 58
- Billing: Claude subscription (API value $2.4418, not billed)
- Outcome: ok

## Summary

Clean diff — only the intended files changed. Session complete (not committing/pushing, per project rules — the runner handles that).  ## Summary  Found and fixed a real race-condition bug in `rug-radar/src/wsDiscovery.ts`'s `trackMint`/`untrackMint` pair: if `untrackMint(mint)` was called before its `logsSubscribe` ack arrived, the ack handler would unconditionally resurrect the mint into the routing tables, making `onTrade` fire again for a mint the caller had explicitly untracked, and leaking the stray subscription (never unsubscribed) for the rest of the connection. Confirmed live with a …

## Steps

- `run` cat TASK.md 2>/dev/null; echo "---PROGRESS---"; cat PROGRESS.md 2>/dev/null
- `read` PROGRESS.md
- `run` wc -l PROGRESS.md; echo "---"; tail -n 200 PROGRESS.md
- `run` cat /home/runner/.claude/projects/-home-runner-work-buildvote-agent-buildvote-agent/memory/MEMORY.md 2>/dev/null
- `run` ls -la /home/runner/.claude/projects/-home-runner-work-buildvote-agent-buildvote-agent/memory/ 2>&1
- `run` cd /home/runner/work/buildvote-agent/buildvote-agent/rug-radar && git status && ls
- `run` npm install --silent 2>&1 | tail -20 && npm run typecheck 2>&1 | tail -30 && npm test 2>&1 | tail -40
- `think` Good, confirmed clean baseline: 221/221 tests pass, typecheck clean. Now let me look for a fresh angle, since sessions 1-78 have exhausted many obvious review paths. Let me explore files not mentioned as recently re-audited.
- `run` find src -name "*.ts" | grep -v test | sort
- `run` cd /home/runner/work/buildvote-agent/buildvote-agent && grep -n "balanceIndex\|holderRescore\.ts\|requestHandler\.ts\|rescore\.ts\|wsDiscovery\.ts\|wsLogParser\.ts" PROGRESS.md | tail -60
- `run` grep -n "browser\|screenshot\|puppeteer\|playwright" PROGRESS.md | tail -30
- `run` cd /home/runner/work/buildvote-agent/buildvote-agent/rug-radar && cat package.json && cat README.md | head -80
- `run` grep -n "Known limitations" -A 60 README.md | head -90
- `run` grep -n "^## Known limitations" README.md
- `run` grep -n "^##" README.md
- `read` rug-radar/README.md
- `run` for f in src/signals/liquidity.ts src/signals/holderConcentration.ts src/signals/deployerHistory.ts src/signals/bundledBuys.ts; do echo "=== $f ==="; cat "$f"; echo; done
- `run` cat src/balanceIndex.ts
- `run` cat src/rescore.ts; echo "=== holderRescore.ts ==="; cat src/holderRescore.ts
- `run` cat src/pumpfun.ts
- `run` cat src/data/bondingCurve.ts
- `run` cat src/data/deployerHistory.ts; echo "=== bundledBuys data ==="; cat src/data/bundledBuys.ts
- `run` cat src/scorer.ts
- `run` cat src/feed.ts; echo "=== scoringGate ==="; cat src/scoringGate.ts; echo "=== scoringInFlight ==="; cat src/scoringInFlight.ts
- `run` cat src/watcherOnLaunch.ts; echo "=== poller ==="; cat src/poller.ts
- `run` cat src/deployerIndex.ts
- `run` cat src/pipeline.ts
- `run` cat src/data/holderConcentration.ts; echo "=== liquidity ==="; cat src/data/liquidity.ts
- `run` cat src/rpc.ts
- `run` cat src/wsLogParser.ts
- `run` cat src/wsDiscovery.ts
- `run` grep -n "untrackMint\|trackMint" src/wsDiscovery.test.ts | head -60
- `run` cat > /tmp/probe-race.ts << 'EOF' import { LaunchWatcher } from "./src/wsDiscovery.js";  let sentMessages: string[] = []; const fakeWs: any = {   onopen: null, onmessage: null, onclose: null, onerror: null,   send(data: string) { sentMessages.push(data); },   close() {}, };  const watcher = new LaunchWatcher("http://fake", {} as any, {   onLaunch: () => {},   onTrade: (t) => console.log("onTrade …
- `think` Needs to be run from inside rug-radar with relative path. Let me place it in that directory as a tmp file (deleting before finishing, matching project convention).
- `run` cat > tmp-probe-race.ts << 'EOF' import { LaunchWatcher } from "./src/wsDiscovery.js";  let sentMessages: string[] = []; const fakeWs: any = {   onopen: null, onmessage: null, onclose: null, onerror: null,   send(data: string) { sentMessages.push(data); },   close() {}, };  const watcher = new LaunchWatcher("http://fake", {} as any, {   onLaunch: () => {},   onTrade: (t) => console.log("onTrade f…
- `run` cat > tmp-probe-race.ts << 'EOF' import { LaunchWatcher } from "./src/wsDiscovery.js";  let sentMessages: string[] = []; const fakeWs: any = {   onopen: null, onmessage: null, onclose: null, onerror: null,   send(data: string) { sentMessages.push(data); },   close() {}, };  const fakeRpc: any = {   getTransaction: async () => {     console.log(">>> getTransaction called — mint subscription resurr…
- `run` timeout 20 node --import tsx tmp-probe-race.ts; echo "EXIT CODE: $?"
- `run` cat > tmp-probe-race.ts << 'EOF' import { LaunchWatcher } from "./src/wsDiscovery.js";  const fakeWs: any = {   onopen: null, onmessage: null, onclose: null, onerror: null,   send(data: string) { console.log("WS SEND:", data); },   close() {}, };  const fakeRpc: any = {   getTransaction: async () => {     console.log(">>> getTransaction called");     return null;   }, };  const watcher: any = new…
- `run` sed -i 's/logs: \["Program log: Instruction: Buy"\]/logs: ["Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P invoke [1]", "Program log: Instruction: Buy", "Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P success"]/' tmp-probe-race.ts timeout 20 node --import tsx tmp-probe-race.ts
- `run` cd /home/runner/work/buildvote-agent/buildvote-agent && grep -n "pendingRequests\|ack.*untrack\|untrack.*ack\|resurrect" PROGRESS.md
- `think` This is a genuinely new, previously unflagged bug. Let me check that line of context, then fix it properly.
- `run` sed -n '1815,1835p' PROGRESS.md
- `think` Unrelated to this specific race. Now let's fix the bug: `untrackMint` needs to clean up any still-pending subscribe request for that mint, and the ack handler must check whether a mint is still tracked before resurrecting it into the subscription maps.
- `read` rug-radar/src/wsDiscovery.test.ts
- `read` rug-radar/src/wsDiscovery.ts
- `run` cd /home/runner/work/buildvote-agent/buildvote-agent/rug-radar && grep -n "isSubscribeAck(msg)" -A 12 src/wsDiscovery.ts
- `edit` rug-radar/src/wsDiscovery.ts
- `think` Now let's also clean up `pendingRequests` in `untrackMint` for clarity, but actually the above handles it fine since the ack handler checks `trackedMints`. Let's verify the fix with the probe script, then add a regression test and clean up.
- `run` timeout 20 node --import tsx tmp-probe-race.ts
- `think` Confirmed fixed: the late ack now triggers a `logsUnsubscribe` for the stray subscription and no longer resurrects the untracked mint — `onTrade`/`getTransaction` no longer fire. Let me clean up the probe file and add a proper regression test.
- `run` rm tmp-probe-race.ts
- `run` sed -n '1,90p' src/wsDiscovery.test.ts
- `think` Now let's add the regression test right after the existing "untrackMint" test (line 578).
- `read` rug-radar/src/wsDiscovery.test.ts
- `edit` rug-radar/src/wsDiscovery.test.ts
- `think` Now let's run the full test suite, typecheck, and build.
- `run` npm run typecheck 2>&1 | tail -20 && npm test 2>&1 | tail -15
- `think` 222/222 passing, typecheck clean. Let's confirm the new test specifically and run build too.
- `run` npm run build 2>&1 | tail -10 && npm test 2>&1 | grep -i "untrackMint before"
- `think` Now let's revert my fix temporarily to confirm the new test actually catches the bug (not a false-positive test).
- `run` git stash && node --import tsx --test --test-reporter spec src/wsDiscovery.test.ts 2>&1 | grep -A 15 "untrackMint before"; git stash pop
- `run` git diff src/wsDiscovery.ts > /tmp/fix.patch && git checkout -- src/wsDiscovery.ts && node --import tsx --test --test-reporter spec src/wsDiscovery.test.ts 2>&1 | grep -B2 -A 15 "untrackMint before"
- `think` Confirmed: the test fails without the fix (ws.sent[2] is undefined — no logsUnsubscribe is ever sent), and passes with it. Restoring the fix.
- `run` git apply /tmp/fix.patch && npm test 2>&1 | tail -10
- `think` All 222 tests pass with the fix restored, typecheck/build clean. Now let me check `git status` and update PROGRESS.md.
- `run` git status
- `think` Only the intended files changed. Now let's update PROGRESS.md with session 79's notes.
- `run` cd /home/runner/work/buildvote-agent/buildvote-agent && tail -5 PROGRESS.md
- `run` cat >> /home/runner/work/buildvote-agent/buildvote-agent/PROGRESS.md << 'EOF'  ## Session 79 — 2026-10-19  ### Done - Re-verified the repo first: `npm install`, 221/221 tests, clean   typecheck/build, `git status` clean before starting. - Read through the signal scorers (`liquidity.ts`, `holderConcentration.ts`,   `deployerHistory.ts`, `bundledBuys.ts`) re-deriving each one's share/ratio   math f…
- `think` Let's do a final sanity check: full test suite, typecheck, build, and git status.
- `run` cd /home/runner/work/buildvote-agent/buildvote-agent/rug-radar && npm run typecheck 2>&1 | tail -5 && npm run build 2>&1 | tail -5 && npm test 2>&1 | tail -10 && cd .. && git status
- `think` Clean diff — only the intended files changed. Session complete (not committing/pushing, per project rules — the runner handles that).
