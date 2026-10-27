# Session 111: Rug radar: live launch scoring

- Started: 2026-10-27T08:56:16Z
- Ended: 2026-10-27T09:02:23Z
- Steps: 34
- Model turns: 35
- Billing: Claude subscription (API value $1.5044, not billed)
- Outcome: ok

## Summary

This session resolved the long-standing "non-SOL quote mint" open question (sessions 86/102/107's "Next" item):  - Properly derived pump.fun's `Global` config PDA (seeds `["global"]`) via a from-scratch ed25519 off-curve bump search — no guessed addresses — and fetched it live, confirming `whitelisted_quote_mints[0]` is currently USDC, not SOL. - Cross-checked the full 56-instruction public IDL and found `create`/`create_v2` (the only instructions that create a bonding curve, and the only ones rug-radar watches) take no `quote_mint` account at all — so every launch rug-radar can discover is S…

## Steps

- `think` I'll start by reading the task and progress files to see where things stand.
- `run` cat TASK.md 2>/dev/null; echo "---PROGRESS---"; cat PROGRESS.md 2>/dev/null
- `read` PROGRESS.md
- `think` PROGRESS.md is unusually large (402KB). Let me check its structure and read the tail to find the latest session status.
- `run` wc -l PROGRESS.md TASK.md; echo "---tail---"; tail -n 150 PROGRESS.md
- `run` git log --oneline -20 && echo "---logs---" && ls logs/ | tail -20
- `run` cat logs/session-0110.md 2>/dev/null | tail -200
- `think` Now let me check the current repo state and establish a baseline before deciding what to work on this session.
- `run` cd rug-radar && ls -la && echo "---src---" && ls src/ && echo "---install---" && npm install --silent 2>&1 | tail -10 && echo "=== typecheck ===" && npm run typecheck 2>&1 | tail -20 && echo "=== build ===" && npm run build 2>&1 | tail -20 && echo "=== test ===" && npm test 2>&1 | tail -15
- `think` Baseline is clean: 246/246 tests passing, typecheck and build clean. Now let me pick up the open items from the last session's "Next" list — the open items are the non-SOL-quote-mint question (session 102) and the rescore-recovery measurement blocked on live websocket data. Let me investigate the session 102 item first since it's actionable without live network luck.
- `run` cd /home/runner/work/buildvote-agent/buildvote-agent && grep -n "non-SOL-quote-mint\|quote mint\|quote-mint" PROGRESS.md | head -30
- `run` sed -n '5360,5420p' PROGRESS.md
- `run` sed -n '6300,6370p' PROGRESS.md
- `run` find . -iname "*idl*" -not -path "./node_modules/*" 2>/dev/null; grep -rn "idl/pump.json\|whitelisted_quote_mints\|quote_mint\|Global account\|PUMP_FUN_PROGRAM_ID" rug-radar/src/*.ts | head -30
- `run` cd rug-radar && cat package.json && echo "---node_modules top---" && ls node_modules | grep -i -E "noble|ed25519|tweetnacl|elliptic|sol"
- `run` cd rug-radar && cat src/base58.ts
- `think` Let me write a script to properly derive the pump.fun `Global` PDA (seeds `["global"]`) rather than guessing an address, per the standing rule from sessions 30/86/102 against trusting remembered constants.
- `run` cat > /tmp/derivePda.mts << 'EOF' import { createHash } from "node:crypto"; import { base58Encode, base58Decode } from "/home/runner/work/buildvote-agent/buildvote-agent/rug-radar/src/base58.js";  const p = (1n << 255n) - 19n;  function mod(a: bigint, m: bigint): bigint {   const r = a % m;   return r >= 0n ? r : r + m; } function modpow(base: bigint, exp: bigint, m: bigint): bigint {   let resul…
- `think` Derived PDA: `4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf` (bump 255). Let me verify this account actually exists on-chain and sanity-check it looks like pump.fun's `Global` config.
- `run` curl -s -m 15 -X POST "https://solana-rpc.publicnode.com" -H "Content-Type: application/json" \   -d '{"jsonrpc":"2.0","id":1,"method":"getAccountInfo","params":["4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf",{"encoding":"base64"}]}' | node -e ' let d=""; process.stdin.on("data", c => d += c); process.stdin.on("end", () => {   const r = JSON.parse(d);   console.log(JSON.stringify(r, null, 2)); })…
- `run` cd /home/runner/work/buildvote-agent/buildvote-agent && grep -n "idl/pump.json\|raw.githubusercontent\|curl.*idl\|anchor.*idl\|getIdl\|pump-public-docs\|idl url\|IDL_URL" PROGRESS.md | head -20
- `run` curl -s -m 20 "https://raw.githubusercontent.com/pump-fun/pump-public-docs/main/idl/pump.json" -o /tmp/pump_idl.json && wc -c /tmp/pump_idl.json && python3 -c " import json d = json.load(open('/tmp/pump_idl.json')) for t in d.get('types', []) + d.get('accounts', []):     if t.get('name','').lower() == 'global':         print(json.dumps(t, indent=2)) "
- `run` cat > /tmp/decodeGlobal.mts << 'EOF' import { base58Encode } from "/home/runner/work/buildvote-agent/buildvote-agent/rug-radar/src/base58.js";  const base64 = process.argv[2]; const buf = Buffer.from(base64, "base64"); console.log("total bytes:", buf.length);  const discriminator = Array.from(buf.subarray(0, 8)); console.log("discriminator:", discriminator); const expected = [167, 232, 232, 177, …
- `think` This is an important finding — the derived `Global` account's `whitelisted_quote_mints[0]` decodes to `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` (USDC), not native SOL. Before drawing conclusions, I need to check whether `create`/`create_v2` actually consult this field, or whether there's a separate default.
- `run` python3 -c " import json d = json.load(open('/tmp/pump_idl.json')) for ix in d.get('instructions', []):     if ix.get('name') in ('create', 'create_v2', 'buy', 'sell'):         print('===', ix['name'], '===')         print('args:', [a['name'] for a in ix.get('args', [])])         print('accounts:', [a['name'] for a in ix.get('accounts', [])])         print() "
- `run` cat > /tmp/decodeGlobalFull.mts << 'EOF' import { base58Encode } from "/home/runner/work/buildvote-agent/buildvote-agent/rug-radar/src/base58.js";  const base64 = process.argv[2]; const buf = Buffer.from(base64, "base64");  let off = 8; function readBool() { const v = buf.readUInt8(off); off += 1; return v; } function readPubkey() { const v = base58Encode(buf.subarray(off, off + 32)); off += 32; …
- `run` BASE64_DATA=$(curl -s -m 15 -X POST "https://solana-rpc.publicnode.com" -H "Content-Type: application/json" \   -d '{"jsonrpc":"2.0","id":1,"method":"getAccountInfo","params":["4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf",{"encoding":"base64"}]}' | node -e ' let d=""; process.stdin.on("data", c => d += c); process.stdin.on("end", () => {   const r = JSON.parse(d);   process.stdout.write(r.result…
- `run` python3 -c " import json d = json.load(open('/tmp/pump_idl.json')) for ix in d.get('instructions', []):     accs = [a['name'] for a in ix.get('accounts', [])]     args = [a['name'] for a in ix.get('args', [])]     if any('quote' in a.lower() for a in accs+args) or any('global_params' in a for a in accs):         print('===', ix['name'], '===')         print('args:', args)         print('accounts:…
- `think` Rug-radar's own tests mention decoding `BuyV2`/`SellV2`/`BuyV3`/`SellV3` — and the IDL shows those variants take an explicit `quote_mint` account, used by pump.fun's newer multi-quote-mint bonding curves (confirmed live: `Global.whitelisted_quote_mints[0]` is USDC). I need to check whether `pumpfun.ts`'s decoder for those variants correctly handles a non-SOL quote mint, or silently assumes SOL.
- `run` cd rug-radar && grep -n "quote_mint\|quoteMint\|TRADE_ACCOUNT_INDEX\|BuyV2\|BuyV3\|SellV2\|SellV3\|decodeTradeInstruction" src/pumpfun.ts | head -60
- `read` rug-radar/src/pumpfun.ts
- `run` python3 -c " import json d = json.load(open('/tmp/pump_idl.json')) names = [ix['name'] for ix in d.get('instructions', [])] print(len(names), 'instructions') for n in sorted(names):     print(n) "
- `think` This resolves the long-standing open question. Let me verify where this risk is documented in the README and update it with the structural proof.
- `run` cd rug-radar && grep -n "quote.mint\|quote mint\|whitelisted" README.md
- `run` grep -n "quote.mint\|quote mint\|whitelisted" README.md
- `run` grep -n "^## \|^### " README.md | sed -n '1,80p'
- `read` rug-radar/README.md
- `edit` rug-radar/README.md
- `think` Now let me update the comment in `pumpfun.ts` that previously left this as an open caveat.
- `edit` rug-radar/src/pumpfun.ts
- `think` Now let me run the full checks and clean up temp files before updating PROGRESS.md.
- `run` npm run typecheck 2>&1 | tail -10 && npm run build 2>&1 | tail -10 && npm test 2>&1 | tail -10 && cd .. && echo "---git status---" && git status --short
- `think` 246/246 tests pass, typecheck and build clean. Let me clean up the temp scripts and update PROGRESS.md.
- `run` rm -f /tmp/derivePda.mts /tmp/decodeGlobal.mts /tmp/decodeGlobalFull.mts /tmp/pump_idl.json; ls /tmp/*.mts /tmp/*.ts /tmp/*.json 2>/dev/null; echo "(none left)"
- `run` cat >> /home/runner/work/buildvote-agent/buildvote-agent/PROGRESS.md << 'PROGRESS_EOF'  ## Session 108 — 2026-10-27  ### Done - Fresh checkout; `npm install`, then `npm run typecheck`/`npm run build`   clean, `npm test` 246/246 — matches session 107's count, no drift. - Picked up the non-SOL-quote-mint question open since session 86/102   (last touched session 107, untouched that session). Resolv…
- `think` Final sanity check that everything is still clean before wrapping up.
- `run` cd /home/runner/work/buildvote-agent/buildvote-agent/rug-radar && npm run typecheck 2>&1 | tail -5 && npm run build 2>&1 | tail -5 && npm test 2>&1 | tail -8 && cd .. && git status --short && ls /tmp/*.mts /tmp/*.ts /tmp/*.json 2>/dev/null; echo "(temp files, none expected)"
- `think` This session resolved the long-standing "non-SOL quote mint" open question (sessions 86/102/107's "Next" item):
