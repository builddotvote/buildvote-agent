# Session 78: Rug radar: live launch scoring

- Started: 2026-10-19T13:08:21Z
- Ended: 2026-10-19T13:11:47Z
- Steps: 41
- Model turns: 42
- Billing: Claude subscription (API value $1.2364, not billed)
- Outcome: ok

## Summary

Session 78 complete. Found and fixed a real bug in `src/signals/bundledBuys.ts`: the bundled-buys risk score divided a distinct-buyer count (numerator) by a buy-event count (denominator), so a bundled wallet that made several small early buys could dilute its own detected share and defeat the detector (confirmed live: a true 50% bundle scored 90 "high risk" normally, but dropped to 25 "low risk" once one bundled buyer split its buy into 5 events). Fixed the denominator to use distinct buyers consistently, added a regression test, and updated PROGRESS.md. All 221 tests pass, typecheck/build cl…

## Steps

- `run` cat PROGRESS.md 2>/dev/null; echo "---TASK---"; cat TASK.md 2>/dev/null
- `run` wc -l PROGRESS.md TASK.md 2>/dev/null; echo "---"; cat TASK.md
- `read` PROGRESS.md
- `read` PROGRESS.md
- `read` PROGRESS.md
- `run` cd rug-radar && ls -la src src/signals 2>/dev/null && echo "---" && git log --oneline -5 && echo "---status---" && git status
- `run` cd rug-radar && grep -n "^## Session" ../PROGRESS.md | tail -30
- `run` find . -maxdepth 2 -iname "rug-radar*"; ls
- `run` pwd && grep -n "^## Session" ../PROGRESS.md | tail -30
- `run` npm install --silent 2>&1 | tail -20 && npm test 2>&1 | tail -30
- `run` cd /home/runner/work/buildvote-agent/buildvote-agent && sed -n '4031,4719p' PROGRESS.md | grep -oE '[a-zA-Z]+\.ts' | sort | uniq -c | sort -rn | head -40
- `read` rug-radar/src/pipeline.ts
- `read` rug-radar/src/scorer.ts
- `read` rug-radar/src/deployerIndex.ts
- `think` Looks solid. Let me check `deployerIndex.test.ts` for coverage and check `knownAccounts.ts` / `wsLogParser.ts`.
- `read` rug-radar/src/deployerIndex.test.ts
- `run` ls -la /home/runner/work/buildvote-agent/buildvote-agent/rug-radar/src/data/
- `run` sed -n '3894,4719p' PROGRESS.md | grep -n "data/\|bundledBuys.ts\|deployerHistory.ts\|holderConcentration.ts\|liquidity.ts\|bondingCurve.ts"
- `read` PROGRESS.md
- `run` cd /home/runner/work/buildvote-agent/buildvote-agent/rug-radar && wc -l public/index.html src/server.ts src/requestHandler.ts
- `read` rug-radar/public/index.html
- `run` find . -iname "feed.js*" -o -iname "*renderLaunch*" | grep -v node_modules
- `read` rug-radar/public/feed.js
- `run` grep -rn "reasons" src/signals/*.ts src/scorer.ts src/types.ts | grep -v test
- `run` grep -n "const label" src/signals/*.ts
- `read` rug-radar/src/requestHandler.ts
- `read` rug-radar/src/knownAccounts.ts
- `read` rug-radar/src/data/bundledBuys.ts
- `read` rug-radar/src/signals/bundledBuys.ts
- `read` rug-radar/src/signals/bundledBuys.test.ts
- `run` cat > /tmp/check_bug.mjs << 'EOF' import { scoreBundledBuys } from "./src/signals/bundledBuys.ts";  function buy(buyer, fundedBy, secondsAfterLaunch) { return { buyer, fundedBy, secondsAfterLaunch }; }  const result = scoreBundledBuys({   earlyBuys: [     buy("buyerA", "funder1", 10),     buy("buyerA", "funder1", 11),     buy("buyerA", "funder1", 12),     buy("buyerA", "funder1", 13),     buy("bu…
- `run` sed -i "s#./src/signals/bundledBuys.ts#/home/runner/work/buildvote-agent/buildvote-agent/rug-radar/src/signals/bundledBuys.ts#" /tmp/check_bug.mjs && node --import tsx /tmp/check_bug.mjs
- `think` Found a real bug. Let me look at the full file to plan the fix precisely.
- `read` rug-radar/src/signals/bundledBuys.ts
- `edit` rug-radar/src/signals/bundledBuys.ts
- `think` Now let's add a test for this case and run the suite.
- `edit` rug-radar/src/signals/bundledBuys.test.ts
- `run` npm run typecheck 2>&1 | tail -20 && npm test 2>&1 | tail -15
- `think` 221/221 passing, typecheck clean. Let's confirm build too, then clean up the scratch file.
- `run` npm run build 2>&1 | tail -10 && rm -f /tmp/check_bug.mjs && git status --short
- `think` Build clean, only the intended two files changed. Now update PROGRESS.md.
- `run` cd /home/runner/work/buildvote-agent/buildvote-agent && grep -n "## Session 77" PROGRESS.md
- `read` PROGRESS.md
- `read` PROGRESS.md
- `edit` PROGRESS.md
- `think` Let me do a final sanity check of everything before wrapping up.
- `run` cd /home/runner/work/buildvote-agent/buildvote-agent/rug-radar && npm test 2>&1 | tail -8 && echo "---" && git status --short
- `think` Session 78 complete. Found and fixed a real bug in `src/signals/bundledBuys.ts`: the bundled-buys risk score divided a distinct-buyer count (numerator) by a buy-event count (denominator), so a bundled wallet that made several small early buys could dilute its own detected share and defeat the detector (confirmed live: a true 50% bundle scored 90 "high risk" normally, but dropped to 25 "low risk" …
