# Session 48: Rug radar: live launch scoring

- Started: 2026-10-12T10:44:22Z
- Ended: 2026-10-12T10:49:07Z
- Steps: 30
- Model turns: 31
- Billing: Claude subscription (API value $2.5538, not billed)
- Outcome: ok

## Summary

Clean: 168/168 tests pass, typecheck/build clean, no leftover processes, and only the intended README/PROGRESS changes are staged (no code changes this session, no `.env`, no secrets touched).  ## Summary  This session (48) re-verified the repo was exactly as Session 47 left it, then tried a new angle on the long-standing scoring-endpoint rate-limit ceiling: since TASK.md permits "public RPC endpoints, public APIs," I checked whether a non-RPC public API could supply holder data instead of the perpetually-429'd `getTokenLargestAccounts` call — an avenue no prior session (27-28 only checked al…

## Steps

- `run` cat TASK.md 2>/dev/null; echo "---PROGRESS---"; cat PROGRESS.md 2>/dev/null; echo "---LS---"; ls -la
- `read` PROGRESS.md
- `read` PROGRESS.md
- `read` PROGRESS.md
- `read` PROGRESS.md
- `read` PROGRESS.md
- `read` PROGRESS.md
- `read` PROGRESS.md
- `think` I've read through TASK.md and the full session history in PROGRESS.md (47 sessions). All five TASK.md steps are functionally complete; recent sessions have been hardening the live pipeline against the public RPC's rate limits, with `getTokenLargestAccounts` (holder concentration's indexed call) as the persistent headline bottleneck — confirmed to 429 at every tested pace, even isolated single cal…
- `run` cd /home/runner/work/buildvote-agent/buildvote-agent/rug-radar && git status --short && echo "---" && ls tmp-* 2>/dev/null; echo "---install---" && npm install --silent 2>&1 | tail -5
- `run` npm run typecheck 2>&1 | tail -20 && echo "---TEST---" && npm test 2>&1 | tail -30 && echo "---BUILD---" && npm run build 2>&1 | tail -10
- `think` No leftover scratch files, repo matches the documented Session 47 state exactly (168/168 tests, clean typecheck/build). Given the long string of sessions (40-46) hitting diminishing returns tuning RPC pacing/retries for `getTokenLargestAccounts`, I'll try a genuinely new angle this session: TASK.md explicitly allows "public RPC endpoints, public APIs" — all prior rate-limit work (sessions 27-28, …
- `tool` ToolSearch
- `search` free public API Solana token top holders no API key 2026
- `search` https://www.solanatracker.io/data-api
- `run` echo "--- solanatracker, no key ---"; curl -s -m 10 -o /dev/null -w "HTTP %{http_code}\n" "https://data.solanatracker.io/tokens/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/holders" echo "--- solscan v2, no key ---"; curl -s -m 10 -o /dev/null -w "HTTP %{http_code}\n" "https://pro-api.solscan.io/v2.0/token/holders?address=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" echo "--- pipeworx (check if …
- `think` This README names a concrete candidate — `rpc.magicblock.app/mainnet`, claimed to be the only keyless endpoint serving `getTokenLargestAccounts`. Let me verify this directly against a real mint rather than trusting the claim.
- `run` echo "--- magicblock getTokenLargestAccounts (USDC mint) ---" curl -s -m 15 -X POST "https://rpc.magicblock.app/mainnet" \   -H "Content-Type: application/json" \   -d '{"jsonrpc":"2.0","id":1,"method":"getTokenLargestAccounts","params":["EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"]}' echo echo "--- magicblock getTokenSupply (sanity check same endpoint) ---" curl -s -m 15 -X POST "https://rpc.m…
- `run` echo "--- leorpc (shared demo key 'FREE', getTokenLargestAccounts) ---" curl -s -m 15 -X POST "https://solana.leorpc.com/?api_key=FREE" \   -H "Content-Type: application/json" \   -d '{"jsonrpc":"2.0","id":1,"method":"getTokenLargestAccounts","params":["EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"]}' echo
- `think` Neither candidate is usable: `rpc.magicblock.app` geo-blocks this sandbox's IP ("Access Restricted... regulatory requirements" — likely to block US-hosted traffic, which would probably also affect wherever this pipeline actually runs), and `leorpc.com`'s shared demo key returns an internal JSON-RPC error on exactly the method needed, plus it uses an explicit `api_key` URL param this project has c…
- `run` grep -n "Known limitations" -A 5 README.md | head -20
- `run` pwd; grep -n "^## Known limitations" -A 3 README.md; echo "---"; grep -n "^## " README.md | tail -20
- `run` grep -n "Known limitations" README.md | head -5; wc -l README.md
- `read` rug-radar/README.md
- `run` grep -n "^#\{1,4\} .*[Kk]nown limitations" README.md
- `read` rug-radar/README.md
- `think` Let me see where this entry ends (most recent sessions appended) to append the new finding at the right spot.
- `run` awk 'NR==398,NR==900 && /^- \*\*/{print NR": "$0}' README.md | grep -E "^\s*[0-9]+: - \*\*"
- `read` rug-radar/README.md
- `run` grep -n "[Ss]ession 4[2-7]" README.md
- `read` rug-radar/README.md
- `edit` rug-radar/README.md
- `think` Now let me append the Session 48 entry to PROGRESS.md.
- `edit` PROGRESS.md
- `edit` PROGRESS.md
- `think` Now let me do a final verification pass to confirm nothing is broken and no stray files are left.
- `run` cd /home/runner/work/buildvote-agent/buildvote-agent && git status --short && echo "---typecheck---" && cd rug-radar && npm run typecheck 2>&1 | tail -10 && echo "---test---" && npm test 2>&1 | tail -8 && echo "---build---" && npm run build 2>&1 | tail -5 && echo "---ps---" && ps aux | grep -i "tsx\|node.*server" | grep -v grep
- `think` Clean: 168/168 tests pass, typecheck/build clean, no leftover processes, and only the intended README/PROGRESS changes are staged (no code changes this session, no `.env`, no secrets touched).
