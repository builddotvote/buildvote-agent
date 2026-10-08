import test from "node:test";
import assert from "node:assert/strict";
import { LiveFeed } from "./feed.js";

function score(mint: string) {
  return { mint, score: 0, signals: [] };
}

test("list() returns newest-added first", () => {
  const feed = new LiveFeed();
  feed.add(score("A"));
  feed.add(score("B"));
  assert.deepEqual(feed.list().map((s) => s.mint), ["B", "A"]);
});

test("caps at maxSize, dropping the oldest entries", () => {
  const feed = new LiveFeed(2);
  feed.add(score("A"));
  feed.add(score("B"));
  feed.add(score("C"));
  assert.deepEqual(feed.list().map((s) => s.mint), ["C", "B"]);
});

test("get() finds an entry by mint", () => {
  const feed = new LiveFeed();
  feed.add(score("A"));
  assert.deepEqual(feed.get("A"), score("A"));
  assert.equal(feed.get("missing"), undefined);
});

test("update() replaces an existing entry in place without reordering", () => {
  const feed = new LiveFeed();
  feed.add(score("A"));
  feed.add(score("B"));
  const updated = { mint: "A", score: 77, signals: [{ name: "x", score: 77, reasons: ["because"] }] };
  feed.update(updated);
  assert.deepEqual(feed.list(), [score("B"), updated]);
});

test("update() is a no-op when the mint isn't in the feed", () => {
  const feed = new LiveFeed();
  feed.add(score("A"));
  feed.update(score("missing"));
  assert.deepEqual(feed.list().map((s) => s.mint), ["A"]);
});
