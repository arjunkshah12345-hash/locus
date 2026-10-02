import { LeaseError, LeaseStore, type Intent, type Surface } from "./lease.ts";
import { forkIntent, type ArtifactsNamespace } from "./artifacts.ts";
import { runDemo } from "./demo-script.ts";
import { applyReferee } from "./referee.ts";
import { handleMcp, type McpMessage } from "./mcp.ts";
import { previewUrlFor, type PushEvent } from "./preview.ts";

export interface Env {
  BOARD: DurableObjectNamespace;
  ARTIFACTS?: ArtifactsNamespace;
  CANON_REPO?: string;
  REFEREE?: {
    create(options: { id?: string; params?: { intentIds: string[] } }): Promise<unknown>;
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

type Project = {
  id: string;
  name: string;
  summary: string;
  createdAt: number;
};

type Activity = { at: number; text: string };

function slug(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return base || "project";
}

export class LeaseBoard implements DurableObject {
  private readonly state: DurableObjectState;
  private readonly env: Env;
  private projectId = "canon";

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  private async projects(): Promise<Project[]> {
    return (await this.state.storage.get<Project[]>("projects")) ?? [];
  }

  private async saveProjects(projects: Project[]): Promise<void> {
    await this.state.storage.put("projects", projects);
  }

  private async load(): Promise<LeaseStore> {
    const stored = await this.state.storage.get<Intent[]>(`intents:${this.projectId}`);
    return new LeaseStore(stored ?? []);
  }

  private async save(store: LeaseStore): Promise<void> {
    await this.state.storage.put(`intents:${this.projectId}`, store.snapshot());
  }

  private async activity(): Promise<Activity[]> {
    return (await this.state.storage.get<Activity[]>(`activity:${this.projectId}`)) ?? [];
  }

  private async note(text: string): Promise<void> {
    const items = await this.activity();
    items.unshift({ at: Date.now(), text });
    await this.state.storage.put(`activity:${this.projectId}`, items.slice(0, 40));
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/projects" && request.method === "GET") {
        const projects = await this.projects();
        const listed = [];
        for (const project of projects) {
          this.projectId = project.id;
          const intents = (await this.load()).list(Date.now());
          listed.push({
            ...project,
            active: intents.filter((intent) => intent.status === "active" || intent.status === "ready").length,
            landed: intents.filter((intent) => intent.status === "landed").length,
          });
        }
        return json({ projects: listed });
      }
      if (url.pathname === "/projects" && request.method === "POST") {
        const body = (await request.json()) as { name?: string; summary?: string };
        if (!body.name?.trim()) return json({ error: "name is required", code: "invalid" }, 400);
        const projects = await this.projects();
        let id = slug(body.name);
        if (projects.some((project) => project.id === id)) id = `${id}-${crypto.randomUUID().slice(0, 4)}`;
        const project: Project = {
          id,
          name: body.name.trim(),
          summary: body.summary?.trim() || "Agents claim a surface. The canon lands the winner.",
          createdAt: Date.now(),
        };
        projects.unshift(project);
        await this.saveProjects(projects);
        this.projectId = id;
        await this.save(new LeaseStore());
        await this.note(`Opened ${project.name}.`);
        return json({ project }, 201);
      }

      const scoped = url.pathname.match(/^\/projects\/([^/]+)(\/.*)?$/);
      if (scoped) {
        this.projectId = decodeURIComponent(scoped[1]);
        url.pathname = scoped[2] || "/";
        const projects = await this.projects();
        if (!projects.some((project) => project.id === this.projectId)) {
          return json({ error: "Unknown project", code: "missing" }, 404);
        }
      }

      if (url.pathname === "/state" && request.method === "GET") {
        const projects = await this.projects();
        const project = projects.find((item) => item.id === this.projectId) ?? null;
        const store = await this.load();
        const intents = store.list(Date.now());
        await this.save(store);
        return json({ project, intents, activity: await this.activity(), brief: store.brief(Date.now()) });
      }
      if (url.pathname === "/intents" && request.method === "GET") {
        const store = await this.load();
        const intents = store.list(Date.now());
        await this.save(store);
        return json({ intents });
      }
      if (url.pathname === "/intents" && request.method === "POST") {
        return await this.claim(request);
      }
      if (url.pathname === "/sample" && request.method === "POST") {
        const { intents, log, frames } = runDemo(Date.now());
        const store = new LeaseStore(intents);
        await this.save(store);
        await this.note("Loaded the flag-service swarm. Three agents hold src/flags.ts.");
        return json({ intents: store.list(Date.now()), log, frames, activity: await this.activity() });
      }
      if (url.pathname === "/demo/seed" && request.method === "POST") {
        const { intents, log, frames } = runDemo(Date.now());
        const store = new LeaseStore(intents);
        await this.save(store);
        return json({ intents: store.list(Date.now()), log, frames });
      }
      if (url.pathname === "/referee" && request.method === "POST") {
        const store = await this.load();
        const decision = applyReferee(store, Date.now());
        await this.save(store);
        await this.note(
          decision
            ? `Referee ${decision.verdict}${decision.winnerId ? `: ${decision.winnerId}` : ""}. ${decision.rationale}`
            : "Referee found no overlap.",
        );
        return json({ decision, intents: store.list(Date.now()), activity: await this.activity() });
      }
      if (url.pathname === "/events" && request.method === "POST") {
        const event = (await request.json()) as PushEvent;
        if (event.type !== "cf.artifacts.repo.pushed" || !event.source?.repoName) {
          return json({ ignored: true });
        }
        const repoName = event.source.repoName;
        const store = await this.load();
        const match = store.snapshot().find((item) => item.forkRepo === repoName);
        const preview = match ? previewUrlFor(match.id, event) : undefined;
        let intent = store.notePush(
          repoName,
          event.payload?.after ?? "unknown",
          event.payload?.files,
          preview,
        );
        if (!intent) {
          for (const project of await this.projects()) {
            this.projectId = project.id;
            const other = await this.load();
            const matchOther = other.snapshot().find((item) => item.forkRepo === repoName);
            const previewOther = matchOther ? previewUrlFor(matchOther.id, event) : undefined;
            intent = other.notePush(
              repoName,
              event.payload?.after ?? "unknown",
              event.payload?.files,
              previewOther,
            );
            if (intent) {
              await this.save(other);
              await this.note(`Push ${event.payload?.after ?? ""} on ${repoName}.`);
              return json({ intent });
            }
          }
        }
        await this.save(store);
        if (intent) await this.note(`Push ${event.payload?.after ?? ""} on ${repoName}.`);
        return json({ intent });
      }
      if (url.pathname === "/mcp" && request.method === "POST") {
        const message = (await request.json()) as McpMessage;
        const store = await this.load();
        try {
          const result = handleMcp(store, message, Date.now());
          await this.save(store);
          return json({ jsonrpc: "2.0", id: message.id ?? null, result });
        } catch (error) {
          const messageText = error instanceof Error ? error.message : "mcp failed";
          return json({
            jsonrpc: "2.0",
            id: message.id ?? null,
            error: { code: -32000, message: messageText },
          });
        }
      }
      if (url.pathname === "/why" && request.method === "GET") {
        const path = url.searchParams.get("path");
        if (!path) return json({ error: "path is required", code: "invalid" }, 400);
        const store = await this.load();
        return json({ intents: store.why(path) });
      }

      const one = url.pathname.match(/^\/intents\/([^/]+)$/);
      if (one && request.method === "GET") {
        const store = await this.load();
        const intent = store.get(decodeURIComponent(one[1]));
        if (!intent) return json({ error: "Unknown intent", code: "missing" }, 404);
        return json({ intent });
      }

      const match = url.pathname.match(/^\/intents\/([^/]+)\/(heartbeat|ready|land|decide|context)$/);
      if (match && request.method === "POST") {
        const id = decodeURIComponent(match[1]);
        const action = match[2];
        const store = await this.load();
        const now = Date.now();
        if (action === "heartbeat") {
          const intent = store.heartbeat(id, now);
          await this.save(store);
          return json({ intent });
        }
        if (action === "ready") {
          const intent = store.ready(id, now);
          await this.save(store);
          return json({ intent });
        }
        if (action === "land") {
          const intent = store.land(id, now);
          await this.save(store);
          await this.note(`Landed ${id} into canon.`);
          return json({ intent });
        }
        if (action === "context") {
          const body = (await request.json()) as { note?: string };
          if (!body.note?.trim()) return json({ error: "note is required", code: "invalid" }, 400);
          const intent = store.appendContext(id, body.note.trim(), now);
          await this.save(store);
          await this.note(`${intent.agentId} recorded context on ${id}.`);
          return json({ intent });
        }
        const decision = store.decide(id, now);
        await this.save(store);
        await this.note(`Landed ${id}. Abandoned ${decision.abandoned.join(", ") || "nobody"}.`);
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
    const store = await this.load();
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
    } else {
      const repo = `i-${intent.id}`.slice(0, 63);
      store.attachFork(intent.id, { forkRepo: repo, remote: `memory://locus/${repo}` });
      store.notePush(repo, "pending", intent.surface.paths);
    }

    await this.save(store);
    const stored = store.snapshot().find((item) => item.id === intent.id);
    await this.note(`${stored?.agentId ?? body.agentId} claimed ${stored?.surface.paths.join(", ") || "a surface"}.`);
    const brief = store.brief(Date.now());
    return json({ intent: stored ?? intent, overlap, token, agentsMd, brief }, 201);
  }
}
