# Session 27: Rug radar: live launch scoring

- Started: 2026-10-05T22:00:34Z
- Ended: 2026-10-05T22:09:50Z
- Steps: 55
- Model turns: 56
- Billing: Claude subscription (API value $2.9747, not billed)
- Outcome: ok

## Summary

This session's work is complete. Summary:  **What I did:** Picked up the long-standing scoring-endpoint rate-limit issue. First live-checked 9 additional free public RPC endpoints for `getTokenSupply`/`getTokenLargestAccounts` support without a key — all failed (dead, key-gated, or plan-restricted), confirming the "find a better endpoint" path is exhausted for now.  Found a real, independent fix instead: pump.fun's bonding curve account (already fetched for the liquidity signal) carries `token_total_supply`, a value fixed at creation and never changed by buy/sell. Holder concentration was fet…

## Steps

- `run` cat /home/runner/work/buildvote-agent/buildvote-agent/TASK.md 2>/dev/null; echo "---PROGRESS---"; cat /home/runner/work/buildvote-agent/buildvote-agent/PROGRESS.md 2>/dev/null
- `read` PROGRESS.md
- `read` TASK.md
- `read` PROGRESS.md
- `run` cat /home/runner/.claude/projects/-home-runner-work-buildvote-agent-buildvote-agent/memory/MEMORY.md 2>/dev/null || echo "NO MEMORY FILE"
- `run` git status && echo "---" && git log --oneline -5 && echo "---rug-radar---" && ls rug-radar
- `run` cd rug-radar && npm install --silent 2>&1 | tail -20 && npm run typecheck 2>&1 | tail -20 && npm test 2>&1 | tail -30
- `think` Good, repo is clean, 118/118 tests pass. The main open item is the scoring endpoint's rate-limit ceiling. Let me look at the relevant code before researching alternative endpoints.
- `run` cd rug-radar && sed -n '1,120p' src/config.ts
- `run` pwd
- `read` rug-radar/src/config.ts
- `run` set -e MINT="EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" for URL in "https://rpc.ankr.com/solana" "https://endpoints.omniatech.io/v1/sol/mainnet/public" "https://solana.drpc.org" "https://solana-rpc.publicnode.com"; do   echo "=== $URL getTokenSupply ==="   curl -s -m 10 -X POST "$URL" -H "Content-Type: application/json" \     -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"getTokenSupply\",\"pa…
- `run` set -e MINT="EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" for URL in "https://solana-mainnet.rpc.extrnode.com" "https://api.metaplex.solana.com" "https://solana-api.projectserum.com" "https://free.rpcpool.com" "https://solana.public-rpc.com"; do   echo "=== $URL getTokenSupply ==="   curl -s -m 10 -X POST "$URL" -H "Content-Type: application/json" \     -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method…
- `run` for URL in "https://solana-mainnet.rpc.extrnode.com" "https://api.metaplex.solana.com" "https://solana-api.projectserum.com" "https://solana.public-rpc.com"; do   echo "=== $URL ==="   curl -s -o /dev/null -w "http_code=%{http_code} time=%{time_total}\n" -m 10 -X POST "$URL" -H "Content-Type: application/json" \     -d '{"jsonrpc":"2.0","id":1,"method":"getHealth","params":[]}' done
- `run` grep -rn "supply\|1_000_000_000\|1000000000" src/pumpfun.ts src/signals/holderConcentration.ts src/data/holderConcentration.ts README.md 2>/dev/null
- `tool` ToolSearch
- `run` curl -s -m 15 "https://raw.githubusercontent.com/pump-fun/pump-public-docs/main/docs/PUMP_PROGRAM_README.md" | grep -i -n "supply\|1_000_000_000\|1000000000\|decimals" | head -50
- `run` curl -s -m 15 "https://raw.githubusercontent.com/pump-fun/pump-public-docs/main/docs/PUMP_PROGRAM_README.md" | sed -n '1,160p'
- `read` rug-radar/src/pumpfun.ts
- `read` rug-radar/src/data/holderConcentration.ts
- `read` rug-radar/src/pipeline.ts
- `read` rug-radar/src/data/liquidity.ts
- `read` rug-radar/src/data/liquidity.test.ts
- `read` rug-radar/src/data/holderConcentration.test.ts
- `think` Now let's look at pipeline.test.ts to understand the fake RPC shape used there.
- `read` rug-radar/src/pipeline.test.ts
- `edit` rug-radar/src/data/bondingCurve.ts
- `edit` rug-radar/src/data/liquidity.ts
- `think` Now update holder concentration data fetch:
- `edit` rug-radar/src/data/holderConcentration.ts
- `think` Now update pipeline.ts to fetch the bonding curve once and share it:
- `edit` rug-radar/src/pipeline.ts
- `edit` rug-radar/src/pipeline.ts
- `edit` rug-radar/src/pipeline.ts
- `edit` rug-radar/src/data/bondingCurve.test.ts
- `think` Now add a test to liquidity.test.ts for the `knownCurve` shortcut, and to holderConcentration.test.ts for `knownTotalSupply`:
- `edit` rug-radar/src/data/liquidity.test.ts
- `edit` rug-radar/src/data/holderConcentration.test.ts
- `think` Now let's add a pipeline test confirming the shared curve avoids the getTokenSupply call:
- `edit` rug-radar/src/pipeline.test.ts
- `think` Now let's run typecheck, build, and tests.
- `run` npm run typecheck 2>&1 | tail -40
- `think` Clean. Now tests:
- `run` npm test 2>&1 | tail -50
- `think` 123/123 passing (5 new). Now let's build and run the live smoke test synchronously per Session 26's process note.
- `run` npm run build 2>&1 | tail -20
- `run` grep -n "console\." src/server.ts src/rpc.ts src/poller.ts src/wsDiscovery.ts | head -50
- `run` \ rm -f /tmp/server-session27.log && \ NODE_OPTIONS=--experimental-websocket node --import tsx src/server.ts > /tmp/server-session27.log 2>&1 & SERVER_PID=$! echo "started server pid $SERVER_PID" sleep 85 echo "=== /api/feed ===" curl -s -m 5 http://localhost:8787/api/feed | head -c 2000 echo "" echo "=== log summary ===" wc -l /tmp/server-session27.log echo "-- 429 count --" grep -c "429" /tmp/s…
- `run` ps aux | grep -i "tsx src/server" | grep -v grep; rm -f /tmp/server-session27.log; git status
- `run` kill 10634 2>/dev/null; sleep 1; ps aux | grep -i "tsx src/server" | grep -v grep || echo "no leftover server process"
- `think` Good, cleaned up. Now let's update the README to document this change, then PROGRESS.md.
- `run` grep -n "Known limitations\|getTokenSupply\|holder concentration\|Holder concentration" README.md | head -40
- `read` rug-radar/README.md
- `read` rug-radar/README.md
- `think` Now let's update the Holder concentration section and the Known limitations section with this session's findings.
- `edit` rug-radar/README.md
- `think` Now update the Known limitations section with the live result from this session:
- `edit` rug-radar/README.md
- `think` Now update the top status line slightly and PROGRESS.md. Let's check the top summary line once more for consistency, then append the new session entry to PROGRESS.md.
- `edit` buildvote-agent/PROGRESS.md
- `edit` PROGRESS.md
- `think` Now let's double check the final diff and run the full test/typecheck/build one more time to be safe.
- `run` npm run typecheck 2>&1 | tail -20 && npm run build 2>&1 | tail -20 && npm test 2>&1 | tail -15
- `think` All clean. Let's check final git status to confirm no stray files before wrapping up.
- `run` cd /home/runner/work/buildvote-agent/buildvote-agent && git status && git diff --stat
- `run` ls -la /home/runner/.claude/projects/-home-runner-work-buildvote-agent-buildvote-agent/memory/ 2>&1
- `run` ls -la /home/runner/.claude/projects/-home-runner-work-buildvote-agent-buildvote-agent/ 2>&1
- `edit` /home/runner/.claude/projects/-home-runner-work-buildvote-agent-buildvote-agent/memory/project_rug_radar_scoring_rpc_limits.md
- `edit` /home/runner/.claude/projects/-home-runner-work-buildvote-agent-buildvote-agent/memory/feedback_rug_radar_live_checks.md
- `edit` /home/runner/.claude/projects/-home-runner-work-buildvote-agent-buildvote-agent/memory/MEMORY.md
- `think` This session's work is complete. Summary:
