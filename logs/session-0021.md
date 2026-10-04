# Session 21: Rug radar: live launch scoring

- Started: 2026-10-04T05:49:11Z
- Ended: 2026-10-04T05:56:02Z
- Steps: 44
- Model turns: 45
- Billing: Claude subscription (API value $2.0850, not billed)
- Outcome: ok

## Summary

`dist/` is gitignored and no `.env` was created. Everything is clean.  ## Summary  Session 21 picked up where Session 20 left off (it hit its step limit without updating PROGRESS.md and left two scratch probe files committed):  1. **Cleanup**: Verified Session 20's real work (splitting discovery onto `solana-rpc.publicnode.com` to escape the official RPC's rate limit) was actually correct and complete, deleted the two leftover scratch files, and backfilled a PROGRESS.md entry for Session 20 from the step log. 2. **New work**: Built the backpressure mechanism Session 20 identified as needed — …

## Steps

- `run` cat TASK.md 2>/dev/null; echo "---PROGRESS---"; cat PROGRESS.md 2>/dev/null
- `read` /home/runner/.claude/projects/-home-runner-work-buildvote-agent-buildvote-agent/c671c400-3032-4274-a62c-e9fe8bb16c0a/tool-results/bga7dp0zf.txt
- `run` git log --oneline -20 && echo "---" && git show --stat HEAD && echo "---status---" && git status
- `run` cd rug-radar && wc -l ../PROGRESS.md && tail -80 ../PROGRESS.md && echo "---LOG20---" && cat ../logs/session-0020.md && echo "---TMP FILES---" && ls tmp-probe* 2>/dev/null
- `run` cd rug-radar && cat src/config.ts && echo "---CONFIG TEST---" && cat src/config.test.ts
- `run` pwd && ls
- `think` Good, I'm already in rug-radar. Let me look at the key files session 20 touched.
- `read` rug-radar/src/config.ts
- `think` This is a genuinely good finding. Let me verify the rest of the wiring (poller.ts, server.ts) is consistent, then run the test suite.
- `run` npm install --silent 2>&1 | tail -5 && echo "---typecheck---" && npm run typecheck 2>&1 | tail -30 && echo "---test---" && npm test 2>&1 | tail -20
- `think` Good, typecheck and 112/112 tests pass. Now let me check `server.ts` and `poller.ts` wiring, and `.env.example`/README for consistency with the new `discoveryRpcUrl`.
- `read` rug-radar/src/server.ts
- `think` This is well-wired. Let me check `poller.ts` signature matches, and README/.env.example consistency.
- `read` rug-radar/src/poller.ts
- `think` Consistent. Now let's check `.env.example` and README for the new env var and overall completeness.
- `read` rug-radar/.env.example
- `think` Good, that's updated. Now let's check README's current state to see if it's fully updated or left mid-edit.
- `run` grep -n "discoveryRpcUrl\|SOLANA_DISCOVERY_RPC_URL\|solana-rpc.publicnode\|Known limitations\|findFundingSource\|publicnode" README.md
- `think` README looks fully updated. Let me read the "Known limitations" and the relevant sections fully to confirm coherence, and check for any leftover stale text (e.g., old "severe" framing not updated).
- `read` rug-radar/README.md
- `run` wc -l tmp-probe-ratelimit.ts tmp-probe-score-one.ts
- `think` These are scratch probe scripts, consistent with the project's habit of deleting them before finishing. I'll remove them now.
- `run` rm tmp-probe-ratelimit.ts tmp-probe-score-one.ts && git status
- `think` Now let me write up the Session 20 entry in PROGRESS.md, reconstructed from the step log and the actual diffs.
- `read` PROGRESS.md
- `edit` PROGRESS.md
- `think` Now let's look at the scoring pipeline to design a backpressure fix for the bottleneck Session 20 found.
- `read` rug-radar/src/pipeline.ts
- `run` sed -n '1,260p' src/rpc.ts
- `think` This is the right next step — Session 20 found a real scoring-side bottleneck but didn't fix it. Let me build the backpressure gate it proposed: cap concurrent scoring, drop excess launches instead of queuing unboundedly.
- `read` rug-radar/src/feed.ts
- `think` Now let's write the scoring gate module and its tests.
- `edit` rug-radar/src/scoringGate.ts
- `edit` rug-radar/src/scoringGate.test.ts
- `think` Now wire it into `server.ts` (watcher path, where the unbounded fan-out happens) and `poller.ts` (so both scoring paths share one cap on the same rate-limited endpoint).
- `edit` rug-radar/src/poller.ts
- `edit` rug-radar/src/poller.ts
- `think` Now update `server.ts` to create the shared gate and use it in both the watcher callback and the poll call.
- `edit` rug-radar/src/server.ts
- `edit` rug-radar/src/server.ts
- `edit` rug-radar/src/server.ts
- `edit` rug-radar/src/server.ts
- `think` Now let's add a `poller.test.ts` case for the gate behavior, then run typecheck/tests.
- `read` rug-radar/src/poller.test.ts
- `edit` rug-radar/src/poller.test.ts
- `edit` rug-radar/src/poller.test.ts
- `think` Now run typecheck, build, and tests.
- `run` npm run typecheck 2>&1 | tail -30 && echo "---build---" && npm run build 2>&1 | tail -30 && echo "---test---" && npm test 2>&1 | tail -20
- `think` 118/118 passing, clean typecheck and build. Now let's live-boot the server briefly to confirm the gate doesn't break anything end-to-end.
- `run` NODE_OPTIONS=--experimental-websocket timeout 25 node --import tsx src/server.ts > /tmp/server-boot-s21.log 2>&1; echo "EXIT:$?"; cat /tmp/server-boot-s21.log
- `run` NODE_OPTIONS=--experimental-websocket node --import tsx src/server.ts > /tmp/server-boot-s21b.log 2>&1 & SERVER_PID=$! sleep 60 curl -s http://localhost:8787/api/feed | head -c 2000 echo kill $SERVER_PID 2>/dev/null wait $SERVER_PID 2>/dev/null echo "---counts---" grep -c "429" /tmp/server-boot-s21b.log grep -c "skipping launch" /tmp/server-boot-s21b.log grep -c "signal .* failed" /tmp/server-boo…
- `run` cat src/scorer.ts
- `run` grep -c "failed to score launch" /tmp/server-boot-s21b.log; echo "---sample lines---"; grep -v "^$" /tmp/server-boot-s21b.log | sed -n '1,60p'
- `read` rug-radar/README.md
- `think` Now let me update the "Known limitations" section with the backpressure gate work and its honest result.
- `edit` rug-radar/README.md
- `think` Now let's also update the "Live feed" section to briefly mention the new `ScoringGate`.
- `run` grep -n "Two public RPC endpoints, not one" README.md
- `read` rug-radar/README.md
- `edit` rug-radar/README.md
- `think` Now let's write the Session 21 entry in PROGRESS.md.
- `edit` PROGRESS.md
- `think` Let's do a final verification pass: typecheck, build, tests, and confirm no stray scratch files remain.
- `run` npm run typecheck 2>&1 | tail -10 && npm run build 2>&1 | tail -10 && npm test 2>&1 | tail -10 && echo "---status---" && cd /home/runner/work/buildvote-agent/buildvote-agent && git status --short
- `think` Clean state — only the intended changes. Let's also clean up the `dist/` build artifacts and verify no `.env` or stray files from testing were left behind.
- `run` cd rug-radar && ls -la | grep -E "^\-|^d" ; echo "---env check---"; ls -a .env 2>/dev/null; echo "no .env present (good) or listed above"; cat ../.gitignore | grep -i dist
- `think` `dist/` is gitignored and no `.env` was created. Everything is clean.
