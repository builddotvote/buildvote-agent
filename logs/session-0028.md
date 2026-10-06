# Session 28: Rug radar: live launch scoring

- Started: 2026-10-06T06:17:10Z
- Ended: 2026-10-06T06:24:46Z
- Steps: 21
- Model turns: 22
- Billing: Claude subscription (API value $1.0533, not billed)
- Outcome: ok

## Summary

Session 28 is done. Summary:  - Re-verified the repo (123/123 tests, clean typecheck/build) before touching anything. - Investigated Session 27's open question: can `getTokenLargestAccounts` be dropped/approximated the way `getTokenSupply` was? Checked three angles — the bonding curve account has no per-holder data, early-buy data is a non-equivalent sample, and `getProgramAccounts` (the classic alternative) is explicitly disabled on `solana-rpc.publicnode.com` (410) and unresponsive on the official endpoint within 20s. - Conclusion: no free, keyless substitute exists for this call — this ave…

## Steps

- `read` TASK.md
- `read` PROGRESS.md
- `read` PROGRESS.md
- `run` ls -la /home/runner/.claude/projects/-home-runner-work-buildvote-agent-buildvote-agent/memory/ 2>&1; echo "---"; cat /home/runner/.claude/projects/-home-runner-work-buildvote-agent-buildvote-agent/memory/MEMORY.md 2>&1
- `run` cd /home/runner/work/buildvote-agent/buildvote-agent/rug-radar && git status && echo "---" && ls && echo "---node_modules---" && ls node_modules 2>&1 | head -3
- `run` npm install --no-audit --no-fund 2>&1 | tail -20
- `run` npm run typecheck 2>&1 | tail -30 && echo "===BUILD===" && npm run build 2>&1 | tail -30 && echo "===TEST===" && npm test 2>&1 | tail -40
- `run` cat src/data/holderConcentration.ts
- `run` cat src/pumpfun.ts | head -100
- `run` curl -s -m 15 -X POST https://solana-rpc.publicnode.com -H "Content-Type: application/json" -d '{   "jsonrpc":"2.0","id":1,"method":"getProgramAccounts",   "params":[     "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",     {"encoding":"base64","filters":[{"dataSize":165},{"memcmp":{"offset":0,"bytes":"EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"}}],"dataSlice":{"offset":0,"length":0}}   ] }' | he…
- `run` curl -s -m 15 -X POST https://api.mainnet-beta.solana.com -H "Content-Type: application/json" -d '{   "jsonrpc":"2.0","id":1,"method":"getProgramAccounts",   "params":[     "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",     {"encoding":"base64","filters":[{"dataSize":165},{"memcmp":{"offset":0,"bytes":"EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"}}],"dataSlice":{"offset":0,"length":0}}   ] }' | …
- `run` curl -s -m 20 -w "\nHTTP_CODE:%{http_code}\n" -X POST https://api.mainnet-beta.solana.com -H "Content-Type: application/json" -d '{   "jsonrpc":"2.0","id":1,"method":"getProgramAccounts",   "params":[     "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",     {"encoding":"base64","filters":[{"dataSize":165},{"memcmp":{"offset":0,"bytes":"EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"}}],"dataSlice":{"…
- `run` grep -n "Known limitations" -A 60 README.md | head -100
- `run` grep -n "Known limitations" -A 200 README.md | tail -150
- `think` Now let me add the new finding to the README's "Known limitations" section, right after Session 27's entry.
- `edit` rug-radar/README.md
- `read` rug-radar/README.md
- `think` Now I can apply the edit.
- `edit` rug-radar/README.md
- `think` Also update the "status line" summary near the top of the README.
- `read` rug-radar/README.md
- `think` This status line is still accurate; no change needed there. Now let's run the tests/typecheck to confirm nothing broke (no production code changed), and update PROGRESS.md.
- `run` npm run typecheck 2>&1 | tail -10 && npm test 2>&1 | tail -10 && git status
- `edit` PROGRESS.md
- `run` cd /home/runner/work/buildvote-agent/buildvote-agent && git status --short
- `think` Session 28 is done. Summary:
