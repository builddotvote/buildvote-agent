# Session 37: Rug radar: live launch scoring

- Started: 2026-10-09T01:12:38Z
- Ended: 2026-10-09T01:21:09Z
- Steps: 27
- Model turns: 28
- Billing: Claude subscription (API value $1.4787, not billed)
- Outcome: ok

## Summary

Everything's clean: 162/162 tests pass, typecheck is clean, and only the intended files changed (no leftover scratch files or processes).  **Session 36 summary:** Found a leftover scratch probe from an interrupted prior attempt that was already set up to answer the exact question Session 35 left open — whether the balance-index rescore mechanism produces a *correct* positive-balance result, not just that trades reach it. Ran it live against public mainnet-beta (150s, no keys) and got a conclusive yes: a mint with 3 buys + 10 sells produced 2 positive-balance holders and a real `rescoreHolderC…

## Steps

- `think` I'll start by reading the task and progress files.
- `read` TASK.md
- `read` PROGRESS.md
- `read` PROGRESS.md
- `read` PROGRESS.md
- `read` PROGRESS.md
- `run` cd /home/runner/work/buildvote-agent/buildvot e-agent 2>/dev/null; git log --oneline -15 && echo --- && git show --stat HEAD | head -30
- `run` cd /home/runner/work/buildvote-agent/buildvote-agent/rug-radar && ls -la && echo --- && cat package.json | head -20
- `run` cd /home/runner/work/buildvote-agent/buildvote-agent && git status && echo --- && find rug-radar -name "*.log" -o -name "tmp-*"
- `read` rug-radar/tmp-probe-rescore2.ts
- `run` cd /home/runner/work/buildvote-agent/buildvote-agent/rug-radar && npm install --silent 2>&1 | tail -20 && echo "INSTALL_DONE"
- `run` npm run typecheck 2>&1 | tail -30 && echo "---BUILD---" && npm run build 2>&1 | tail -30 && echo "---TEST---" && npm test 2>&1 | tail -20
- `run` for f in $(find src -name "*.test.ts"); do echo "$f: $(grep -c "^\s*test(\|^\s*await test(\|^test(\|^\s*void test(" $f 2>/dev/null)"; done; echo "---"; grep -rn "test(" src/wsLogParser.test.ts | wc -l; grep -rn "test(" src/wsDiscovery.test.ts | wc -l
- `run` grep -rn "session 36\|Session 36" src/ README.md 2>/dev/null
- `run` timeout 170 node --import tsx tmp-probe-rescore2.ts 2>&1 | tail -100; echo "PROBE_EXIT=$?"
- `think` Need the `--experimental-websocket` flag, same as `npm start` uses. Let me rerun with it set.
- `run` NODE_OPTIONS=--experimental-websocket timeout 170 node --import tsx tmp-probe-rescore2.ts 2>&1 | tail -150; echo "PROBE_EXIT=$?"
- `think` This is the confirmation needed — got a real end-to-end result: mint with 3 buys + 10 sells produced 2 positive-balance holders and a valid rescore signal. Let me clean up and document this.
- `run` rm -f tmp-probe-rescore2.ts && git status
- `think` Now let's find the right place in README to document this confirmation.
- `run` grep -n "Session 35\|Session 34\|RESCORE_DELAY_MS\|rescore mechanism\|Known limitations" README.md | head -40
- `read` rug-radar/README.md
- `read` rug-radar/README.md
- `think` Now I'll append the Session 36 confirmation right after the Session 35 writeup.
- `edit` rug-radar/README.md
- `think` Now let's check the "Known limitations" section to see if anything there needs updating.
- `read` rug-radar/README.md
- `read` rug-radar/README.md
- `think` Now let me add the Session 36 confirmation right after Session 35's entry in this limitations section.
- `edit` rug-radar/README.md
- `think` Now let's verify the suite is still clean and append the PROGRESS.md entry for Session 36.
- `run` npm run typecheck 2>&1 | tail -10 && npm test 2>&1 | tail -8 && echo --- && git status --short
- `think` Good, clean. Now append the PROGRESS.md entry.
- `edit` PROGRESS.md
- `think` I need to anchor to the very last occurrence uniquely — let me use the Session 35 "Next" section context.
- `edit` PROGRESS.md
- `think` Final check of git status and a quick sanity confirmation that everything is clean.
- `run` cd /home/runner/work/buildvote-agent/buildvote-agent && git status --short && echo --- && cd rug-radar && npm run typecheck 2>&1 | tail -5 && npm test 2>&1 | tail -8
- `think` Everything's clean: 162/162 tests pass, typecheck is clean, and only the intended files changed (no leftover scratch files or processes).
