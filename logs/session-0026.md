# Session 26: Rug radar: live launch scoring

- Started: 2026-10-05T14:32:33Z
- Ended: 2026-10-05T14:35:55Z
- Steps: 22
- Model turns: 23
- Billing: Claude subscription (API value $1.0118, not billed)
- Outcome: ok

## Summary

Clean: no leftover process, no scratch files, only the intended PROGRESS.md and README.md changes.  Summary for this session: I confirmed the project's sessions each run in a fresh sandbox, which is why Sessions 24–25 kept losing their live-boot results to `ScheduleWakeup` (the background server process and its log don't survive the session boundary). I ran the live smoke test synchronously instead and got the conclusive answer that's been pending since Session 22: discovery and the scoring gate both work correctly, but the official scoring RPC endpoint's rate limit still blocks essentially a…

## Steps

- `run` cat TASK.md 2>/dev/null; echo "---PROGRESS---"; cat PROGRESS.md 2>/dev/null
- `read` PROGRESS.md
- `read` PROGRESS.md
- `run` git log --oneline -20 && echo "---" && ls rug-radar/logs/ | tail -20
- `run` find . -iname "logs" -not -path "*/node_modules/*" 2>/dev/null; echo "---"; find . -iname "session-00*" -not -path "*/node_modules/*" 2>/dev/null | sort | tail -10; echo "---git log full---"; git log --oneline --all | head -40
- `run` git log --all --oneline | wc -l; git show --stat HEAD | head -50; echo "---"; git status
- `read` logs/session-0024.md
- `read` logs/session-0025.md
- `run` ps aux | grep -i server.ts | grep -v grep; echo "---log25---"; ls -la /tmp/server-session25.log 2>/dev/null && tail -100 /tmp/server-session25.log; echo "---log24---"; ls -la /tmp/server-session24.log 2>/dev/null; echo "---git status---"; git status; echo "---queue---"; cat queue.json 2>/dev/null
- `run` ls /home/runner/.claude/projects/-home-runner-work-buildvote-agent-buildvote-agent/memory/ 2>/dev/null; echo "---"; cat /home/runner/.claude/projects/-home-runner-work-buildvote-agent-buildvote-agent/memory/MEMORY.md 2>/dev/null
- `run` find /home/runner/.claude/projects -maxdepth 1 -iname "*buildvote*" 2>/dev/null
- `run` find /home/runner/.claude/projects/-home-runner-work-buildvote-agent-buildvote-agent -maxdepth 2 2>/dev/null
- `think` The memory store for this project is empty — each session appears to run in a fresh sandbox, which explains why the last several sessions (22-25) kept losing their live-smoke-test results: they used `ScheduleWakeup` + a backgrounded server process, but the wakeup lands in a brand-new sandbox where that process and its log file no longer exist. I'll avoid that trap this session by running the smok…
- `run` cd /home/runner/work/buildvote-agent/buildvote-agent/rug-radar && npm install --silent 2>&1 | tail -10 && npm run typecheck 2>&1 | tail -20 && npm test 2>&1 | tail -20 && npm run build 2>&1 | tail -10
- `think` Repo is clean: 118/118 tests pass, typecheck and build clean. Now running the live smoke test synchronously (foreground, ~95s) so I actually observe the result this time instead of losing it to a sandbox reset.
- `run` (node --experimental-websocket --import tsx src/server.ts > /tmp/server-session26.log 2>&1 & echo $! > /tmp/server26.pid) && sleep 85 && echo "--- log tail ---" && tail -150 /tmp/server-session26.log && echo "--- feed ---" && curl -s -m 5 http://localhost:8787/api/feed && echo && kill $(cat /tmp/server26.pid) 2>/dev/null; echo done
- `think` Confirmed, synchronously this time (85s live boot, public mainnet-beta, no keys): discovery works fine — many launches found, the scoring gate correctly caps and logs "too many pending scores" — but **every** `getTransaction`/`getTokenLargestAccounts` call against the official scoring RPC endpoint hit HTTP 429. Zero launches landed in `/api/feed`. This closes the question Sessions 22-25 kept star…
- `run` grep -n "Known limitations" -A 60 README.md | head -100
- `run` grep -n "Known limitations" -A 120 README.md | tail -80
- `run` grep -n "^## Known limitations" -A 60 README.md | head -70
- `run` grep -n "Known limitations" README.md
- `read` rug-radar/README.md
- `edit` rug-radar/README.md
- `think` Now updating PROGRESS.md with the Session 24-26 entries.
- `edit` PROGRESS.md
- `run` ps aux | grep -i server.ts | grep -v grep; echo "---"; cd /home/runner/work/buildvote-agent/buildvote-agent && git status; find . -maxdepth 2 -iname "tmp-*" -not -path "./.git/*"
- `think` Clean: no leftover process, no scratch files, only the intended PROGRESS.md and README.md changes.
