import test from "node:test";
import assert from "node:assert/strict";
import { createRequestHandler } from "./requestHandler.js";
import { LiveFeed } from "./feed.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { LaunchScore } from "./types.js";

function fakeReq(url: string): IncomingMessage {
  return { url } as IncomingMessage;
}

function fakeRes() {
  const calls: { status?: number; headers?: Record<string, string>; body?: string } = {};
  const res = {
    writeHead(status: number, headers: Record<string, string>) {
      calls.status = status;
      calls.headers = headers;
      return res;
    },
    end(body?: string) {
      calls.body = body;
    },
  };
  return { res: res as unknown as ServerResponse, calls };
}

const SCORE: LaunchScore = {
  mint: "Mint1111111111111111111111111111111111111",
  score: 42,
  signals: [{ name: "holder-concentration", score: 42, reasons: ["top 10 hold 42%"] }],
};

test("createRequestHandler: GET / serves the index HTML", async () => {
  const feed = new LiveFeed();
  const handle = createRequestHandler({
    feed,
    readIndexHtml: async () => "<html>stub</html>",
    readFeedJs: async () => "unused",
  });
  const { res, calls } = fakeRes();

  await handle(fakeReq("/"), res);

  assert.equal(calls.status, 200);
  assert.equal(calls.headers?.["content-type"], "text/html");
  assert.equal(calls.body, "<html>stub</html>");
});

test("createRequestHandler: GET /index.html also serves the index HTML", async () => {
  const feed = new LiveFeed();
  const handle = createRequestHandler({
    feed,
    readIndexHtml: async () => "<html>stub</html>",
    readFeedJs: async () => "unused",
  });
  const { res, calls } = fakeRes();

  await handle(fakeReq("/index.html"), res);

  assert.equal(calls.status, 200);
  assert.equal(calls.body, "<html>stub</html>");
});

test("createRequestHandler: GET /feed.js serves the client rendering module", async () => {
  const feed = new LiveFeed();
  const handle = createRequestHandler({
    feed,
    readIndexHtml: async () => "unused",
    readFeedJs: async () => "export function scoreClass() {}",
  });
  const { res, calls } = fakeRes();

  await handle(fakeReq("/feed.js"), res);

  assert.equal(calls.status, 200);
  assert.equal(calls.headers?.["content-type"], "text/javascript");
  assert.equal(calls.body, "export function scoreClass() {}");
});

test("createRequestHandler: GET /api/feed returns the feed as JSON", async () => {
  const feed = new LiveFeed();
  feed.add(SCORE);
  const handle = createRequestHandler({ feed, readIndexHtml: async () => "unused", readFeedJs: async () => "unused" });
  const { res, calls } = fakeRes();

  await handle(fakeReq("/api/feed"), res);

  assert.equal(calls.status, 200);
  assert.equal(calls.headers?.["content-type"], "application/json");
  assert.deepEqual(JSON.parse(calls.body ?? "{}"), { launches: [SCORE] });
});

test("createRequestHandler: GET /api/feed on an empty feed returns an empty list", async () => {
  const feed = new LiveFeed();
  const handle = createRequestHandler({ feed, readIndexHtml: async () => "unused", readFeedJs: async () => "unused" });
  const { res, calls } = fakeRes();

  await handle(fakeReq("/api/feed"), res);

  assert.deepEqual(JSON.parse(calls.body ?? "{}"), { launches: [] });
});

test("createRequestHandler: a readIndexHtml rejection returns a 500 instead of throwing", async () => {
  const feed = new LiveFeed();
  const handle = createRequestHandler({
    feed,
    readIndexHtml: async () => {
      throw new Error("disk read failed");
    },
    readFeedJs: async () => "unused",
  });
  const { res, calls } = fakeRes();

  await assert.doesNotReject(handle(fakeReq("/"), res));

  assert.equal(calls.status, 500);
});

test("createRequestHandler: a readFeedJs rejection returns a 500 instead of throwing", async () => {
  const feed = new LiveFeed();
  const handle = createRequestHandler({
    feed,
    readIndexHtml: async () => "unused",
    readFeedJs: async () => {
      throw new Error("disk read failed");
    },
  });
  const { res, calls } = fakeRes();

  await assert.doesNotReject(handle(fakeReq("/feed.js"), res));

  assert.equal(calls.status, 500);
});

test("createRequestHandler: unknown routes get a 404", async () => {
  const feed = new LiveFeed();
  const handle = createRequestHandler({ feed, readIndexHtml: async () => "unused", readFeedJs: async () => "unused" });
  const { res, calls } = fakeRes();

  await handle(fakeReq("/nope"), res);

  assert.equal(calls.status, 404);
  assert.equal(calls.headers?.["content-type"], "text/plain");
  assert.equal(calls.body, "not found");
});
