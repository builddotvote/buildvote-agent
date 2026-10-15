# Session 58: Rug radar: live launch scoring

- Started: 2026-10-15T04:34:35Z
- Ended: 2026-10-15T04:42:23Z
- Steps: 54
- Model turns: 55
- Billing: Claude subscription (API value $2.1081, not billed)
- Outcome: ok

## Summary

Session 58 complete. Summary:  - Extracted the websocket watcher's inline `onLaunch` closure in `server.ts` into a standalone, testable function `handleDiscoveredLaunch` in new `src/watcherOnLaunch.ts` — pure refactor, no behavior change. This closes a long-standing gap: `poller.ts`'s equivalent logic (`pollOnce`) was deliberately made its own function for testability, but the watcher side never got the same treatment. - Added `src/watcherOnLaunch.test.ts` with 7 offline tests covering dedup, gate-full, in-flight-claim skips, release-after-success/failure, and `onScored` firing only when a la…

## Steps

- `run` cat PROGRESS.md 2>/dev/null; echo "---TASK---"; cat TASK.md 2>/dev/null
- `run` wc -l PROGRESS.md TASK.md
- `read` TASK.md
- `think` Now let me see the most recent progress session to know exactly where things left off.
- `run` tail -n 250 PROGRESS.md
- `run` git status && git log --oneline -5 && ls rug-radar/src
- `think` Let me check memory for any relevant feedback from prior sessions before diving in.
- `run` cat /home/runner/.claude/projects/-home-runner-work-buildvote-agent-buildvote-agent/memory/MEMORY.md 2>/dev/null
- `run` ls -la /home/runner/.claude/projects/-home-runner-work-buildvote-agent-buildvote-agent/memory/ 2>&1
- `think` No memory yet for this project. Let me verify the repo state first, matching the pattern from previous sessions.
- `run` cd rug-radar && npm install --silent 2>&1 | tail -20
- `run` cd rug-radar && npm test 2>&1 | tail -30
- `run` pwd; ls
- `run` npm test 2>&1 | tail -30 && npm run typecheck 2>&1 | tail -20 && npm run build 2>&1 | tail -20
- `run` wc -l src/server.ts src/poller.ts; echo ---; cat src/server.ts
- `read` rug-radar/src/poller.ts
- `run` cat src/scorer.ts; echo ===FEED===; cat src/feed.ts
- `run` ls src/signals src/data; echo ===; cat src/signals/*.ts | head -300
- `think` These signal modules look solid and well-tested. Let me check the remaining core modules not touched recently — discovery.ts, rescore.ts, balanceIndex.ts — for a genuine bug.
- `run` cat src/rescore.ts; echo ===BALANCEINDEX===; cat src/balanceIndex.ts
- `run` cat src/pipeline.ts | head -60
- `run` cat src/poller.test.ts
- `edit` rug-radar/src/watcherOnLaunch.ts
- `think` Now let's wire this into server.ts, replacing the inline closure.
- `edit` rug-radar/src/server.ts
- `read` rug-radar/src/server.ts
- `edit` rug-radar/src/server.ts
- `edit` rug-radar/src/server.ts
- `think` Now let's write the test file mirroring poller.test.ts's structure.
- `run` cat src/pipeline.test.ts | head -80
- `run` grep -n "onLaunch\|setImmediate\|await new Promise\|flushMicrotasks\|async function wait" src/wsDiscovery.test.ts | head -30
- `think` Good, there's an established `flushMicrotasks` helper pattern. I'll reuse that idea in the new test file.
- `edit` rug-radar/src/watcherOnLaunch.test.ts
- `run` sed -n '60,140p' src/pipeline.ts
- `think` I realize my "failed scoreLaunch" test doesn't actually exercise the `.catch()` branch since `scoreLaunch` never rejects (each signal is caught internally). Let me fix that test to accurately describe what it covers.
- `edit` rug-radar/src/watcherOnLaunch.test.ts
- `think` Now let's run the full test suite, typecheck, and build.
- `run` npm test 2>&1 | tail -40
- `think` All 187 pass (6 new). Now typecheck and build.
- `run` npm run typecheck 2>&1 | tail -20 && npm run build 2>&1 | tail -20
- `think` Clean. Let me verify the new regression tests actually catch regressions by confirming they fail if the extraction wiring breaks — same discipline as prior sessions.
- `run` cd src && cp watcherOnLaunch.ts /tmp/watcherOnLaunch.ts.bak && cd ..
- `edit` rug-radar/src/watcherOnLaunch.ts
- `run` node --test --test-name-pattern='already in the feed' dist/watcherOnLaunch.test.js 2>&1 | tail -20 || (npm run build >/dev/null 2>&1 && node --test --test-name-pattern='already in the feed' dist/watcherOnLaunch.test.js 2>&1 | tail -20)
- `run` cat package.json | grep -A3 '"test"'
- `run` node --import tsx --test --test-reporter spec --test-name-pattern='already in the feed' src/watcherOnLaunch.test.ts 2>&1 | tail -30
- `think` Confirmed: the test fails without the dedup check. Restoring the fix now.
- `run` cp /tmp/watcherOnLaunch.ts.bak src/watcherOnLaunch.ts && npm test 2>&1 | tail -10
- `think` Good, restore confirmed and all 187 tests pass again. Clean up the backup file.
- `run` rm -f /tmp/watcherOnLaunch.ts.bak && git status --short
- `think` Now let's do the live-boot check this session's pattern requires, confirming the server still runs correctly against the public RPC with no keys.
- `run` timeout 100 npm start > /tmp/server_out.log 2>&1 & SERVER_PID=$! echo "started pid $SERVER_PID" sleep 20 curl -s http://localhost:3000/api/feed | head -c 500 echo sleep 70 echo "---tail of log---" tail -60 /tmp/server_out.log
- `run` curl -s http://localhost:8787/api/feed | head -c 800; echo; echo "---ps---"; ps aux | grep -E "tsx|server.ts" | grep -v grep
- `run` sleep 15; tail -80 /tmp/server_out.log; echo "---ps after timeout---"; ps aux | grep -E "tsx|server.ts" | grep -v grep
- `run` cd /home/runner/work/buildvote-agent/buildvote-agent && git status --short && rm -f /tmp/server_out.log
- `think` Clean — only the intended files changed, no stray processes or scratch files. Now let's update the README to match the established pattern, then write up PROGRESS.md.
- `run` cd rug-radar && grep -n "watcher.*poller\|poller.*watcher\|Next:\|not been\|no automated test\|server.ts's watcher" README.md | tail -20
- `read` rug-radar/README.md
- `run` cd rug-radar && grep -n "wiring remains without\|without an automated test\|wiring.*test" README.md
- `run` pwd; grep -n "wiring remains\|server.ts's watcher\|without an automated" README.md
- `read` rug-radar/README.md
- `think` This is the right spot — right after session 57's note. Let me add a paragraph for this session's refactor.
- `edit` rug-radar/README.md
- `run` npm test 2>&1 | tail -8 && npm run typecheck 2>&1 | tail -5 && npm run build 2>&1 | tail -5 && git status --short
- `think` All green. Now let's write the PROGRESS.md entry for Session 58.
- `read` PROGRESS.md
- `edit` PROGRESS.md
- `edit` PROGRESS.md
- `run` cat >> /home/runner/work/buildvote-agent/buildvote-agent/PROGRESS.md << 'PROGRESS_EOF'  ## Session 58 — 2026-10-15  ### Done - Re-verified the repo first (`npm install`, 181/181 tests, clean   typecheck/build, no leftover scratch files, no stray processes) — matched   session 57's write-up exactly. - Read `server.ts`/`poller.ts` again looking for another RPC-waste bug in   the class sessions 50-5…
- `think` Let's do a final sanity check of the full diff and test suite before wrapping up.
- `run` cd /home/runner/work/buildvote-agent/buildvote-agent && git status --short && echo --- && git diff --stat
- `run` cd rug-radar && npm test 2>&1 | tail -8
- `think` Session 58 complete. Summary:
