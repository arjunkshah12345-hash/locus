import { boardHtml } from "./page.ts";

export { LeaseBoard } from "./board.ts";
export type { Env } from "./board.ts";
import type { Env } from "./board.ts";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return Response.json({
        ok: true,
        artifacts: Boolean(env.ARTIFACTS && env.CANON_REPO),
      });
    }
    if (url.pathname.startsWith("/api/")) {
      const id = env.BOARD.idFromName("locus");
      const stub = env.BOARD.get(id);
      const next = new URL(request.url);
      next.pathname = url.pathname.slice("/api".length) || "/";
      return stub.fetch(new Request(next, request));
    }
    if (url.pathname === "/") {
      return new Response(boardHtml(), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    return new Response("not found", { status: 404 });
  },
};
