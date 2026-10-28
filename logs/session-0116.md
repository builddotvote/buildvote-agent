# Session 116: Rug radar: live launch scoring

- Started: 2026-10-28T20:15:00Z
- Ended: 2026-10-28T20:29:11Z
- Steps: 34
- Model turns: 35
- Billing: Claude subscription (API value $1.5232, not billed)
- Outcome: ok

## Summary

Clean — only `PROGRESS.md` changed, no stray processes or temp files. This session is done; the runner will commit.  **Summary:** Sessions 113–115 had repeatedly tried to measure the holder-concentration rescore recovery rate using background shell jobs + `ScheduleWakeup`, but lost all their work each time because this environment gives every session a fresh sandbox (confirmed `/tmp` was empty at session start). This session identified that root cause, then ran the probe synchronously (two full blocking runs, ~230s and ~310s, inside single `Bash` calls) to finally get real data: of 7 feed min…

## Steps

- `run` cat /home/runner/work/buildvote-agent/buildvote-agent/TASK.md 2>/dev/null; echo "---PROGRESS---"; cat /home/runner/work/buildvote-agent/buildvote-agent/PROGRESS.md 2>/dev/null
- `run` wc -l TASK.md PROGRESS.md && echo "---" && tail -100 PROGRESS.md
- `run` grep -n "^## Session" PROGRESS.md | tail -20 && echo "---LOG---" && git log --oneline -20 && echo "---LOGS DIR---" && ls rug-radar/logs 2>/dev/null | tail -20
- `run` cd rug-radar && ls && echo "---logs---" && find . -iname "*session*" -path "*logs*" | sort | tail -20 && echo "---git show last commit stat---" && cd .. && git show --stat HEAD | head -50
- `run` ls -la && echo "---logs top---" && ls logs | tail -30 && echo "count:" && ls logs | wc -l
- `think` There are session logs up to 115, but PROGRESS.md only documents through session 109. Let me check logs 110-115 to see what was done and catch PROGRESS.md up.
- `run` for i in 110 111 112 113 114 115; do echo "=== session-0$i.md ==="; cat logs/session-0$i.md; echo; done
- `read` /home/runner/.claude/projects/-home-runner-work-buildvote-agent-buildvote-agent/5f15e269-ecc5-445e-b58e-ad3484ae65c9/tool-results/b97tk6bdj.txt
- `run` cd /home/runner/work/buildvote-agent/buildvote-agent/rug-radar && echo "---ps---" && ps aux | grep -E "node|tsx|npm" | grep -v grep && echo "---probe log---" && cat /tmp/rescoreRecoveryProbe.log 2>/dev/null && echo "---probe script exists?---" && ls -la /tmp/rescoreRecoveryProbe.mts 2>/dev/null && echo "---git status---" && cd .. && git status --short
- `run` ls -la /tmp/ 2>/dev/null | head -20; echo "---git status---"; git status --short; echo "---pwd---"; pwd
- `run` cd rug-radar && npm install --silent 2>&1 | tail -10 && echo "=== typecheck ===" && npm run typecheck 2>&1 | tail -20 && echo "=== build ===" && npm run build 2>&1 | tail -20 && echo "=== test ===" && npm test 2>&1 | tail -15
- `think` Baseline is clean: 246/246 tests pass, typecheck/build clean. Now let me check the holder-rescore code to run the recovery-rate probe synchronously within this session, since prior sessions lost their background probes when the sandbox was recycled between sessions.
- `run` cd rug-radar && cat src/holderRescore.ts
- `run` pwd
- `read` rug-radar/src/holderRescore.ts
- `run` grep -n "RESCORE_DELAY_MS\|rescoreDelayMs\|delayMs" src/config.ts src/server.ts
- `run` cat src/watcherOnLaunch.ts; echo "---rescore.ts---"; cat src/rescore.ts
- `run` cat src/types.ts | head -40; echo "---feed.ts---"; grep -n "createdAt\|interface\|class LiveFeed\|add(\|get(\|has(" src/feed.ts | head -30
- `run` node --version
- `think` Node 20 needs the `--experimental-websocket` flag for the live WS discovery. Let me run the full probe in one shot: start the server, poll the feed for ~200s tracking first-seen timestamps per mint, then analyze rescue log lines against that.
- `run` \ rm -f /tmp/rescoreprobe.log /tmp/feedsnap.jsonl && \ (NODE_OPTIONS=--experimental-websocket npm run dev > /tmp/rescoreprobe.log 2>&1 &) && \ sleep 4 && \ curl -s -m 5 http://localhost:8787/api/feed | head -c 200 && echo && echo "server started, polling now" && \ for i in $(seq 1 40); do   ts=$(date +%s)   resp=$(curl -s -m 4 http://localhost:8787/api/feed 2>/dev/null)   if [ -n "$resp" ]; then …
- `run` echo "---feedsnap lines---"; wc -l /tmp/feedsnap.jsonl 2>/dev/null; echo "---server log---"; wc -l /tmp/rescoreprobe.log 2>/dev/null; tail -60 /tmp/rescoreprobe.log 2>/dev/null; echo "---rescored---"; grep -c "rescored holder-concentration" /tmp/rescoreprobe.log 2>/dev/null; echo "---failed---"; grep -c "holder-concentration rescore failed" /tmp/rescoreprobe.log 2>/dev/null; echo "---still runnin…
- `run` kill 9915 9926 2>/dev/null; sleep 1; pgrep -fa "tsx watch src/server" 2>/dev/null; echo "killed check done"
- `think` Good, server is killed. Now let's analyze the feed snapshots to compute the actual recovery rate.
- `run` python3 -c " import json  mints_first_seen = {} last_ts = None with open('/tmp/feedsnap.jsonl') as f:     for line in f:         line = line.strip()         if not line:             continue         d = json.loads(line)         ts = d['ts']         last_ts = ts if last_ts is None else max(last_ts, ts)         for l in d['feed']['launches']:             m = l['mint']             if m not in mints_…
- `run` sed -n '1,260p' src/server.ts
- `run` \ rm -f /tmp/rescoreprobe2.log /tmp/feedsnap2.jsonl && \ (NODE_OPTIONS=--experimental-websocket npm run dev > /tmp/rescoreprobe2.log 2>&1 &) && \ sleep 4 && \ curl -s -m 5 http://localhost:8787/api/feed | head -c 200 && echo && echo "server started, polling now" && \ for i in $(seq 1 56); do   ts=$(date +%s)   resp=$(curl -s -m 4 http://localhost:8787/api/feed 2>/dev/null)   if [ -n "$resp" ]; th…
- `run` pgrep -fa "tsx watch src/server\|tsx/dist\|node.*src/server" 2>/dev/null; echo "---killing---"; pkill -f "tsx" 2>/dev/null; sleep 1; pgrep -fa tsx 2>/dev/null; echo "---rescored---"; grep -c "rescored holder-concentration" /tmp/rescoreprobe2.log; echo "---failed---"; grep -c "holder-concentration rescore failed" /tmp/rescoreprobe2.log; echo "---lines---"; grep "rescored holder-concentration" /tmp…
- `run` echo hello
- `run` pgrep -fa tsx 2>/dev/null; echo "---done---"
- `think` No leftover tsx processes — the server already exited (likely killed by `pkill -f "tsx watch src/server"` in the prior command before the odd exit). Let's check the probe results now.
- `run` echo "---rescored---"; grep -c "rescored holder-concentration" /tmp/rescoreprobe2.log; echo "---failed---"; grep -c "holder-concentration rescore failed" /tmp/rescoreprobe2.log; echo "---lines---"; grep "rescored holder-concentration" /tmp/rescoreprobe2.log; echo "---feedsnap lines---"; wc -l /tmp/feedsnap2.jsonl
- `think` Now let's compute the denominator (mints aged ≥65s by end of run) for this second probe.
- `run` python3 -c " import json  mints_first_seen = {} last_ts = None with open('/tmp/feedsnap2.jsonl') as f:     for line in f:         line = line.strip()         if not line:             continue         d = json.loads(line)         ts = d['ts']         last_ts = ts if last_ts is None else max(last_ts, ts)         for l in d['feed']['launches']:             m = l['mint']             if m not in mints…
- `run` cd /home/runner/work/buildvote-agent/buildvote-agent && git status --short && echo "---tmp cleanup---" && rm -f /tmp/rescoreprobe.log /tmp/rescoreprobe2.log /tmp/feedsnap.jsonl /tmp/feedsnap2.jsonl && ls /tmp/*.log /tmp/*.jsonl 2>/dev/null; echo "(none left)" && echo "---final verify---" && cd rug-radar && npm run typecheck 2>&1 | tail -5 && npm run build 2>&1 | tail -5 && npm test 2>&1 | tail -8
- `think` Clean — 246/246 tests, no uncommitted stray changes. Now let me write up PROGRESS.md with this session's findings, including both the measurement result and the environment-lifecycle lesson.
- `run` cd /home/runner/work/buildvote-agent/buildvote-agent && tail -c 300 PROGRESS.md
- `run` sed -n '6701,6938p' PROGRESS.md
- `edit` PROGRESS.md
- `think` I need to anchor to the very end of the file uniquely. Let me use the last line plus EOF context.
- `run` cat >> PROGRESS.md << 'PROGRESS_EOF'  ## Session 110 — 2026-10-28  ### Done - Fresh checkout; `npm install`, then `npm run typecheck`/`npm run build`   clean, `npm test` 246/246 — matches session 109's count, no drift. - Log sessions 114 and 115 (`logs/session-0114.md`, `logs/session-0115.md`)   both tried to finally run the rescore-recovery-rate probe (the "Next"   item open since session 106) b…
- `think` PROGRESS.md updated. Let me do a final sanity check that everything is in order before finishing.
- `run` git status --short && echo "---tmp check---" && ls /tmp/*.log /tmp/*.jsonl /tmp/*.mts 2>/dev/null; echo "(none expected)" && echo "---no stray procs---" && pgrep -fa "tsx\|npm run dev" 2>/dev/null; echo "(none expected)"
- `think` Clean — only `PROGRESS.md` changed, no stray processes or temp files. This session is done; the runner will commit.
