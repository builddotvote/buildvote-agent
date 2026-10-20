# Session 80: Rug radar: live launch scoring

- Started: 2026-10-20T00:18:50Z
- Ended: 2026-10-20T00:23:43Z
- Steps: 46
- Model turns: 47
- Billing: Claude subscription (API value $1.6245, not billed)
- Outcome: ok

## Summary

Session 80 complete. Summary:  Found and fixed a real bug in `discovery.ts`'s watermark cursor: `findNewLaunches` used `sig.blockTime <= sinceBlockTime` as the boundary, but `blockTime` only has 1-second resolution and pump.fun's firehose regularly puts multiple creates in the same wall-clock second. A signature sharing the exact same second as the watermark — even one never seen on a prior poll — was silently excluded forever, since the watermark never moves backward to give it another chance. Reproduced live with a throwaway probe (poll 1 sets the watermark from sigA; poll 2's sigB shares t…

## Steps

- `run` cat /home/runner/work/buildvote-agent/buildvote-agent/TASK.md 2>/dev/null; echo "---PROGRESS---"; cat /home/runner/work/buildvote-agent/buildvote-agent/PROGRESS.md 2>/dev/null
- `run` wc -l TASK.md PROGRESS.md 2>/dev/null; echo "---"; ls -la; echo "---rug-radar---"; ls -la rug-radar 2>/dev/null
- `run` tail -n 150 PROGRESS.md
- `run` cat TASK.md; echo "---queue---"; cat queue.json; echo "---src---"; find rug-radar/src -type f | sort
- `run` cd rug-radar && npm install --silent 2>&1 | tail -20 && echo "---TEST---" && npm test 2>&1 | tail -30
- `think` 222/222 passing, clean. Repo matches PROGRESS.md's session 79 state. Now let's do a deep correctness pass on `discovery.ts` and `server.ts`, which the prior session flagged as not yet re-derived from scratch.
- `run` cd rug-radar && wc -l src/discovery.ts src/server.ts src/discovery.test.ts
- `run` pwd
- `run` wc -l src/discovery.ts src/server.ts src/discovery.test.ts
- `read` rug-radar/src/discovery.ts
- `run` grep -n "blockTime\|same second\|tie\|watermark" README.md | head -60
- `run` sed -n '290,340p' README.md
- `run` grep -n "blockTime\|same second\|duplicate\|tie" src/discovery.test.ts | head -60
- `read` rug-radar/src/discovery.test.ts
- `read` rug-radar/src/discovery.test.ts
- `run` cat > /tmp/probe-tie.mjs << 'EOF' import { findNewLaunches } from "/home/runner/work/buildvote-agent/buildvote-agent/rug-radar/dist/discovery.js"; EOF echo skip
- `edit` rug-radar/tmp-probe-tie.ts
- `run` node --import tsx tmp-probe-tie.ts
- `run` grep -rn "findNewLaunches\|sinceBlockTime\|newestBlockTime" --include="*.ts" src | grep -v ".test.ts"
- `read` rug-radar/src/poller.ts
- `run` grep -rn "sinceBlockTime\|newestBlockTime\|PollState" --include="*.ts" src
- `read` rug-radar/src/discovery.ts
- `edit` rug-radar/src/discovery.ts
- `read` rug-radar/src/discovery.ts
- `edit` rug-radar/src/discovery.ts
- `think` Now let's add a regression test and verify it fails without the fix.
- `read` rug-radar/src/discovery.test.ts
- `run` grep -n "at or before\|sinceBlockTime: 1700000000\b" src/poller.test.ts | head -20
- `run` grep -n "blockTime" src/poller.test.ts
- `think` Good, all strictly greater than the state's `sinceBlockTime: 1700000000`, unaffected. Now let's update the discovery.test.ts test and add the regression test, then run the suite.
- `edit` rug-radar/src/discovery.test.ts
- `think` Now let's run the tests, and verify the new tests actually catch the bug by temporarily reverting the fix.
- `run` npm test 2>&1 | tail -40
- `edit` rug-radar/src/discovery.test.ts
- `run` npm test 2>&1 | tail -20
- `think` All 224 pass. Now let's verify the new regression test actually catches the original bug by reverting the fix temporarily.
- `run` cp src/discovery.ts /tmp/discovery.ts.fixed sed -i 's/sig.blockTime < sinceBlockTime) continue;/sig.blockTime <= sinceBlockTime) continue;/' src/discovery.ts npx tsx --test src/discovery.test.ts 2>&1 | tail -30 cp /tmp/discovery.ts.fixed src/discovery.ts
- `think` Both new tests correctly fail without the fix (2 failures). Restored the fix — let's confirm the full suite is green again.
- `run` npm test 2>&1 | tail -10 && echo "---typecheck---" && npm run typecheck 2>&1 | tail -20 && echo "---build---" && npm run build 2>&1 | tail -20
- `think` All green. Let's clean up the probe script and double-check nothing else references it.
- `run` rm -f tmp-probe-tie.ts git status --short
- `run` grep -n "findNewLaunches\|watermark\|sinceBlockTime" README.md
- `run` grep -n "^#\|^##" README.md | head -60
- `run` sed -n '300,330p' README.md
- `run` grep -n "discovery.ts\|findNewLaunches\|poller.ts" README.md
- `run` sed -n '455,475p' README.md
- `read` rug-radar/README.md
- `think` I'll insert a new paragraph documenting this fix right after the backstop bullet, following the established style.
- `edit` rug-radar/README.md
- `think` Now let's re-run the full suite once more as a final check, then update PROGRESS.md.
- `run` npm test 2>&1 | tail -10 && npm run typecheck 2>&1 | tail -5 && npm run build 2>&1 | tail -5 && git status --short
- `think` Everything is clean: 224/224 tests, typecheck and build pass. Now let's update PROGRESS.md with this session's entry.
- `run` cd /home/runner/work/buildvote-agent/buildvote-agent && tail -5 PROGRESS.md
- `edit` PROGRESS.md
- `run` git status --short && git diff --stat
- `run` ls rug-radar/tmp-probe* 2>/dev/null; echo "none left"; cd rug-radar && npm test 2>&1 | tail -8
- `think` Session 80 complete. Summary:
