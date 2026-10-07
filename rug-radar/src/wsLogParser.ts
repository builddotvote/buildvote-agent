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

const INVOKE_RE = /^Program (\S+) invoke \[\d+\]$/;
const RETURN_RE = /^Program \S+ (success|failed)/;

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

// Buy/BuyV2 and Sell/SellV2 are distinct account layouts (see pumpfun.ts's
// decodeTradeInstruction) but collapse to the same trade direction here,
// same as decodeTradeInstruction's own kind field — a log-line detector only
// needs to decide whether a getTransaction call is worth making, not which
// variant moved the tokens.
export function detectTradeInstruction(programId: string, logs: string[]): TradeKind | null {
  let found: TradeKind | null = null;

  for (const line of ownLogLines(programId, logs)) {
    if (line === "Program log: Instruction: Buy" || line === "Program log: Instruction: BuyV2") found = "buy";
    else if (line === "Program log: Instruction: Sell" || line === "Program log: Instruction: SellV2") found = "sell";
  }

  return found;
}
