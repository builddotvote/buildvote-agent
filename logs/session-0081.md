# Session 81: Rug radar: live launch scoring

- Started: 2026-10-20T08:28:56Z
- Ended: 2026-10-20T08:37:45Z
- Steps: 54
- Model turns: 55
- Billing: Claude subscription (API value $2.5555, not billed)
- Outcome: ok

## Summary

Everything is clean: typecheck/build pass, 226/226 tests pass, only the intended files changed, no stray scratch files or `.env`.  ## Summary  This session continued session 80's "next" pointer: giving `server.ts`'s wiring the same from-scratch re-derivation treatment `discovery.ts` got. Tracing how `server.ts` drives `poller.ts` via `setInterval(poll, 15000)` turned up a real bug: since `poll()` fires `pollOnce(...)` without awaiting it, overlapping ticks can run concurrently against the same shared `PollState`. Whichever call *finishes* last wins the final write to `sinceBlockTime` — includ…

## Steps

- `think` I'll start by reading TASK.md and PROGRESS.md to understand the current session's goal and prior progress.
- `run` cat TASK.md 2>/dev/null; echo "---PROGRESS---"; cat PROGRESS.md 2>/dev/null
- `read` PROGRESS.md
- `run` wc -l PROGRESS.md; echo "---"; grep -n "^## Session" PROGRESS.md | tail -30
- `think` Let me read the last session's entry to see the most recent status, next steps, and project state.
- `read` PROGRESS.md
- `run` cd rug-radar && ls -la src/ && echo "---" && git log --oneline -5 && echo "---status---" && git status
- `think` Now let me run the test suite first to confirm baseline, then do the from-scratch re-derivation of `server.ts`'s wiring as flagged by session 80's "next" notes.
- `run` cd rug-radar && npm install --silent 2>&1 | tail -5 && npm test 2>&1 | tail -20 && npm run typecheck 2>&1 | tail -20 && npm run build 2>&1 | tail -20
- `run` pwd && find / -maxdepth 4 -iname "rug-radar" -type d 2>/dev/null
- `run` pwd
- `run` npm install --silent 2>&1 | tail -5 && npm test 2>&1 | tail -25 && npm run typecheck 2>&1 | tail -20 && npm run build 2>&1 | tail -20
- `think` Baseline confirmed: 224/224 tests pass, clean typecheck/build. Now let's read `server.ts` in full to do the from-scratch re-derivation session 80 flagged as next.
- `read` rug-radar/src/server.ts
- `run` cd /home/runner/work/buildvote-agent/buildvote-agent && grep -n "server.ts" PROGRESS.md | tail -40
- `read` PROGRESS.md
- `read` rug-radar/src/watcherOnLaunch.ts
- `read` rug-radar/src/poller.ts
- `read` rug-radar/src/feed.ts
- `read` rug-radar/src/scoringGate.ts
- `read` rug-radar/src/scoringInFlight.ts
- `read` rug-radar/src/holderRescore.ts
- `read` rug-radar/src/deployerIndex.ts
- `read` rug-radar/src/pipeline.ts
- `read` rug-radar/src/wsDiscovery.ts
- `read` rug-radar/src/balanceIndex.ts
- `read` rug-radar/src/rescore.ts
- `run` grep -n -i "overlap\|concurrent poll\|setInterval(poll\|poll cycle" PROGRESS.md | head -40
- `read` PROGRESS.md
- `read` PROGRESS.md
- `run` grep -n "setInterval(poll\|poll().*overlap\|previous poll\|in-flight poll\|poll.*in flight\|guard against.*poll" PROGRESS.md
- `run` cd /home/runner/work/buildvote-agent/buildvote-agent/rug-radar && grep -n -i "overlap" README.md
- `run` grep -n -i "overlap\|concurrent" README.md | head -30
- `read` rug-radar/src/discovery.ts
- `run` grep -n "sinceBlockTime\|overlap\|concurrent" src/poller.test.ts | head -40
- `think` Let me confirm this hypothesis with a throwaway offline probe before touching any code — simulating two overlapping `pollOnce` calls sharing the same `PollState`.
- `edit` rug-radar/src/_probe_overlap.ts
- `run` npx tsx src/_probe_overlap.ts
- `run` grep -n "deepEqual\|deepStrictEqual\|PollState" src/*.ts
- `think` Bug confirmed. Now let's remove the probe and implement the fix: add an in-flight guard directly to `PollState` so a second overlapping `pollOnce` call is dropped rather than racing — consistent with this codebase's existing "drop, don't queue" pattern (`ScoringGate`).
- `run` rm /home/runner/work/buildvote-agent/buildvote-agent/rug-radar/src/_probe_overlap.ts
- `edit` rug-radar/src/poller.ts
- `think` Now update `pollOnce` itself to check and set this guard:
- `edit` rug-radar/src/poller.ts
- `read` rug-radar/src/poller.ts
- `edit` rug-radar/src/poller.ts
- `think` Now let's verify the full file and run typecheck/tests.
- `run` npm run typecheck 2>&1 | tail -30 && npm test 2>&1 | tail -15
- `think` Clean. Now let's add regression tests to `poller.test.ts` reproducing both the bug and the fix, following the same pattern session 80 used for `discovery.ts`.
- `read` rug-radar/src/poller.test.ts
- `edit` rug-radar/src/poller.test.ts
- `edit` rug-radar/src/poller.test.ts
- `think` Now let's run the tests to confirm everything passes, and specifically time these new tests to make sure there's no hidden retry-delay hang.
- `run` time npx tsx --test src/poller.test.ts 2>&1 | tail -40
- `think` Fast and all passing. Now let's temporarily revert the fix to confirm both new tests actually catch the bug (same verification discipline session 80 used).
- `run` git diff --stat src/poller.ts
- `run` cd /home/runner/work/buildvote-agent/buildvote-agent && git stash push -- rug-radar/src/poller.ts && cd rug-radar && npx tsx --test src/poller.test.ts 2>&1 | tail -40
- `run` cd /home/runner/work/buildvote-agent/buildvote-agent && git stash pop && cd rug-radar && npm test 2>&1 | tail -15
- `think` Fix restored, all 226 tests pass (224 prior + 2 new). Let's confirm typecheck/build are clean and check `git status` for stray files before documenting.
- `run` npm run typecheck 2>&1 | tail -10 && npm run build 2>&1 | tail -10 && cd /home/runner/work/buildvote-agent/buildvote-agent && git status
- `think` Clean — only `poller.ts` and `poller.test.ts` changed, no stray files. Now let's update the README to match the existing documentation pattern for watermark/backstop notes, then update PROGRESS.md.
- `run` cd rug-radar && grep -n "watermark\|sinceBlockTime\|backstop" README.md | head -30
- `read` rug-radar/README.md
- `think` I'll add a new paragraph right after the session-80 watermark fix, documenting this session's overlap guard in the same style.
- `edit` rug-radar/README.md
- `think` Now let's update PROGRESS.md with this session's entry.
- `run` cd /home/runner/work/buildvote-agent/buildvote-agent && date -u +%Y-%m-%d
- `edit` PROGRESS.md
- `think` Now let's do a final full verification pass and check for stray files before finishing.
- `run` cd /home/runner/work/buildvote-agent/buildvote-agent/rug-radar && npm run typecheck 2>&1 | tail -10 && npm run build 2>&1 | tail -10 && npm test 2>&1 | tail -12 && git status
- `think` Everything is clean: typecheck/build pass, 226/226 tests pass, only the intended files changed, no stray scratch files or `.env`.
