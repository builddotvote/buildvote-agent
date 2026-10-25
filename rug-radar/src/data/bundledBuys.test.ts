import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchBundledBuysInput } from "./bundledBuys.js";
import type { ParsedTransaction, SignatureInfo } from "../rpc.js";

const MINT = "mint111111111111111111111111111111111111";
const CURVE = "curve11111111111111111111111111111111111";

function sig(signature: string, blockTime: number | null): SignatureInfo {
  return { signature, slot: 1, err: null, memo: null, blockTime };
}

function buyTx(buyer: string, preAmount: string, postAmount: string): ParsedTransaction {
  return {
    slot: 1,
    blockTime: 1000,
    transaction: {
      signatures: ["sig"],
      message: { accountKeys: [{ pubkey: CURVE, signer: false, writable: true }] },
    },
    meta: {
      err: null,
      fee: 5000,
      preBalances: [0],
      postBalances: [0],
      preTokenBalances: [
        {
          accountIndex: 0,
          mint: MINT,
          owner: buyer,
          uiTokenAmount: { amount: preAmount, decimals: 6, uiAmount: null, uiAmountString: preAmount },
        },
      ],
      postTokenBalances: [
        {
          accountIndex: 0,
          mint: MINT,
          owner: buyer,
          uiTokenAmount: { amount: postAmount, decimals: 6, uiAmount: null, uiAmountString: postAmount },
        },
      ],
    },
  };
}

// A real sell: the seller's balance of `mint` drops while the bonding
// curve's own token account for that mint rises by the same shape (two
// entries, not the single-entry shape `buyTx` uses) — confirmed live
// (session 103) against a real pump.fun bonding curve's recent signatures.
function sellTxAgainstCurve(
  seller: string,
  sellerPre: string,
  sellerPost: string,
  curvePre: string,
  curvePost: string,
): ParsedTransaction {
  return {
    slot: 1,
    blockTime: 1000,
    transaction: {
      signatures: ["sig"],
      message: {
        accountKeys: [
          { pubkey: seller, signer: true, writable: true },
          { pubkey: CURVE, signer: false, writable: true },
        ],
      },
    },
    meta: {
      err: null,
      fee: 5000,
      preBalances: [0, 0],
      postBalances: [0, 0],
      preTokenBalances: [
        {
          accountIndex: 0,
          mint: MINT,
          owner: seller,
          uiTokenAmount: { amount: sellerPre, decimals: 6, uiAmount: null, uiAmountString: sellerPre },
        },
        {
          accountIndex: 1,
          mint: MINT,
          owner: CURVE,
          uiTokenAmount: { amount: curvePre, decimals: 6, uiAmount: null, uiAmountString: curvePre },
        },
      ],
      postTokenBalances: [
        {
          accountIndex: 0,
          mint: MINT,
          owner: seller,
          uiTokenAmount: { amount: sellerPost, decimals: 6, uiAmount: null, uiAmountString: sellerPost },
        },
        {
          accountIndex: 1,
          mint: MINT,
          owner: CURVE,
          uiTokenAmount: { amount: curvePost, decimals: 6, uiAmount: null, uiAmountString: curvePost },
        },
      ],
    },
  };
}

function fundingTx(recipient: string, sender: string, amount: number): ParsedTransaction {
  return {
    slot: 1,
    blockTime: 900,
    transaction: {
      signatures: ["funding-sig"],
      message: {
        accountKeys: [
          { pubkey: sender, signer: true, writable: true },
          { pubkey: recipient, signer: false, writable: true },
        ],
      },
    },
    meta: {
      err: null,
      fee: 5000,
      preBalances: [amount + 5000, 0],
      postBalances: [0, amount],
    },
  };
}

test("finds a buyer and their funding source for an early buy", async () => {
  const rpc = {
    getSignaturesForAddress: async (address: string) => {
      if (address === CURVE) return [sig("buy-sig", 1050)];
      if (address === "buyerA") return [sig("funding-sig", 900)];
      return [];
    },
    getTransaction: async (signature: string) => {
      if (signature === "buy-sig") return buyTx("buyerA", "0", "1000");
      if (signature === "funding-sig") return fundingTx("buyerA", "funder1", 2_000_000_000);
      return null;
    },
  };

  const result = await fetchBundledBuysInput(rpc, MINT, CURVE, 1000, { windowSeconds: 300 });
  assert.equal(result.length, 1);
  assert.equal(result[0].buyer, "buyerA");
  assert.equal(result[0].fundedBy, "funder1");
  assert.equal(result[0].secondsAfterLaunch, 50);
});

test("ignores transactions outside the early window", async () => {
  const rpc = {
    getSignaturesForAddress: async (address: string) => {
      if (address === CURVE) return [sig("late-sig", 5000)];
      return [];
    },
    getTransaction: async () => buyTx("buyerA", "0", "1000"),
  };

  const result = await fetchBundledBuysInput(rpc, MINT, CURVE, 1000, { windowSeconds: 300 });
  assert.equal(result.length, 0);
});

test("skips transactions with no increase in the tracked mint (e.g. a sell)", async () => {
  const rpc = {
    getSignaturesForAddress: async (address: string) => {
      if (address === CURVE) return [sig("sell-sig", 1050)];
      return [];
    },
    getTransaction: async () => buyTx("buyerA", "1000", "500"),
  };

  const result = await fetchBundledBuysInput(rpc, MINT, CURVE, 1000, { windowSeconds: 300 });
  assert.equal(result.length, 0);
});

test("does not report the bonding curve itself as a buyer when a sell sends tokens back to it", async () => {
  const rpc = {
    getSignaturesForAddress: async (address: string) => {
      if (address === CURVE) return [sig("sell-sig", 1050)];
      return [];
    },
    getTransaction: async () => sellTxAgainstCurve("seller1", "1000", "500", "0", "500"),
  };

  const result = await fetchBundledBuysInput(rpc, MINT, CURVE, 1000, { windowSeconds: 300 });
  assert.equal(result.length, 0);
});

test("reports a null funding source when the buyer has no prior transactions", async () => {
  const rpc = {
    getSignaturesForAddress: async (address: string) => {
      if (address === CURVE) return [sig("buy-sig", 1050)];
      if (address === "buyerA") return [];
      return [];
    },
    getTransaction: async (signature: string) =>
      signature === "buy-sig" ? buyTx("buyerA", "0", "1000") : null,
  };

  const result = await fetchBundledBuysInput(rpc, MINT, CURVE, 1000, { windowSeconds: 300 });
  assert.equal(result.length, 1);
  assert.equal(result[0].fundedBy, null);
});

test("finds the funding source when it's not the buyer's single oldest transaction", async () => {
  const rpc = {
    getSignaturesForAddress: async (address: string) => {
      if (address === CURVE) return [sig("buy-sig", 1050)];
      // Newest-first: an unrelated, older transaction sits before (i.e. is
      // older than) the real funding transfer within the lookback limit.
      if (address === "buyerA") return [sig("funding-sig", 920), sig("unrelated-sig", 900)];
      return [];
    },
    getTransaction: async (signature: string) => {
      if (signature === "buy-sig") return buyTx("buyerA", "0", "1000");
      if (signature === "funding-sig") return fundingTx("buyerA", "funder1", 2_000_000_000);
      if (signature === "unrelated-sig") {
        // A transaction involving buyerA that isn't a SOL funding transfer
        // (balance unchanged) — e.g. some other activity, or a failed tx.
        return {
          slot: 1,
          blockTime: 900,
          transaction: {
            signatures: ["unrelated-sig"],
            message: { accountKeys: [{ pubkey: "buyerA", signer: true, writable: true }] },
          },
          meta: { err: null, fee: 5000, preBalances: [1000], postBalances: [1000] },
        } satisfies ParsedTransaction;
      }
      return null;
    },
  };

  const result = await fetchBundledBuysInput(rpc, MINT, CURVE, 1000, { windowSeconds: 300 });
  assert.equal(result.length, 1);
  assert.equal(result[0].fundedBy, "funder1");
});

test("caches the funding-source lookup when the same buyer appears twice", async () => {
  let fundingLookups = 0;
  const rpc = {
    getSignaturesForAddress: async (address: string) => {
      if (address === CURVE) return [sig("buy-sig-1", 1010), sig("buy-sig-2", 1020)];
      if (address === "buyerA") {
        fundingLookups++;
        return [sig("funding-sig", 900)];
      }
      return [];
    },
    getTransaction: async (signature: string) => {
      if (signature === "buy-sig-1" || signature === "buy-sig-2") {
        return buyTx("buyerA", "0", "1000");
      }
      if (signature === "funding-sig") return fundingTx("buyerA", "funder1", 2_000_000_000);
      return null;
    },
  };

  const result = await fetchBundledBuysInput(rpc, MINT, CURVE, 1000, { windowSeconds: 300 });
  assert.equal(result.length, 2);
  assert.equal(fundingLookups, 1);
});

test("uses the known bundled buy directly instead of re-fetching its transaction", async () => {
  let createTxFetches = 0;
  const rpc = {
    getSignaturesForAddress: async (address: string) => {
      // The create tx also touches the bonding curve, so it shows up here
      // same as any other early signature would.
      if (address === CURVE) return [sig("create-sig", 1000)];
      if (address === "devBuyer") return [sig("funding-sig", 900)];
      return [];
    },
    getTransaction: async (signature: string) => {
      if (signature === "create-sig") {
        createTxFetches++;
        return buyTx("devBuyer", "0", "1000");
      }
      if (signature === "funding-sig") return fundingTx("devBuyer", "funder1", 2_000_000_000);
      return null;
    },
  };

  const result = await fetchBundledBuysInput(rpc, MINT, CURVE, 1000, {
    windowSeconds: 300,
    knownBundledBuy: { buyer: "devBuyer", signature: "create-sig" },
  });

  assert.equal(createTxFetches, 0);
  assert.equal(result.length, 1);
  assert.equal(result[0].buyer, "devBuyer");
  assert.equal(result[0].fundedBy, "funder1");
  assert.equal(result[0].secondsAfterLaunch, 0);
});

test("still finds other early buyers alongside a known bundled buy", async () => {
  const rpc = {
    getSignaturesForAddress: async (address: string) => {
      if (address === CURVE) return [sig("create-sig", 1000), sig("buy-sig", 1050)];
      return [];
    },
    getTransaction: async (signature: string) => {
      if (signature === "buy-sig") return buyTx("buyerB", "0", "1000");
      return null;
    },
  };

  const result = await fetchBundledBuysInput(rpc, MINT, CURVE, 1000, {
    windowSeconds: 300,
    knownBundledBuy: { buyer: "devBuyer", signature: "create-sig" },
  });

  assert.equal(result.length, 2);
  assert.ok(result.some((r) => r.buyer === "devBuyer" && r.secondsAfterLaunch === 0));
  assert.ok(result.some((r) => r.buyer === "buyerB"));
});
