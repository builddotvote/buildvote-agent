# Session 88: Rug radar: live launch scoring

- Started: 2026-10-21T21:40:26Z
- Ended: 2026-10-21T21:44:40Z
- Steps: 42
- Model turns: 43
- Billing: Claude subscription (API value $1.5157, not billed)
- Outcome: ok

## Summary

Session complete. Summary:  **Found and fixed a real bug** in `src/wsDiscovery.ts`: the websocket reconnect handler (`ws.onclose`) didn't verify the closing socket was still the active one before acting on it — unlike the idle watchdog's interval callback a few lines away, which already had this exact guard. Since a real `WebSocket`'s close event fires asynchronously, a `stop()` followed by `start()` (both public API) could let a stale close event from the old socket arrive after a new, healthy connection was already open, incorrectly marking it disconnected and opening a spurious third socke…

## Steps

- `think` I'll start by reading the task and progress files.
- `run` cat TASK.md 2>/dev/null; echo "---PROGRESS---"; cat PROGRESS.md 2>/dev/null; echo "---LS---"; ls -la
- `read` PROGRESS.md
- `run` wc -l PROGRESS.md; echo "---TAIL---"; tail -n 200 PROGRESS.md
- `run` cd rug-radar && ls -la && find src -name "*.ts" | grep -v test | sort
- `run` cd rug-radar && npm install --no-audit --no-fund 2>&1 | tail -20
- `run` pwd; ls
- `think` Good, already in rug-radar dir (previous `cd` was within that same bash call's subshell, doesn't persist across tool calls differently... actually it did persist oddly). Let's just proceed from here.
- `run` npm install --no-audit --no-fund 2>&1 | tail -20 && npm run typecheck 2>&1 | tail -30
- `run` npm run build 2>&1 | tail -30 && npm test 2>&1 | tail -40
- `read` rug-radar/src/pipeline.ts
- `run` ls src/*.test.ts 2>/dev/null | grep -iE "pipeline|poller"; find . -iname "*pipeline*" -o -iname "*poller*" | grep -v node_modules
- `read` rug-radar/src/pipeline.test.ts
- `read` rug-radar/src/scorer.ts
- `read` rug-radar/src/poller.ts
- `run` grep -n "^test(" src/poller.test.ts
- `read` rug-radar/src/feed.ts
- `read` rug-radar/src/data/bondingCurve.ts
- `read` rug-radar/src/data/holderConcentration.ts
- `read` rug-radar/src/data/liquidity.ts
- `think` Pipeline.ts and poller.ts check out — I traced the exact interaction between `fetchBondingCurveAccount` failing, holder-concentration's getTokenSupply fallback, and liquidity's lack of a fallback, confirming the pipeline test's seemingly odd "liquidity drops, holder-concentration survives" expectation is correct by design. Now checking rescore.ts and holderRescore.ts.
- `read` rug-radar/src/rescore.ts
- `read` rug-radar/src/balanceIndex.ts
- `run` cat src/rescore.test.ts 2>/dev/null | head -100
- `read` rug-radar/src/holderRescore.ts
- `run` grep -n "^test(" src/holderRescore.test.ts
- `run` wc -l src/wsDiscovery.ts src/watcherOnLaunch.ts src/scoringGate.ts src/scoringInFlight.ts
- `read` rug-radar/src/watcherOnLaunch.ts
- `think` Matches poller.ts's structure exactly, mirrored for the websocket path. Let's check the small gate/in-flight primitives.
- `read` rug-radar/src/scoringGate.ts
- `read` rug-radar/src/scoringInFlight.ts
- `read` rug-radar/src/wsDiscovery.ts
- `run` grep -n "^test(\|stop()\|start()" src/wsDiscovery.test.ts | head -60
- `read` rug-radar/src/wsDiscovery.test.ts
- `run` grep -n "LaunchWatcher\|\.stop()\|\.start()" src/server.ts
- `read` rug-radar/src/wsDiscovery.test.ts
- `think` I found a real gap: `ws.onclose` doesn't verify the closed socket is still the active one, unlike `startIdleWatchdog`'s interval callback which does (`this.ws !== ws`). Let me write a reproduction test to confirm this is a live bug before fixing it.
- `edit` rug-radar/src/wsDiscovery.test.ts
- `run` npx tsx --test src/wsDiscovery.test.ts 2>&1 | tail -40
- `run` npx tsx --test src/wsDiscovery.test.ts 2>&1 | grep -A5 "stale close"
- `edit` rug-radar/src/wsDiscovery.test.ts
- `run` npx tsx --test src/wsDiscovery.test.ts 2>&1 | grep -A8 "stale close"
- `think` Confirmed: the bug reproduces — a stale close event from a superseded connection spuriously triggers a third reconnect. Now let's apply the fix.
- `edit` rug-radar/src/wsDiscovery.ts
- `run` npx tsx --test src/wsDiscovery.test.ts 2>&1 | tail -15 && echo "---FULL SUITE---" && npm run typecheck 2>&1 | tail -20 && npm test 2>&1 | tail -15
- `run` npm run build 2>&1 | tail -20 && git status
- `think` All green: typecheck, build, and 228/228 tests (227 + 1 new regression test). Now updating PROGRESS.md with this session's findings.
- `run` cd /home/runner/work/buildvote-agent/buildvote-agent && grep -n "^## Session 87" PROGRESS.md
- `run` cat >> PROGRESS.md << 'EOF'  ## Session 88 — 2026-10-21  ### Done - Fresh checkout again had no `node_modules` (same as sessions 85-87) — ran   `npm install` before typecheck/build/test; recurring per-session   environment step, not a code issue. - Took up session 87's pointer: gave the orchestration layer the   "re-derive from scratch" treatment. Walked each module independently   against its te…
- `think` Session complete. Summary:
