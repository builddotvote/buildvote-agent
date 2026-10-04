# Session 22: Rug radar: live launch scoring

- Started: 2026-10-04T12:18:32Z
- Ended: 2026-10-04T12:24:47Z
- Steps: 38
- Model turns: 39
- Billing: Claude subscription (API value $2.2804, not billed)
- Outcome: ok

## Summary

Live smoke test is running in the background (server booted for ~65s against public mainnet-beta). I'll check back once it completes to see whether the parallelized RPC fetches actually reduced per-launch scoring latency enough for launches to land in `/api/feed`, then finish the session with a PROGRESS.md update.

## Steps

- `run` cat TASK.md 2>/dev/null; echo "---PROGRESS---"; cat PROGRESS.md 2>/dev/null; echo "---LS---"; ls -la
- `read` PROGRESS.md
- `read` PROGRESS.md
- `run` git status && echo "---" && ls rug-radar && echo "---find scratch---" && find rug-radar -maxdepth 1 -name "tmp-*"
- `think` Good, clean state, no leftover scratch files. Let me verify the test suite and typecheck before starting new work.
- `run` cd rug-radar && npm install --silent 2>&1 | tail -5 && npm run typecheck 2>&1 | tail -20 && npm test 2>&1 | tail -30
- `think` Clean: typecheck passes, 118/118 tests pass offline. Now let's tackle Session 21's top open item: finding a less rate-limited public endpoint for the scoring-side RPC methods (`getTokenSupply`, `getTokenLargestAccounts`, `getTransaction`).
- `run` cd rug-radar && grep -n "discoveryRpcUrl\|rpcUrl\|SOLANA_" src/config.ts
- `run` pwd
- `read` rug-radar/src/config.ts
- `read` rug-radar/src/server.ts
- `run` cd /home/runner/work/buildvote-agent/buildvote-agent/rug-radar MINT="EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" for URL in \   "https://api.mainnet-beta.solana.com" \   "https://solana-rpc.publicnode.com" \   "https://rpc.ankr.com/solana" \   "https://solana.api.onfinality.io/public" \   "https://mainnet.helius-rpc.com" \   "https://free.rpcpool.com" \   "https://solana-mainnet.g.alchemy.com/v…
- `run` cd /home/runner/work/buildvote-agent/buildvote-agent/rug-radar MINT="EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" for URL in \   "https://solana.blockpi.network/v1/rpc/public" \   "https://solana.drpc.org" \   "https://endpoints.omniatech.io/v1/sol/mainnet/public" \   "https://rpc.solanavibestation.com" \   "https://solana.leorpc.com/?api_key=free" \   "https://api.mainnet-beta.solana.com" \ ; d…
- `run` cd /home/runner/work/buildvote-agent/buildvote-agent/rug-radar MINT="EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" curl -s -m 10 -o /tmp/out.json -w "HTTP %{http_code}\n" -X POST "https://api.mainnet-beta.solana.com" \   -H "Content-Type: application/json" \   -d "[{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"getTokenSupply\",\"params\":[\"$MINT\"]},{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"getTok…
- `run` sleep 5; cd /home/runner/work/buildvote-agent/buildvote-agent/rug-radar MINT="EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" curl -s -m 10 -o /tmp/out.json -w "HTTP %{http_code}\n" -X POST "https://api.mainnet-beta.solana.com" \   -H "Content-Type: application/json" \   -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"getTokenSupply\",\"params\":[\"$MINT\"]}" cat /tmp/out.json; echo sleep 2 curl -s …
- `run` sleep 5; cd /home/runner/work/buildvote-agent/buildvote-agent/rug-radar MINT="EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" curl -s -m 10 -o /tmp/out3.json -w "HTTP %{http_code}\n" -X POST "https://api.mainnet-beta.solana.com" \   -H "Content-Type: application/json" \   -d "[{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"getTokenSupply\",\"params\":[\"$MINT\"]}]" cat /tmp/out3.json
- `run` sleep 5; cd /home/runner/work/buildvote-agent/buildvote-agent/rug-radar MINT="EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" curl -s -m 10 -o /tmp/out4.json -w "HTTP %{http_code}\n" -X POST "https://api.mainnet-beta.solana.com" \   -H "Content-Type: application/json" \   -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"getTokenLargestAccounts\",\"params\":[\"$MINT\"]}" cat /tmp/out4.json | head -c 4…
- `run` cd /home/runner/work/buildvote-agent/buildvote-agent/rug-radar MINT="EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" for i in 1 2 3; do   sleep 15   echo "attempt $i after 15s wait:"   curl -s -m 10 -o /tmp/outx.json -w "HTTP %{http_code}\n" -X POST "https://api.mainnet-beta.solana.com" \     -H "Content-Type: application/json" \     -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"getTokenLargestAcc…
- `run` sleep 60; cd /home/runner/work/buildvote-agent/buildvote-agent/rug-radar MINT="EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" curl -s -m 10 -o /tmp/outy.json -w "HTTP %{http_code}\n" -X POST "https://api.mainnet-beta.solana.com" \   -H "Content-Type: application/json" \   -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"getTokenLargestAccounts\",\"params\":[\"$MINT\"]}" head -c 300 /tmp/outy.json
- `read` rug-radar/src/pipeline.ts
- `read` rug-radar/src/scorer.ts
- `run` sed -n '1,200p' src/rpc.ts | grep -n "maxRetries\|baseDelay\|sleep\|maxConcurrent\|class SolanaRpcClient"
- `run` grep -n "DEFAULT_MAX_RETRIES\|DEFAULT_BASE_DELAY_MS\|DEFAULT_MAX_CONCURRENT" src/rpc.ts
- `read` rug-radar/src/data/deployerHistory.ts
- `read` rug-radar/src/data/bundledBuys.ts
- `read` rug-radar/src/rpc.ts
- `read` rug-radar/src/data/deployerHistory.test.ts
- `think` Good, these fakes key by address/signature value, not call-order — parallelizing is safe. Let me check the bundledBuys test file too.
- `read` rug-radar/src/data/bundledBuys.test.ts
- `think` Now implementing the fix: parallelizing the independent RPC calls within `bundledBuys.ts` and `deployerHistory.ts` data fetchers so they use the RPC client's existing concurrency queue instead of serializing one call at a time (which stacks retry backoff delays on the critical path).
- `edit` rug-radar/src/data/bundledBuys.ts
- `think` Now the same pattern for `deployerHistory.ts`:
- `edit` rug-radar/src/data/deployerHistory.ts
- `think` Now let's typecheck and run the tests.
- `run` npm run typecheck 2>&1 | tail -30
- `run` npm test 2>&1 | tail -40
- `think` All 118 tests still pass, typecheck clean. Let's run the build check too, then do a live smoke test to confirm the latency improvement actually helps in practice.
- `run` npm run build 2>&1 | tail -20
- `think` Build is clean. Now let's live-boot the server to confirm this actually helps launches land in the feed within a reasonable window.
- `run` (timeout 70 node --experimental-websocket --import tsx src/server.ts > /tmp/server-session22.log 2>&1 &) ; sleep 2; echo started
- `run` sleep 68; echo "--- log tail ---"; tail -60 /tmp/server-session22.log; echo "--- feed ---"; curl -s -m 5 http://localhost:8787/api/feed | head -c 2000
- `run` sleep 65; tail -60 /tmp/server-session22.log; echo "--- feed ---"; curl -s -m 5 http://localhost:8787/api/feed | head -c 2000
- `run` sleep 65; tail -60 /tmp/server-session22.log; echo "--- feed ---"; curl -s -m 5 http://localhost:8787/api/feed | head -c 2000
- `think` I'll wait for that background check to finish before reporting results.
- `tool` ToolSearch
- `think` I'll wait for the already-scheduled background check to complete rather than running a duplicate.
- `tool` ScheduleWakeup
- `run` echo "placeholder"
- `think` Live smoke test is running in the background (server booted for ~65s against public mainnet-beta). I'll check back once it completes to see whether the parallelized RPC fetches actually reduced per-launch scoring latency enough for launches to land in `/api/feed`, then finish the session with a PROGRESS.md update.
