import test from "node:test";
import assert from "node:assert/strict";
import { scoreClass, renderLaunch } from "./feed.js";

test("scoreClass: below 40 is low", () => {
  assert.equal(scoreClass(0), "low");
  assert.equal(scoreClass(39), "low");
});

test("scoreClass: 40-69 is medium", () => {
  assert.equal(scoreClass(40), "medium");
  assert.equal(scoreClass(69), "medium");
});

test("scoreClass: 70 and up is high", () => {
  assert.equal(scoreClass(70), "high");
  assert.equal(scoreClass(100), "high");
});

test("renderLaunch: includes the mint, score, and class for the score band", () => {
  const html = renderLaunch({
    mint: "Mint1111111111111111111111111111111111111",
    score: 85,
    signals: [],
  });

  assert.match(html, /Mint1111111111111111111111111111111111111/);
  assert.match(html, /class="score high">85</);
});

test("renderLaunch: renders each signal's name, score, and reasons", () => {
  const html = renderLaunch({
    mint: "Mint2222222222222222222222222222222222222",
    score: 42,
    signals: [
      { name: "holder-concentration", score: 42, reasons: ["top 10 hold 42% (30-50%)"] },
      { name: "liquidity", score: 10, reasons: ["deep real liquidity"] },
    ],
  });

  assert.match(html, /holder-concentration<\/span>: 42/);
  assert.match(html, /<li>top 10 hold 42% \(30-50%\)<\/li>/);
  assert.match(html, /liquidity<\/span>: 10/);
  assert.match(html, /<li>deep real liquidity<\/li>/);
});

test("renderLaunch: a launch with no signals renders without a signal block", () => {
  const html = renderLaunch({ mint: "Mint3", score: 0, signals: [] });

  assert.equal(html.includes("signal-name"), false);
});
