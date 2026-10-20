# Session 84: Rug radar: live launch scoring

- Started: 2026-10-20T23:51:16Z
- Ended: 2026-10-20T23:54:58Z
- Steps: 25
- Model turns: 26
- Billing: Claude subscription (API value $0.9057, not billed)
- Outcome: ok

## Summary

Session 84 is done. Summary:  **Found and fixed a real bug** in `wsLogParser.ts`'s invoke-stack walk: `RETURN_RE`/`INVOKE_RE` used `\S+` to capture the program ID token, which could falsely match a `"Program log: failed ..."` or `"Program data: ..."` message line as a genuine frame-return control line (since those just needed to *start with* the word "success"/"failed"). That could pop the invoke stack early and cause a real `Create` instruction logged afterward to be silently dropped — meaning `wsDiscovery.ts`'s real-time path could miss a launch entirely, falling back only to the slower pol…

## Steps

- `run` cat /home/runner/work/buildvote-agent/buildvote-agent/TASK.md 2>/dev/null; echo "---PROGRESS---"; cat /home/runner/work/buildvote-agent/buildvote-agent/PROGRESS.md 2>/dev/null
- `read` PROGRESS.md
- `run` find /home/runner/work/buildvote-agent/buildvote-agent/rug-radar -type f -not -path "*/node_modules/*" | sort
- `run` wc -l /home/runner/work/buildvote-agent/buildvote-agent/PROGRESS.md
- `read` PROGRESS.md
- `run` git status && git log --oneline -5
- `think` Clean tree, session 83 already committed. I'll start session 84: re-verify the baseline, then pick up the "Next" pointer — a from-scratch re-derivation of one of the untouched modules (`data/deployerHistory.ts`'s fetching logic, `wsLogParser.ts`'s invoke-stack walk, or `rpc.ts`'s response-parsing helpers).
- `run` cd /home/runner/work/buildvote-agent/buildvote-agent/rug-radar && npm install --no-audit --no-fund 2>&1 | tail -5 && npm run typecheck 2>&1 | tail -20 && npm test 2>&1 | tail -20
- `think` Baseline confirmed: typecheck clean, 226/226 tests pass. Now I'll do the from-scratch re-derivation of `wsLogParser.ts`'s invoke-stack walk, since it hasn't had this specific lens since the session 30-31 refactor.
- `read` rug-radar/src/wsLogParser.ts
- `read` rug-radar/src/wsLogParser.test.ts
- `run` grep -rn "detectCreateInstruction\|detectTradeInstruction\|wsLogParser" src/*.ts | grep -v test
- `read` rug-radar/src/wsDiscovery.ts
- `run` grep -rn "CreateVariant\|TradeKind" src/*.ts | grep -v test
- `run` grep -n "Program log\|Program data\|RETURN_RE\|INVOKE_RE" -r src/*.ts README.md 2>/dev/null | grep -v test
- `think` Re-deriving the invoke-stack walk from scratch, I found a real bug: `RETURN_RE = /^Program \S+ (success|failed)/` can falsely match a `Program log: ...` or `Program data: ...` line as a stack-pop event, if the logged message text happens to start with the word `success` or `failed`. Real Solana program IDs are base58 and never contain a colon, but `\S+` happily captures `log:`/`data:`/`return:` a…
- `run` cat > /tmp/repro.test.mjs << 'EOF' EOF node --experimental-strip-types -e " const INVOKE_RE = /^Program (\S+) invoke \[\d+\]\$/; const RETURN_RE = /^Program \S+ (success|failed)/; console.log('log: failed match?', RETURN_RE.test('Program log: failed validation, retrying')); console.log('log: success match?', RETURN_RE.test('Program log: success so far')); console.log('data: failed match?', RETURN…
- `run` node -e " const RETURN_RE = /^Program \S+ (success|failed)/; console.log('log: failed match?', RETURN_RE.test('Program log: failed validation, retrying')); console.log('log: success match?', RETURN_RE.test('Program log: success so far')); console.log('data: failed match?', RETURN_RE.test('Program data: failedXYZ==')); "
- `think` Confirmed. Now let me add a regression test demonstrating the real consequence (a missed `Create` detection) and then fix the regex.
- `edit` rug-radar/src/wsLogParser.test.ts
- `run` npx tsx --test src/wsLogParser.test.ts 2>&1 | tail -30
- `think` Bug confirmed reachable. Now applying the fix: exclude the colon-suffixed reserved tokens (`log:`, `data:`, `return:`) from the program-id capture, since real base58 program IDs never contain a colon.
- `edit` rug-radar/src/wsLogParser.ts
- `run` npm run typecheck 2>&1 | tail -10 && npm test 2>&1 | tail -15
- `think` All 227/227 pass, typecheck clean. Let me also double check `npm run build`.
- `run` npm run build 2>&1 | tail -10 && git status
- `think` Build clean. Now updating PROGRESS.md with session 84's findings.
- `read` PROGRESS.md
- `edit` PROGRESS.md
- `think` I need more context since this block repeats across earlier sessions. Let me anchor using the surrounding unique line.
- `edit` PROGRESS.md
- `run` cd /home/runner/work/buildvote-agent/buildvote-agent && tail -5 PROGRESS.md && echo --- && grep -n "^## Session" PROGRESS.md | tail -5
- `think` Session 84 added correctly at the end. Final verification of git status and test suite.
- `run` cd /home/runner/work/buildvote-agent/buildvote-agent/rug-radar && npm test 2>&1 | tail -8 && git status --short
- `think` Session 84 is done. Summary:
