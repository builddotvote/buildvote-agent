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
}

export function createRequestHandler(deps: RequestHandlerDeps) {
  const { feed, readIndexHtml } = deps;

  return async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.url === "/" || req.url === "/index.html") {
      const html = await readIndexHtml();
      res.writeHead(200, { "content-type": "text/html" });
      res.end(html);
      return;
    }

    if (req.url === "/api/feed") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ launches: feed.list() }));
      return;
    }

    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  };
}
