# Session 51: Rug radar: live launch scoring

- Started: 2026-10-13T10:31:45Z
- Ended: 2026-10-13T10:42:50Z
- Steps: 51
- Model turns: 52
- Billing: Claude subscription (API value $2.1489, not billed)
- Outcome: ok

## Summary

Clean: typecheck, build, and all 170 tests pass; only the intended files are modified, no stray scratch files or leftover processes.  ## Summary  This session found and fixed a real bug in the backstop poller rather than re-probing the three already-exhausted rate-limit avenues (alternative RPC endpoints, non-RPC public APIs, `getProgramAccounts`).  **Bug:** `src/poller.ts`'s `pollOnce` never checked `feed.has(launch.mint)` before scoring, even though the README documented that dedup as existing precisely to avoid double-scoring. Since the websocket watcher and backstop poller run concurrentl…

## Steps

- `think` I'll start by reading TASK.md and PROGRESS.md to see what's expected this session.
- `run` cat TASK.md 2>/dev/null; echo "---PROGRESS---"; cat PROGRESS.md 2>/dev/null
- `read` PROGRESS.md
- `read` PROGRESS.md
- `run` git status && git log --oneline -5 && ls rug-radar
- `think` Good, clean state. Let me verify the repo builds/tests cleanly before deciding what to work on this session.
- `run` cd rug-radar && npm install --silent 2>&1 | tail -20 && npm run typecheck 2>&1 | tail -30 && npm test 2>&1 | tail -40
- `think` Tests and build are clean (169/169). Rather than re-probing the three already-exhausted rate-limit avenues, I'll look for new correctness issues by reading the code closely, the way Session 50 found the zero-signals bug.
- `run` cd rug-radar/src && wc -l *.ts signals/*.ts data/*.ts | sort -n
- `run` cd /home/runner/work/buildvote-agent/buildvote-agent/rug-radar/src && wc -l *.ts signals/*.ts data/*.ts 2>/dev/null | sort -n
- `read` rug-radar/src/feed.ts
- `run` grep -n "feed.has\|\.has(" server.ts poller.ts pipeline.ts
- `run` grep -n "\.has(" *.ts
- `read` rug-radar/src/server.ts
- `read` rug-radar/src/poller.ts
- `run` cd /home/runner/work/buildvote-agent/buildvote-agent/rug-radar && grep -n "feed.has\|duplicate\|both discovery\|backstop" README.md | head -40
- `read` rug-radar/README.md
- `run` grep -n "has\|already" src/poller.test.ts
- `run` git log --oneline -- rug-radar/src/poller.ts | head -20
- `run` cd /home/runner/work/buildvote-agent/buildvote-agent && git log --oneline -- rug-radar/src/poller.ts
- `run` git log --oneline | wc -l && git log --oneline | head -20
- `run` cd /home/runner/work/buildvote-agent/buildvote-agent/rug-radar && grep -n "pollOnce\|setInterval\|POLL" src/server.ts
- `read` rug-radar/src/poller.test.ts
- `think` Good, this confirms it: no test covers the already-in-feed case, and I can add one mirroring the gate tests. Let me check `scoreLaunch`/`pipeline.ts` briefly to confirm it makes real RPC calls that would be wasted.
- `read` rug-radar/src/pipeline.ts
- `think` This confirms a real, costly bug: `pollOnce` never checks `feed.has(launch.mint)` before re-scoring a launch, even though the README documents that dedup as existing precisely to avoid wasting the scarce, rate-limited scoring RPC. Since the watcher and backstop poller run concurrently and the poller's watermark is time-based (not feed-based), any launch the watcher already scored in the last 15s …
- `edit` rug-radar/src/poller.ts
- `think` Now let's add a regression test, following the existing pattern in `poller.test.ts`.
- `edit` rug-radar/src/poller.test.ts
- `run` npm run typecheck 2>&1 | tail -30
- `think` Typecheck clean. Now run the tests.
- `run` npm test 2>&1 | tail -50
- `think` 170/170 passing. Let me verify this is a genuine regression test by temporarily reverting the fix.
- `run` cd src && cp poller.ts /tmp/poller.ts.fixed && python3 - <<'EOF' import re with open('poller.ts') as f:     content = f.read() content = content.replace( '''    // The watcher runs concurrently and can have already scored this exact     // launch within the same window findNewLaunches just rescanned (its     // cursor is time-based, not feed-based) — without this check every such     // overlap r…
- `run` cd /home/runner/work/buildvote-agent/buildvote-agent/rug-radar && npm test 2>&1 | grep -A3 "already in the feed" ; npm test 2>&1 | tail -8
- `think` Confirmed as a real regression test (fails without the fix, 1 call instead of 0). Now restore the fix.
- `run` cp /tmp/poller.ts.fixed /home/runner/work/buildvote-agent/buildvote-agent/rug-radar/src/poller.ts && npm test 2>&1 | tail -8 && npm run typecheck 2>&1 | tail -10 && npm run build 2>&1 | tail -10
- `think` All clean: 170/170 tests, typecheck, and build. Now let's live-verify the fix doesn't break the real pipeline, synchronously in the foreground per this project's established rule.
- `run` (timeout 100 npm start > /tmp/live-session51.log 2>&1 &) ; sleep 100; curl -s http://localhost:3000/api/feed | head -c 2000; echo; echo "---LOG TAIL---"; tail -n 60 /tmp/live-session51.log; echo "---PS---"; ps aux | grep -i "node\|tsx" | grep -v grep
- `run` grep -n "PORT\|port" src/config.ts | head
- `think` Right port is 8787. Let me rerun with correct curl and capture `/api/feed` while it's running this time.
- `run` (timeout 100 npm start > /tmp/live-session51b.log 2>&1 &) ; sleep 90; curl -s http://localhost:8787/api/feed | head -c 3000; echo; sleep 15; echo "---LOG TAIL---"; tail -n 80 /tmp/live-session51b.log; echo "---PS---"; ps aux | grep -i "tsx\|server.ts" | grep -v grep
- `run` (timeout 130 npm start > /tmp/live-session51c.log 2>&1 &) ; sleep 120; curl -s http://localhost:8787/api/feed | head -c 3000; echo; sleep 15; echo "---LOG TAIL---"; cat /tmp/live-session51c.log; echo "---PS---"; ps aux | grep -i "tsx\|server.ts" | grep -v grep
- `run` ps aux | grep -i "tsx\|server.ts" | grep -v grep; cat /tmp/live-session51c.log 2>/dev/null | tail -50
- `run` date; ps aux | grep -i "tsx\|server.ts" | grep -v grep
- `run` sleep 5; ps aux | grep -i "tsx\|server.ts" | grep -v grep
- `think` Process has ended on its own. Let's check the full log and confirm the feed state, then clean up.
- `run` cat /tmp/live-session51c.log | tail -5; echo "---"; grep -c "too many pending scores" /tmp/live-session51c.log; grep -c "landed\|dropping launch" /tmp/live-session51*.log; git status; rm -f /tmp/live-session51*.log /tmp/poller.ts.fixed
- `think` Now let's update the README section that describes this dedup behavior, since it previously documented behavior that wasn't actually implemented.
- `run` grep -n "feed.ts\|only scores once\|zero signals\|dropping launch" README.md
- `read` rug-radar/README.md
- `think` Now let's add a note right after this paragraph about this session's fix, and fix the line-362 claim.
- `edit` rug-radar/README.md
- `think` Now fix the inaccurate claim at line ~362 (now shifted).
- `run` grep -n "only scores once" README.md
- `read` rug-radar/README.md
- `think` This already reads correctly as the intended design — it's accurate now that the fix exists (it's describing design intent, and the earlier new paragraph explains the gap that existed before). That's fine as-is. Now let's update PROGRESS.md with Session 51.
- `edit` PROGRESS.md
- `run` grep -n "^## Session" /home/runner/work/buildvote-agent/buildvote-agent/PROGRESS.md | tail -5
- `think` I placed Session 51 before Session 50 — wrong order. Let me fix by moving it to the end of the file.
- `read` PROGRESS.md
- `think` I'll cut this block and move it to the end of the file, after Session 50.
- `edit` PROGRESS.md
- `think` Now append Session 51 after Session 50's content, at the true end of the file.
- `read` PROGRESS.md
- `run` tail -15 /home/runner/work/buildvote-agent/buildvote-agent/PROGRESS.md
- `think` Good, that confirms the actual end of file is Session 50's content. Now append Session 51.
- `edit` PROGRESS.md
- `run` tail -20 /home/runner/work/buildvote-agent/buildvote-agent/PROGRESS.md
- `think` I'll use `Write` to append directly since this content is at the literal end of the file and unique context via Edit is awkward with duplicated boilerplate.
- `run` cat >> /home/runner/work/buildvote-agent/buildvote-agent/PROGRESS.md <<'ENDOFSESSION'  ## Session 51 — 2026-10-13  ### Done - Re-verified the repo first (`npm install`, 169/169 tests, clean   typecheck/build, no leftover scratch files) — matched session 50's   write-up exactly. - Rather than re-trying one of the three already-exhausted rate-limit   avenues (alternative RPC endpoints, non-RPC publ…
- `think` Order is now correct. Let's do a final sanity pass: confirm tests/typecheck/build are clean, and check git status for any stray files.
- `run` npm run typecheck 2>&1 | tail -5 && npm run build 2>&1 | tail -5 && npm test 2>&1 | tail -8 && echo "---GIT STATUS---" && cd /home/runner/work/buildvote-agent/buildvote-agent && git status
- `think` Clean: typecheck, build, and all 170 tests pass; only the intended files are modified, no stray scratch files or leftover processes.
