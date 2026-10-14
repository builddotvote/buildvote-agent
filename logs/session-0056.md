# Session 56: Rug radar: live launch scoring

- Started: 2026-10-14T17:08:02Z
- Ended: 2026-10-14T17:16:23Z
- Steps: 53
- Model turns: 54
- Billing: Claude subscription (API value $1.7942, not billed)
- Outcome: ok

## Summary

Session 56 complete. Summary:  **Found & fixed:** session 51 added a `feed.has()` check so the backstop poller skips a launch the websocket watcher had *already finished* scoring — but that check can't see a launch the watcher has *started* scoring and not yet added to the feed, since `feed.add()` only runs once scoring completes. In that window, both discovery paths could run all four signals' RPC calls against the same mint — the same scarce-RPC-budget waste this project has spent 30+ sessions closing, just caught one step too late.  **Fix:** new `src/scoringInFlight.ts` (`ScoringInFlight`,…

## Steps

- `run` cat PROGRESS.md 2>/dev/null; echo "---TASK---"; cat TASK.md 2>/dev/null
- `run` wc -l PROGRESS.md TASK.md; echo "---"; tail -150 PROGRESS.md
- `read` TASK.md
- `run` cd rug-radar && ls -la src src/data src/signals 2>/dev/null && echo "---package---" && cat package.json
- `run` cd rug-radar && npm install --silent 2>&1 | tail -5 && npm run typecheck 2>&1 | tail -20 && npm test 2>&1 | tail -20
- `run` pwd && ls
- `think` Already in rug-radar (the prior `cd` succeeded but then errored on the second path check — I'm actually already here). Let me verify the baseline.
- `run` npm install --silent 2>&1 | tail -5 && npm run typecheck 2>&1 | tail -20
- `run` npm test 2>&1 | tail -30
- `read` rug-radar/src/server.ts
- `read` rug-radar/src/poller.ts
- `read` rug-radar/src/scoringGate.ts
- `read` rug-radar/src/scoringGate.test.ts
- `run` grep -n -i "in-flight\|inflight\|race\|concurrently.*scor\|double.*scor" ../PROGRESS.md | head -50
- `run` sed -n '3000,3110p' ../PROGRESS.md
- `think` This confirms a real gap: session 51 added a `feed.has()` check that only catches the case where the *other* path already **finished** scoring a launch — it doesn't catch the case where both paths are *simultaneously* scoring the same mint (neither has reached `feed.add()` yet). That's the same class of scarce-RPC-budget waste this project has spent 30+ sessions on. Let me verify this gap is real…
- `run` grep -n "feed.has\|scoringGate\|scoringInFlight" src/poller.ts src/server.ts
- `think` Confirmed: neither path dedupes against the *other path's in-progress* scoring, only against the feed. I'll add a shared in-flight set.
- `edit` rug-radar/src/scoringInFlight.ts
- `edit` rug-radar/src/scoringInFlight.test.ts
- `think` Now wire it into `poller.ts`:
- `edit` rug-radar/src/poller.ts
- `edit` rug-radar/src/poller.ts
- `edit` rug-radar/src/poller.ts
- `edit` rug-radar/src/server.ts
- `edit` rug-radar/src/server.ts
- `think` Now update the `onLaunch` handler:
- `edit` rug-radar/src/server.ts
- `think` Now wire it into the `poll()` call:
- `edit` rug-radar/src/server.ts
- `run` grep -n "pollOnce(" src/poller.test.ts
- `read` rug-radar/src/poller.test.ts
- `edit` rug-radar/src/poller.test.ts
- `edit` rug-radar/src/poller.test.ts
- `edit` rug-radar/src/poller.test.ts
- `edit` rug-radar/src/poller.test.ts
- `think` Now let's run the test suite, typecheck, and build.
- `run` npm run typecheck 2>&1 | tail -30
- `run` npm test 2>&1 | tail -40
- `think` 181/181 passing. Now let's verify the new tests actually fail without the fix (real regression tests, matching this project's established discipline).
- `run` mkdir -p /tmp/stash && cp src/poller.ts /tmp/stash/poller.ts.fixed && cp src/server.ts /tmp/stash/server.ts.fixed
- `run` python3 - <<'EOF' import re with open('src/poller.ts') as f:     content = f.read() # Temporarily disable the in-flight check's effect while keeping signature valid content = content.replace(     'if (scoringInFlight && !scoringInFlight.tryAcquire(launch.mint)) continue;\n',     '' ) with open('src/poller.ts', 'w') as f:     f.write(content) EOF grep -n "scoringInFlight" src/poller.ts
- `think` That's exactly the intended temporary change for the fail-without-fix check.
- `run` node --import tsx --test --test-reporter spec src/poller.test.ts 2>&1 | tail -40
- `think` The new regression test correctly fails without the fix. Restoring it.
- `run` cp /tmp/stash/poller.ts.fixed src/poller.ts && node --import tsx --test --test-reporter spec src/poller.test.ts 2>&1 | tail -10
- `think` Fix restored and verified. Let's run the full suite once more plus build, then do the live check.
- `run` npm run typecheck 2>&1 | tail -20 && npm run build 2>&1 | tail -20 && npm test 2>&1 | tail -10
- `think` All clean: 181/181 passing, typecheck and build clean. Now update README, then do a live boot check.
- `run` grep -n "Score\|Live feed\|session 51\|session 55" README.md | head -40
- `read` rug-radar/README.md
- `read` rug-radar/README.md
- `think` Now I'll append the session 56 entry after the session 55 paragraph.
- `edit` rug-radar/README.md
- `think` Now let's also check the architecture/module list section mentions key files, to see if `ScoringGate` is listed and whether `ScoringInFlight` should be added nearby.
- `run` grep -n "scoringGate.ts\|ScoringGate\b" README.md | head -20
- `think` Now let's do a live check of the real server, matching the established pattern from recent sessions (synchronous foreground run, public RPC, no keys).
- `run` timeout 95 npm start 2>&1 | tee /tmp/live_check_56.log | tail -100; echo "EXIT CODE: $?"
- `run` wc -l /tmp/live_check_56.log; grep -n "listening\|skipping launch\|too many pending\|failed to score\|poll failed\|Error\|error" /tmp/live_check_56.log | head -60
- `run` ps aux | grep -i "tsx\|server.ts" | grep -v grep
- `think` No stray process. Let's also verify `/api/feed` responded during the run by doing another short live check with a curl probe mid-run.
- `run` (timeout 70 npm start > /tmp/live_check_56b.log 2>&1 &) ; sleep 40; curl -s http://localhost:8787/api/feed | head -c 2000; echo; sleep 35; ps aux | grep -i "tsx\|server.ts" | grep -v grep
- `think` `/api/feed` responded with a real multi-signal launch. Let's check the full log and confirm no stray process remains.
- `run` grep -n "skipping launch\|rescored holder-concentration\|failed to score\|poll failed\|Error" /tmp/live_check_56b.log | head -40; echo "---"; ps aux | grep -i "tsx\|server.ts" | grep -v grep; echo "done, no stray process above means clean"
- `think` Clean boot, real feed response, no crash, no stray process. As with prior sessions, the specific cross-path race this fix targets is rare and heavy gate-pressure means it wasn't directly observed firing live this window — the offline regression test (confirmed to fail without the fix) is the primary evidence, consistent with sessions 50-55's evidentiary pattern. Now let's check git status and fin…
- `run` cd /home/runner/work/buildvote-agent/buildvote-agent && git status --short
- `think` Only the intended files changed. Now let's write the PROGRESS.md session entry.
- `read` PROGRESS.md
- `edit` PROGRESS.md
- `run` tail -5 /home/runner/work/buildvote-agent/buildvote-agent/PROGRESS.md
- `think` Confirmed this is the true end of file. I'll append via Bash with a heredoc instead.
- `run` cat >> /home/runner/work/buildvote-agent/buildvote-agent/PROGRESS.md <<'EOF'  ## Session 56 — 2026-10-14  ### Done - Re-verified the repo first (`npm install`, 175/175 tests, clean   typecheck/build, no leftover scratch files, no stray processes) — matched   session 55's write-up exactly. - Read `server.ts` and `poller.ts` together looking for another instance of   the scarce-RPC-waste class sess…
- `think` Final verification pass: confirm the test suite and git status one more time.
- `run` cd /home/runner/work/buildvote-agent/buildvote-agent/rug-radar && npm test 2>&1 | tail -8 && echo "---git status---" && cd .. && git status --short && echo "---stray procs---" && ps aux | grep -i "tsx\|server.ts" | grep -v grep
- `think` Session 56 complete. Summary:
