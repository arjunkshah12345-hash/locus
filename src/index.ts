import { boardHtml } from "./page.ts";
import { previewHtml } from "./preview.ts";
import type { Intent } from "./lease.ts";

export { LeaseBoard } from "./board.ts";
export { RefereeWorkflow } from "./workflow.ts";
export type { Env } from "./board.ts";
import type { Env } from "./board.ts";

function board(env: Env): DurableObjectStub {
  return env.BOARD.get(env.BOARD.idFromName("locus"));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return Response.json({
        ok: true,
        artifacts: Boolean(env.ARTIFACTS && env.CANON_REPO),
        referee: Boolean(env.REFEREE),
      });
    }
    if (url.pathname.startsWith("/preview/")) {
      const id = decodeURIComponent(url.pathname.slice("/preview/".length));
      const listed = await board(env).fetch("https://locus/projects");
      const catalog = (await listed.json()) as { projects?: { id: string }[] };
      const projects = catalog.projects ?? [];
      const candidates = ["canon", ...projects.map((project) => project.id)];
      for (const projectId of candidates) {
        const response = await board(env).fetch(
          `https://locus/projects/${encodeURIComponent(projectId)}/intents/${encodeURIComponent(id)}`,
        );
        if (!response.ok) continue;
        const body = (await response.json()) as { intent: Intent };
        return new Response(previewHtml(body.intent), {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }
      return new Response("This preview has no intent yet.", { status: 404 });
    }
    if (url.pathname === "/mcp" && request.method === "POST") {
      return board(env).fetch(new Request("https://locus/mcp", request));
    }
    if (url.pathname.startsWith("/api/")) {
      const next = new URL(request.url);
      next.pathname = url.pathname.slice("/api".length) || "/";
      return board(env).fetch(new Request(next, request));
    }
    if (
      url.pathname === "/" ||
      url.pathname === "/login" ||
      url.pathname === "/signup" ||
      url.pathname === "/app" ||
      url.pathname.startsWith("/p/")
    ) {
      return new Response(boardHtml(), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    return new Response("not found", { status: 404 });
  },

  async queue(batch: MessageBatch, env: Env): Promise<void> {
    const stub = board(env);
    for (const message of batch.messages) {
      const noted = await stub.fetch("https://locus/events", {
        method: "POST",
        body: JSON.stringify(message.body),
      });
      if (!noted.ok) {
        message.retry();
        continue;
      }
      let started = false;
      if (env.REFEREE) {
        try {
          await env.REFEREE.create({
            id: `push-${message.id}`,
            params: { intentIds: [] },
          });
          started = true;
        } catch {
          started = false;
        }
      }
      if (!started) {
        await stub.fetch("https://locus/referee", { method: "POST" });
      }
      message.ack();
    }
  },
};
