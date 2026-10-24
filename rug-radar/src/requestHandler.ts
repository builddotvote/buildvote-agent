// The HTTP server's request router (see server.ts), pulled out into its own
// function so the route branches (index page, feed JSON, 404) are
// unit-testable without a real listening socket — same reason
// handleDiscoveredLaunch (watcherOnLaunch.ts) and pollOnce (poller.ts) are
// standalone functions rather than inline in server.ts.

import type { IncomingMessage, ServerResponse } from "node:http";
import type { LiveFeed } from "./feed.js";

export interface RequestHandlerDeps {
  feed: LiveFeed;
  // Reads the index page HTML; injected so tests don't need a real file on
  // disk (server.ts passes a real fs readFile bound to publicDir).
  readIndexHtml: () => Promise<string>;
  // Reads index.html's client-side rendering module (public/feed.js), same
  // injected-reader pattern as readIndexHtml and for the same reason.
  readFeedJs: () => Promise<string>;
}

export function createRequestHandler(deps: RequestHandlerDeps) {
  const { feed, readIndexHtml, readFeedJs } = deps;

  return async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      if (req.url === "/" || req.url === "/index.html") {
        const html = await readIndexHtml();
        res.writeHead(200, { "content-type": "text/html" });
        res.end(html);
        return;
      }

      if (req.url === "/feed.js") {
        const js = await readFeedJs();
        res.writeHead(200, { "content-type": "text/javascript" });
        res.end(js);
        return;
      }

      if (req.url === "/api/feed") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ launches: feed.list() }));
        return;
      }

      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
    } catch (err) {
      // node:http does not await this handler's returned promise, so a
      // rejection here (e.g. readIndexHtml/readFeedJs hitting a transient
      // disk error) would otherwise become an unhandled rejection that
      // crashes the whole process (confirmed live: Node 20 terminates on
      // an unhandled rejection by default), dropping the feed for every
      // connected holder over one failed request. Caught here so it's just
      // a 500 for that one request instead.
      console.error("request handler failed:", err instanceof Error ? err.message : err);
      res.writeHead(500, { "content-type": "text/plain" });
      res.end("internal error");
    }
  };
}
