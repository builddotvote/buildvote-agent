import test from "node:test";
import assert from "node:assert/strict";
import { pollOnce } from "./poller.js";
import { LiveFeed } from "./feed.js";
import { PUMP_FUN_PROGRAM_ID } from "./pumpfun.js";
import { base58Encode } from "./base58.js";
import type { ParsedTransaction, SignatureInfo } from "./rpc.js";

const CREATE_DISCRIMINATOR = [24, 30, 200, 40, 5, 28, 7, 119];
const MINT = "Mint1111111111111111111111111111111111111";
const BONDING_CURVE = "BondingCurve11111111111111111111111111111";
const DEPLOYER = "Deployer111111111111111111111111111111111";

const CREATE_ACCOUNTS = [
  MINT,
  "Filler1Program11111111111111111111111111",
  BONDING_CURVE,
  "Filler3Program11111111111111111111111111",
  "Filler4Program11111111111111111111111111",
  "Filler5Program11111111111111111111111111",
  "Filler6Program11111111111111111111111111",
  DEPLOYER,
];

function createTx(): ParsedTransaction {
  const data = base58Encode(Buffer.concat([Buffer.from(CREATE_DISCRIMINATOR), Buffer.alloc(4)]));
  return {
    slot: 1,
    blockTime: 1700000100,
    transaction: {
      signatures: ["sigCreate"],
      message: {
        accountKeys: CREATE_ACCOUNTS.map((pubkey) => ({ pubkey, signer: false, writable: true })),
        instructions: [{ programId: PUMP_FUN_PROGRAM_ID, accounts: CREATE_ACCOUNTS, data }],
      },
    },
    meta: { err: null, fee: 5000, preBalances: [], postBalances: [] },
  };
}

function bondingCurveAccountData(): [string, string] {
  const buf = Buffer.alloc(8 + 5 * 8 + 1 + 32);
  return [buf.toString("base64"), "base64"];
}

// Serves both the discovery poll (address = pump.fun program) and the
// per-signal lookups (address = deployer / bonding curve), keyed by address.
function fakeRpc(programSignatures: SignatureInfo[]) {
  return {
    async getTokenSupply() {
      return { amount: "1000000000", decimals: 6, uiAmount: 1000, uiAmountString: "1000" };
    },
    async getTokenLargestAccounts() {
      return [{ address: BONDING_CURVE, amount: "500000000", decimals: 6, uiAmount: 500, uiAmountString: "500" }];
    },
    async getAccountInfo() {
      return {
        data: bondingCurveAccountData(),
        executable: false,
        lamports: 1,
        owner: PUMP_FUN_PROGRAM_ID,
        rentEpoch: 0,
      };
    },
    async getSignaturesForAddress(address: string, limit: number) {
      if (address === PUMP_FUN_PROGRAM_ID) return programSignatures.slice(0, limit);
      return [];
    },
    async getTransaction(signature: string) {
      return signature === "sigCreate" ? createTx() : null;
    },
  };
}

test("first poll seeds the watermark and scores nothing", async () => {
  const signatures: SignatureInfo[] = [
    { signature: "sigNewest", slot: 1, err: null, memo: null, blockTime: 1700000000 },
  ];
  const feed = new LiveFeed();
  const state = { sinceBlockTime: null };

  await pollOnce(fakeRpc(signatures), fakeRpc(signatures), feed, state);

  assert.equal(state.sinceBlockTime, 1700000000);
  assert.deepEqual(feed.list(), []);
});

test("a later poll scores newly discovered launches into the feed", async () => {
  const signatures: SignatureInfo[] = [
    { signature: "sigCreate", slot: 2, err: null, memo: null, blockTime: 1700000100 },
  ];
  const feed = new LiveFeed();
  const state = { sinceBlockTime: 1700000000 };

  await pollOnce(fakeRpc(signatures), fakeRpc(signatures), feed, state);

  assert.equal(state.sinceBlockTime, 1700000100);
  assert.equal(feed.list().length, 1);
  assert.equal(feed.list()[0].mint, MINT);
});
