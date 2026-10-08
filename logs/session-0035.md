# Session 35: Rug radar: live launch scoring

- Started: 2026-10-08T10:31:36Z
- Ended: 2026-10-08T10:40:28Z
- Steps: 49
- Model turns: 50
- Billing: Claude subscription (API value $2.7364, not billed)
- Outcome: ok

## Summary

## Summary  This session picked up Session 34's open item — confirming whether the `BalanceIndex` rescore mechanism actually works live. An isolated probe (tracking every discovered launch directly, bypassing the scoring gate) found **zero trades resolved across 17 launches in 75s**, which pointed to a real bug rather than low sample size.  Root cause: `wsDiscovery.ts`'s notification dedup was keyed only on transaction signature, shared across both the program-wide and per-mint subscriptions. Since every buy/sell transaction gets pushed on *both* subscriptions (it mentions both the program an…

## Steps

- `think` I'll start by reading PROGRESS.md and TASK.md to understand the current state and task.
- `run` echo "=== TASK.md ===" && cat TASK.md 2>/dev/null; echo "=== PROGRESS.md ===" && cat PROGRESS.md 2>/dev/null; echo "=== ls ===" && ls -la
- `read` PROGRESS.md
- `read` PROGRESS.md
- `run` cat /home/runner/.claude/projects/-home-runner-work-buildvote-agent-buildvote-agent/memory/MEMORY.md 2>/dev/null; echo "---"; ls /home/runner/.claude/projects/-home-runner-work-buildvote-agent-buildvote-agent/memory/ 2>/dev/null
- `run` ls -la /home/runner/.claude/projects/-home-runner-work-buildvote-agent-buildvote-agent/memory/ 2>&1
- `run` cd /home/runner/work/buildvote-agent/buildvote-agent/rug-radar && npm install --silent 2>&1 | tail -20 && npm test 2>&1 | tail -30 && npm run typecheck 2>&1 | tail -20 && npm run build 2>&1 | tail -20
- `think` Good, repo is clean: 159/159 tests, clean typecheck/build. Now let me look at the current wiring to plan the isolated live check Session 34 suggested.
- `run` sed -n '1,200p' src/server.ts
- `run` sed -n '1,260p' src/wsDiscovery.ts
- `run` sed -n '1,60p' src/config.ts; echo ---; sed -n '1,40p' src/balanceIndex.ts | head -60
- `think` Now let me write the isolated probe script to test trackMint/onTrade directly against live launches.
- `edit` rug-radar/tmp-probe-rescore.ts
- `run` NODE_OPTIONS=--experimental-websocket node --import tsx tmp-probe-rescore.ts 2>&1 | tail -100
- `think` 17 launches tracked but zero trades resolved — that's a stronger signal than just "low sample size," worth digging into whether notifications are even arriving on the mint subscriptions. Let me add raw-message logging via a wrapped WebSocket factory.
- `run` sed -n '260,340p' src/wsDiscovery.ts
- `think` Found a likely real bug: the dedup `seen` set in `handleMessage` is shared across both the program-wide subscription and per-mint subscriptions, keyed only by signature. Since every buy/sell transaction gets pushed on *both* subscriptions (it mentions both the program and the bonding curve), whichever notification arrives first marks the signature "seen" — and the second one (often the trade-rele…
- `run` grep -n "markSeen\|seen\b\|dedup\|maxSeenSignatures\|resubscribe" src/wsDiscovery.test.ts | head -60
- `run` sed -n '200,260p' src/wsDiscovery.test.ts
- `run` grep -n "resolves a trade notification\|onTrade\|does not call onTrade" src/wsDiscovery.test.ts | head -20
- `read` rug-radar/src/wsDiscovery.test.ts
- `run` grep -n "seen\b\|seenOrder\|markSeen" src/wsDiscovery.ts
- `think` Now let's apply the fix: dedup by `(purpose, signature)` so the same transaction can be independently processed by both the create-check and trade-check paths.
- `read` rug-radar/src/wsDiscovery.ts
- `edit` rug-radar/src/wsDiscovery.ts
- `edit` rug-radar/src/wsDiscovery.ts
- `think` Now let's run the test suite, typecheck, and build to confirm the fix doesn't break anything.
- `run` npm run typecheck 2>&1 | tail -20 && npm test 2>&1 | tail -20
- `think` All 159 tests still pass. Now let me add a regression test for the cross-subscription dedup collision, then re-run the live probe to see if trades actually resolve now.
- `run` grep -n "^function tradeFixtureTx\|^function logsNotification\|^function subscribeAckFor\|^function fixtureTx\b" src/wsDiscovery.test.ts
- `read` rug-radar/src/wsDiscovery.test.ts
- `think` Now I have enough context to write the regression test. Let me insert it right after the existing "resolves a trade notification" test.
- `read` rug-radar/src/wsDiscovery.test.ts
- `edit` rug-radar/src/wsDiscovery.test.ts
- `run` npm run typecheck 2>&1 | tail -20 && npm test 2>&1 | tail -15
- `think` Let me verify this test actually catches the bug by temporarily reverting the fix.
- `run` git diff src/wsDiscovery.ts > /tmp/fix.patch && git stash -- src/wsDiscovery.ts && npx tsx --test src/wsDiscovery.test.ts 2>&1 | grep -A5 "program-wide subscription sees"; git stash pop
- `think` Confirmed: the test fails without the fix and passes with it. Now let me re-run the live probe to see if the fix actually resolves trades in practice.
- `run` npm test 2>&1 | tail -8
- `think` Good, fix restored and suite is clean. Now the live re-check.
- `run` NODE_OPTIONS=--experimental-websocket node --import tsx tmp-probe-rescore.ts 2>&1 | tail -100
- `think` The fix works — 5 real trades resolved live (previously zero across 17 tracked mints). The "0 holders" result is expected: all 5 were sells from wallets that bought before this process started tracking, so they clamp to zero per the documented pre-existing-balance caveat — not a new bug. Let me clean up the scratch probe and update the README and PROGRESS.md.
- `run` rm -f tmp-probe-rescore.ts && git status --short
- `run` grep -n "Known limitations" -A5 README.md | head -20
- `run` sed -n '100,230p' README.md
- `run` grep -n "^## Known limitations" -A3 README.md; grep -n "^## " README.md
- `run` grep -n "Known limitations" README.md
- `run` sed -n '245,506p' README.md
- `edit` rug-radar/README.md
- `think` Now update the "Known limitations" section's session-34 entry with a session-35 continuation.
- `run` grep -n "the two endpoints' gap" README.md
- `read` rug-radar/README.md
- `edit` rug-radar/README.md
- `think` Now let's run the full verification suite once more and check git status before writing PROGRESS.md.
- `run` npm run typecheck 2>&1 | tail -10 && npm run build 2>&1 | tail -10 && npm test 2>&1 | tail -10 && echo "--- git status ---" && cd .. && git status --short
- `think` Clean. No stray scratch files, no process left running. Now let's write the PROGRESS.md session entry.
- `edit` PROGRESS.md
- `read` PROGRESS.md
- `edit` PROGRESS.md
- `think` Let me do a final sanity pass: confirm the repo state, no stray files/processes, and tests still pass.
- `run` git status --short && echo "---" && ps aux | grep -i "node\|tsx" | grep -v grep && echo "--- (no leftover processes above is fine) ---" && cd rug-radar && npm test 2>&1 | tail -8
- `run` cd /home/runner/work/buildvote-agent/buildvote-agent/rug-radar && npm test 2>&1 | tail -8
- `think` Clean: no leftover processes, git status shows only the intended files changed, and 160/160 tests pass.
- `run` mkdir -p /home/runner/.claude/projects/-home-runner-work-buildvote-agent-buildvote-agent/memory/
- `edit` /home/runner/.claude/projects/-home-runner-work-buildvote-agent-buildvote-agent/memory/feedback_live_checks_foreground.md
- `edit` /home/runner/.claude/projects/-home-runner-work-buildvote-agent-buildvote-agent/memory/feedback_verify_raw_specs.md
- `edit` /home/runner/.claude/projects/-home-runner-work-buildvote-agent-buildvote-agent/memory/MEMORY.md
- `think` ## Summary
