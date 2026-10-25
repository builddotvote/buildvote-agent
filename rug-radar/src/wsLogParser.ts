// Pure parsing of a transaction's log lines to detect a pump.fun create
// instruction, confirmed against real log output captured live from the
// public websocket RPC (see rug-radar/README.md). Used by wsDiscovery.ts to
// decide which logsSubscribe notifications are worth a getTransaction call,
// instead of fetching every transaction that merely mentions the program.
//
// Anchor logs "Program log: Instruction: <Name>" while execution is inside
// the invoking program's own stack frame, so a plain substring/regex match
// on the whole log array is not enough — a different program's instruction
// can share a name fragment (e.g. "Instruction: CreateTokenAccount" from an
// unrelated program contains "Create"). This tracks the invoke stack via the
// "Program X invoke [N]" / "Program X success"/"failed" lines Solana always
// emits, and only matches while the top of that stack is the given program.

export type CreateVariant = "create" | "create_v2";
export type TradeKind = "buy" | "sell";

// The captured token must look like a program id, not the reserved "log:"
// / "data:" / "return:" prefixes Anchor's own msg!()/emit!() lines use —
// those are a different line kind than a real invoke/return control line,
// and a base58 program id never contains a colon, so excluding ":" from the
// token keeps "Program log: failed ..." (a message that merely starts with
// the word "failed") from being mistaken for "Program <id> failed: ...".
const INVOKE_RE = /^Program ([^\s:]+) invoke \[\d+\]$/;
const RETURN_RE = /^Program [^\s:]+ (success|failed)/;

// Walks the invoke stack and returns only the "Program log:" lines the given
// program emitted about itself (top of stack == programId) — shared by every
// detector below so each one just matches instruction names against this
// already-filtered, CPI-safe list.
function ownLogLines(programId: string, logs: string[]): string[] {
  const stack: string[] = [];
  const own: string[] = [];

  for (const line of logs) {
    const invoke = INVOKE_RE.exec(line);
    if (invoke) {
      stack.push(invoke[1]);
      continue;
    }
    if (RETURN_RE.test(line)) {
      stack.pop();
      continue;
    }
    if (stack[stack.length - 1] === programId) own.push(line);
  }

  return own;
}

export function detectCreateInstruction(programId: string, logs: string[]): CreateVariant | null {
  let found: CreateVariant | null = null;

  for (const line of ownLogLines(programId, logs)) {
    if (line === "Program log: Instruction: Create") found = "create";
    else if (line === "Program log: Instruction: CreateV2") found = "create_v2";
  }

  return found;
}

// Buy/BuyV2/BuyV3 and Sell/SellV2/SellV3 are distinct account layouts (see
// pumpfun.ts's decodeTradeInstruction) but collapse to the same trade
// direction here, same as decodeTradeInstruction's own kind field — a
// log-line detector only needs to decide whether a getTransaction call is
// worth making, not which variant moved the tokens. BuyV3 confirmed live
// (session 104) logging exactly "Instruction: BuyV3", same Anchor
// snake_case-to-PascalCase naming as every other variant here; SellV3
// follows the same pattern per the public IDL (buy_v3/sell_v3).
export function detectTradeInstruction(programId: string, logs: string[]): TradeKind | null {
  let found: TradeKind | null = null;

  for (const line of ownLogLines(programId, logs)) {
    if (
      line === "Program log: Instruction: Buy" ||
      line === "Program log: Instruction: BuyV2" ||
      line === "Program log: Instruction: BuyV3"
    )
      found = "buy";
    else if (
      line === "Program log: Instruction: Sell" ||
      line === "Program log: Instruction: SellV2" ||
      line === "Program log: Instruction: SellV3"
    )
      found = "sell";
  }

  return found;
}
