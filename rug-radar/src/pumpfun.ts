// pump.fun program constants and the bonding curve account layout, per the
// public spec at https://github.com/pump-fun/pump-public-docs
// (docs/PUMP_PROGRAM_README.md). No private endpoints or keys involved —
// this is just how to read data that's already public on-chain.

import { base58Decode, base58Encode } from "./base58.js";

export const PUMP_FUN_PROGRAM_ID = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";

export interface BondingCurveAccount {
  virtualTokenReserves: bigint;
  virtualSolReserves: bigint;
  realTokenReserves: bigint;
  realSolReserves: bigint;
  tokenTotalSupply: bigint;
  complete: boolean;
  creator: string;
}

// Anchor-style account: 8-byte discriminator, then five little-endian u64
// fields, a bool, then the 32-byte creator pubkey. Later fields
// (is_mayhem_mode, quote_mint, ...) exist but aren't needed here.
const DISCRIMINATOR_BYTES = 8;
const U64_BYTES = 8;
const BOOL_BYTES = 1;
const PUBKEY_BYTES = 32;

export function decodeBondingCurve(base64Data: string): BondingCurveAccount {
  const buf = Buffer.from(base64Data, "base64");
  const minLength =
    DISCRIMINATOR_BYTES + 5 * U64_BYTES + BOOL_BYTES + PUBKEY_BYTES;
  if (buf.length < minLength) {
    throw new Error(
      `bonding curve account data too short: got ${buf.length} bytes, need at least ${minLength}`,
    );
  }

  let offset = DISCRIMINATOR_BYTES;
  const readU64 = (): bigint => {
    const value = buf.readBigUInt64LE(offset);
    offset += U64_BYTES;
    return value;
  };

  const virtualTokenReserves = readU64();
  const virtualSolReserves = readU64();
  const realTokenReserves = readU64();
  const realSolReserves = readU64();
  const tokenTotalSupply = readU64();
  const complete = buf.readUInt8(offset) !== 0;
  offset += BOOL_BYTES;
  const creator = base58Encode(buf.subarray(offset, offset + PUBKEY_BYTES));

  return {
    virtualTokenReserves,
    virtualSolReserves,
    realTokenReserves,
    realSolReserves,
    tokenTotalSupply,
    complete,
    creator,
  };
}

// The "create" (new coin) and "create_v2" (spl-token-2022 coin) instruction
// discriminators, and the fixed position of the accounts we care about,
// per the program's public Anchor IDL (pump-fun/pump-public-docs,
// idl/pump.json). Account order is part of the on-chain interface and
// changes only with a new instruction variant, unlike the free-form
// instruction args.
const CREATE_DISCRIMINATOR = [24, 30, 200, 40, 5, 28, 7, 119];
const CREATE_V2_DISCRIMINATOR = [214, 144, 76, 236, 95, 139, 49, 180];

// accounts[] index of each field we need, per instruction variant.
const CREATE_ACCOUNT_INDEX = { mint: 0, bondingCurve: 2, user: 7 };
const CREATE_V2_ACCOUNT_INDEX = { mint: 0, bondingCurve: 2, user: 4 };

export interface CreateInstructionAccounts {
  mint: string;
  bondingCurve: string;
  user: string;
}

function matchesDiscriminator(bytes: Uint8Array, expected: number[]): boolean {
  if (bytes.length < expected.length) return false;
  return expected.every((byte, i) => bytes[i] === byte);
}

// Reads the mint, bonding curve, and deployer (user) accounts out of a
// pump.fun "create" or "create_v2" instruction. Returns null if the
// instruction's discriminator doesn't match either variant, or if the
// account list is shorter than expected.
export function decodeCreateInstruction(
  dataBase58: string,
  accounts: string[],
): CreateInstructionAccounts | null {
  let data: Uint8Array;
  try {
    data = base58Decode(dataBase58);
  } catch {
    return null;
  }

  const layout = matchesDiscriminator(data, CREATE_DISCRIMINATOR)
    ? CREATE_ACCOUNT_INDEX
    : matchesDiscriminator(data, CREATE_V2_DISCRIMINATOR)
      ? CREATE_V2_ACCOUNT_INDEX
      : null;
  if (!layout) return null;

  const mint = accounts[layout.mint];
  const bondingCurve = accounts[layout.bondingCurve];
  const user = accounts[layout.user];
  if (!mint || !bondingCurve || !user) return null;

  return { mint, bondingCurve, user };
}

// "buy" and "sell" discriminators and their shared account layout, per the
// same public IDL. The two variants list accounts in a different order
// overall (e.g. creator_vault/token_program swap places), but mint,
// bonding_curve, and user sit at the same index in both, so one layout
// covers both. The first instruction arg in both is `amount` — the token
// amount traded, in the mint's raw base units — which is what a future
// per-wallet balance index needs; later args (max_sol_cost/min_sol_output,
// track_volume) aren't read here.
const BUY_DISCRIMINATOR = [102, 6, 61, 18, 1, 218, 235, 234];
const SELL_DISCRIMINATOR = [51, 230, 133, 164, 1, 127, 131, 173];
const TRADE_ACCOUNT_INDEX = { mint: 2, bondingCurve: 3, user: 6 };

export interface TradeInstruction {
  kind: "buy" | "sell";
  mint: string;
  bondingCurve: string;
  user: string;
  amount: bigint;
}

// Reads the kind (buy/sell), mint/bondingCurve/user accounts, and token
// amount out of a pump.fun "buy" or "sell" instruction. Returns null if the
// discriminator doesn't match either variant, the account list is too
// short, or the data is too short to contain the amount arg.
export function decodeTradeInstruction(
  dataBase58: string,
  accounts: string[],
): TradeInstruction | null {
  let data: Uint8Array;
  try {
    data = base58Decode(dataBase58);
  } catch {
    return null;
  }

  const kind = matchesDiscriminator(data, BUY_DISCRIMINATOR)
    ? "buy"
    : matchesDiscriminator(data, SELL_DISCRIMINATOR)
      ? "sell"
      : null;
  if (!kind) return null;

  const mint = accounts[TRADE_ACCOUNT_INDEX.mint];
  const bondingCurve = accounts[TRADE_ACCOUNT_INDEX.bondingCurve];
  const user = accounts[TRADE_ACCOUNT_INDEX.user];
  if (!mint || !bondingCurve || !user) return null;

  if (data.length < DISCRIMINATOR_BYTES + U64_BYTES) return null;
  const amount = Buffer.from(data).readBigUInt64LE(DISCRIMINATOR_BYTES);

  return { kind, mint, bondingCurve, user, amount };
}
