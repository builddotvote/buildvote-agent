# Session 47: Rug radar: live launch scoring

- Started: 2026-10-12T00:31:13Z
- Ended: 2026-10-12T00:42:42Z
- Steps: 32
- Model turns: 33
- Billing: Claude subscription (API value $2.0468, not billed)
- Outcome: ok

## Summary

Clean: typecheck/build/tests all pass, only the intended files changed, no leftover processes or scratch files.  ## Summary  This session picked up the one item flagged as "untuned" since Session 34: `RESCORE_DELAY_MS`, the wait before re-scoring holder-concentration from observed trades.  - **Measured it live**: two 150s probes tracking every discovered launch's trades directly (bypassing the scoring gate). Across 62 mints tracked, only 3 ever saw a trade at all — most launches simply never trade in-window. Of those 3, first-trade delays were 15.4s, 16.0s, and 54.4s. - **Fixed**: raised `RES…

## Steps

- `think` I'll start by reading TASK.md and PROGRESS.md to see what's planned for this session.
- `read` TASK.md
- `read` PROGRESS.md
- `read` PROGRESS.md
- `read` PROGRESS.md
- `run` wc -l /home/runner/work/buildvote-agent/buildvote-agent/PROGRESS.md
- `read` PROGRESS.md
- `think` Let me look at the current code state to decide on a concrete next step, picking up from Session 46's open items.
- `run` cd /home/runner/work/buildvote-agent/buildvote-agent/rug-radar && ls && git log --oneline -5 && npm install --silent 2>&1 | tail -5 && npm test 2>&1 | tail -20
- `think` Good, repo verified clean (168/168 tests). Let me check typecheck/build too, and look at the relevant pieces of code for RESCORE_DELAY_MS and the scoring gate to pick a concrete next step.
- `run` npm run typecheck 2>&1 | tail -10 && npm run build 2>&1 | tail -10
- `run` grep -n "RESCORE_DELAY_MS" -r src
- `read` rug-radar/src/server.ts
- `think` I have a clear picture now. The project is functionally complete (all 5 TASK.md steps done); 46 sessions have been hardening around the scoring RPC's rate limit. The most concrete still-open, never-addressed item is `RESCORE_DELAY_MS` (20s, set as an "untuned starting point" in Session 34, flagged as still untuned in every session since). I'll measure it live and tune it with real data — a bounde…
- `run` cat src/balanceIndex.ts | head -60
- `run` sed -n '1,60p' src/wsDiscovery.ts | head -80
- `think` Now let me write a throwaway probe to measure, for each tracked mint, the time from `trackMint` start to its first observed trade — the real distribution needed to pick a better `RESCORE_DELAY_MS`.
- `edit` rug-radar/tmp-probe-rescore-timing.ts
- `run` NODE_OPTIONS=--experimental-websocket npx tsx tmp-probe-rescore-timing.ts 2>&1 | tail -100
- `think` One active mint out of 31 traded at all; it started trading 15.4s after tracking began — cutting close to the current 20s delay. Let me run a second check to see if this pattern holds before changing the production default.
- `run` NODE_OPTIONS=--experimental-websocket npx tsx tmp-probe-rescore-timing.ts 2>&1 | tail -100
- `run` grep -rn "RESCORE_DELAY_MS\|20_000\|20000" src/*.test.ts 2>/dev/null; echo "---"; grep -rln "RESCORE_DELAY" .
- `think` Combined across both runs: 3 of 62 tracked mints saw any trade, with first-trade delays of 15.4s, 16.0s, and 54.4s. A fixed 20s delay misses the 54.4s case entirely — 1 of 3 observed active mints, not a rare tail — while the other ~95% of mints never trade at all regardless of delay length, so there's no real cost to waiting longer. I'll raise `RESCORE_DELAY_MS` to cover this.
- `edit` rug-radar/src/server.ts
- `think` Now let me verify typecheck/build/tests still pass, then delete the scratch probe.
- `run` npm run typecheck 2>&1 | tail -10 && npm run build 2>&1 | tail -10 && npm test 2>&1 | tail -10
- `think` Clean, 168/168 unchanged (constant-value change, no new behavior needing new tests — same pattern as Sessions 40/41's `signatureLimit` tunings). Now let me live-verify the change doesn't break anything, synchronously in the foreground per this project's hard-learned rule.
- `run` rm -f /tmp/rr-session47.log && (NODE_OPTIONS=--experimental-websocket npx tsx src/server.ts > /tmp/rr-session47.log 2>&1 & echo $! > /tmp/rr-session47.pid) && sleep 90 && echo "--- feed ---" && curl -s http://localhost:3000/api/feed && echo && echo "--- log tail ---" && tail -60 /tmp/rr-session47.log && kill $(cat /tmp/rr-session47.pid) 2>/dev/null; sleep 1; ps aux | grep -i "server.ts" | grep -v…
- `run` cat /tmp/rr-session47.log | head -80; echo "---port check---"; grep -n "PORT\|port" /home/runner/work/buildvote-agent/buildvote-agent/rug-radar/src/config.ts | head -10
- `run` curl -s http://localhost:8787/api/feed; echo; echo "---"; grep -n "rescore\|RESCORE" /tmp/rr-session47.log; echo "---tail---"; tail -40 /tmp/rr-session47.log
- `run` sleep 20 && grep -n "rescore\|RESCORE" /tmp/rr-session47.log; echo "---feed now---"; curl -s http://localhost:8787/api/feed; echo; echo "---kill---"; pkill -f "tsx src/server.ts" ; sleep 2; ps aux | grep -i "server.ts\|tsx" | grep -v grep
- `run` ps aux | grep -i "tsx\|server.ts" | grep -v grep; echo "---full log grep---"; grep -n "FDbP7Pqyh1vffgHWSWfXpLqjsXHDkBmb4MS9GMxBd5Zs\|rescore" /tmp/rr-session47.log
- `think` Server booted cleanly, no crashes, no new errors from the longer delay; process confirmed killed. Now clean up the scratch probe and update docs.
- `run` rm -f tmp-probe-rescore-timing.ts /tmp/rr-session47.log /tmp/rr-session47.pid && git status --short
- `think` Now let's look at the README's relevant sections to update them.
- `run` grep -n "RESCORE_DELAY_MS\|untuned" README.md
- `read` rug-radar/README.md
- `edit` rug-radar/README.md
- `think` Now let's check the "Known limitations" section for the matching stale note about this item, and update it.
- `run` grep -n "untuned\|RESCORE_DELAY" README.md
- `think` Good, that was the only mention. Now let's update PROGRESS.md with the Session 47 entry.
- `edit` PROGRESS.md
- `think` I need to target the last occurrence specifically since this phrase repeats across sessions. Let me append after the Session 46 entry instead, using more unique surrounding context.
- `run` tail -15 /home/runner/work/buildvote-agent/buildvote-agent/PROGRESS.md
- `think` The file ends there, so I can safely append the new Session 47 section at the end of the file.
- `run` cat >> /home/runner/work/buildvote-agent/buildvote-agent/PROGRESS.md << 'EOF'  ## Session 47 — 2026-10-12  ### Done - Re-verified the repo first (`npm install`, 168/168 tests, clean   typecheck/build), then picked up the one item flagged as still open in   every session since 34: `RESCORE_DELAY_MS` (20s) was an "untuned starting   point," never measured against how fast real launches accumulate t…
- `think` Let's do a final check that everything is clean and consistent.
- `run` npm run typecheck 2>&1 | tail -5 && npm run build 2>&1 | tail -5 && npm test 2>&1 | tail -8 && echo "---git status---" && cd /home/runner/work/buildvote-agent/buildvote-agent && git status --short && echo "---ps---" && ps aux | grep -i "tsx\|server.ts" | grep -v grep
- `think` Clean: typecheck/build/tests all pass, only the intended files changed, no leftover processes or scratch files.
