import { LeaseError, LeaseStore, type Intent, type Surface } from "./lease.ts";
import { forkIntent, type ArtifactsNamespace } from "./artifacts.ts";
import { runDemo } from "./demo-script.ts";

export interface Env {
  BOARD: DurableObjectNamespace;
  ARTIFACTS?: ArtifactsNamespace;
  CANON_REPO?: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function load(state: DurableObjectState): Promise<LeaseStore> {
  const stored = await state.storage.get<Intent[]>("intents");
  return new LeaseStore(stored ?? []);
}

async function save(state: DurableObjectState, store: LeaseStore): Promise<void> {
  await state.storage.put("intents", store.snapshot());
}

export class LeaseBoard implements DurableObject {
  private readonly state: DurableObjectState;
  private readonly env: Env;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/intents" && request.method === "GET") {
        const store = await load(this.state);
        const intents = store.list(Date.now());
        await save(this.state, store);
        return json({ intents });
      }
      if (url.pathname === "/intents" && request.method === "POST") {
        return await this.claim(request);
      }
      if (url.pathname === "/demo/seed" && request.method === "POST") {
        const { intents, log } = runDemo(Date.now());
        const store = new LeaseStore(intents);
        await save(this.state, store);
        return json({ intents: store.list(Date.now()), log });
      }
      if (url.pathname === "/why" && request.method === "GET") {
        const path = url.searchParams.get("path");
        if (!path) return json({ error: "path is required", code: "invalid" }, 400);
        const store = await load(this.state);
        return json({ intents: store.why(path) });
      }

      const match = url.pathname.match(/^\/intents\/([^/]+)\/(heartbeat|ready|land|decide)$/);
      if (match && request.method === "POST") {
        const id = decodeURIComponent(match[1]);
        const action = match[2];
        const store = await load(this.state);
        const now = Date.now();
        if (action === "heartbeat") {
          const intent = store.heartbeat(id, now);
          await save(this.state, store);
          return json({ intent });
        }
        if (action === "ready") {
          const intent = store.ready(id, now);
          await save(this.state, store);
          return json({ intent });
        }
        if (action === "land") {
          const intent = store.land(id, now);
          await save(this.state, store);
          return json({ intent });
        }
        const decision = store.decide(id, now);
        await save(this.state, store);
        return json(decision);
      }

      return json({ error: "not found", code: "not_found" }, 404);
    } catch (error) {
      if (error instanceof LeaseError) {
        return json({ error: error.message, code: error.code }, 400);
      }
      throw error;
    }
  }

  private async claim(request: Request): Promise<Response> {
    const body = (await request.json()) as {
      id?: string;
      title?: string;
      goal?: string;
      agentId?: string;
      surface?: Surface;
    };
    if (!body.title || !body.goal || !body.agentId || !body.surface) {
      return json({ error: "title, goal, agentId, and surface are required", code: "invalid" }, 400);
    }
    const store = await load(this.state);
    const { intent, overlap } = store.claim(
      {
        id: body.id ?? crypto.randomUUID(),
        title: body.title,
        goal: body.goal,
        agentId: body.agentId,
        surface: {
          paths: body.surface.paths ?? [],
          symbols: body.surface.symbols ?? [],
        },
      },
      Date.now(),
    );

    let token: string | null = null;
    let agentsMd: string | null = null;
    if (this.env.ARTIFACTS && this.env.CANON_REPO) {
      try {
        const forked = await forkIntent(
          this.env.ARTIFACTS,
          this.env.CANON_REPO,
          `i-${intent.id}`.slice(0, 63),
        );
        store.attachFork(intent.id, { forkRepo: forked.name, remote: forked.remote });
        token = forked.token;
        agentsMd = forked.agentsMd;
      } catch (error) {
        const message = error instanceof Error ? error.message : "fork failed";
        store.attachFork(intent.id, { forkError: message });
      }
    }

    await save(this.state, store);
    const stored = store.snapshot().find((item) => item.id === intent.id);
    return json({ intent: stored ?? intent, overlap, token, agentsMd }, 201);
  }
}
