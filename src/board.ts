import { LeaseError, LeaseStore, type Intent, type Surface } from "./lease.ts";
import { forkIntent, type ArtifactsNamespace } from "./artifacts.ts";
import { runDemo } from "./demo-script.ts";
import { applyReferee } from "./referee.ts";
import { handleMcp, type McpMessage } from "./mcp.ts";
import { previewUrlFor, type PushEvent } from "./preview.ts";
import {
  clearSessionCookie,
  hashPassword,
  normalizeEmail,
  publicUser,
  readSession,
  sessionCookie,
  sessionToken,
  verifyPassword,
  type PublicUser,
  type StoredUser,
} from "./accounts.ts";
import { addComment, checksFor, nextNumber, pathsFromDiff, type Issue, type PullRequest } from "./hub.ts";
import { applyDiff, cleanFiles, diffFiles, fastImport, readmeFiles, refName, type GitCommit, type GitFile, type GitRef } from "./git.ts";

export interface Env {
  BOARD: DurableObjectNamespace;
  ARTIFACTS?: ArtifactsNamespace;
  CANON_REPO?: string;
  REFEREE?: {
    create(options: { id?: string; params?: { intentIds: string[] } }): Promise<unknown>;
  };
}

function json(body: unknown, status = 200, cookie?: string): Response {
  const headers = new Headers({ "content-type": "application/json; charset=utf-8" });
  if (cookie) headers.set("set-cookie", cookie);
  return new Response(JSON.stringify(body), { status, headers });
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

  private secure(request: Request): boolean {
    return new URL(request.url).protocol === "https:";
  }

  private async users(): Promise<StoredUser[]> {
    return (await this.state.storage.get<StoredUser[]>("users")) ?? [];
  }

  private async sessions(): Promise<Record<string, { userId: string; expires: number }>> {
    return (await this.state.storage.get<Record<string, { userId: string; expires: number }>>("sessions")) ?? {};
  }

  private async actor(request: Request): Promise<PublicUser | null> {
    const token = readSession(request);
    if (!token) return null;
    const sessions = await this.sessions();
    const session = sessions[token];
    if (!session || session.expires < Date.now()) return null;
    const user = (await this.users()).find((item) => item.id === session.userId);
    return user ? publicUser(user) : null;
  }

  private async requireActor(request: Request): Promise<PublicUser | Response> {
    const user = await this.actor(request);
    if (!user) return json({ error: "Sign in required", code: "unauthorized" }, 401);
    return user;
  }

  private async issues(): Promise<Issue[]> {
    return (await this.state.storage.get<Issue[]>(`issues:${this.projectId}`)) ?? [];
  }

  private async saveIssues(issues: Issue[]): Promise<void> {
    await this.state.storage.put(`issues:${this.projectId}`, issues);
  }

  private async pulls(): Promise<PullRequest[]> {
    return (await this.state.storage.get<PullRequest[]>(`pulls:${this.projectId}`)) ?? [];
  }

  private async savePulls(pulls: PullRequest[]): Promise<void> {
    await this.state.storage.put(`pulls:${this.projectId}`, pulls);
  }

  private async refs(): Promise<GitRef[]> {
    return (await this.state.storage.get<GitRef[]>(`gitrefs:${this.projectId}`)) ?? [];
  }

  private async saveRef(next: GitRef): Promise<void> {
    const refs = await this.refs();
    const index = refs.findIndex((item) => item.name === next.name);
    if (index >= 0) refs[index] = next;
    else refs.unshift(next);
    await this.state.storage.put(`gitrefs:${this.projectId}`, refs);
  }

  private async rememberRef(owner: PublicUser, head: string, message: string, files: GitFile[]): Promise<void> {
    const clean = cleanFiles(files);
    if (!clean.length) return;
    const name = refName(head);
    const previous = (await this.refs()).find((ref) => ref.name === name);
    const at = Date.now();
    const text = message || "Update";
    await this.saveRef({
      name,
      message: text,
      author: owner.name,
      email: owner.email,
      at,
      files: clean,
      history: [...(previous?.history ?? []), { message: text, author: owner.name, email: owner.email, at, files: clean }].slice(-30),
    });
  }

  private async ensureCanon(): Promise<void> {
    if ((await this.refs()).some((ref) => ref.name === "refs/heads/main")) return;
    const project = (await this.projects()).find((item) => item.id === this.projectId);
    if (!project) return;
    await this.saveRef({
      name: "refs/heads/main",
      message: "Initial commit",
      author: "Locus",
      email: "locus@locus.dev",
      at: project.createdAt,
      files: readmeFiles(project.name, project.summary),
      history: [{
        message: "Initial commit",
        author: "Locus",
        email: "locus@locus.dev",
        at: project.createdAt,
        files: readmeFiles(project.name, project.summary),
      }],
    });
  }

  private commitLog(history: GitCommit[]) {
    return history.map(({ message, author, at }) => ({ message, author, at }));
  }

  private async writeCommit(owner: PublicUser, name: string, message: string, files: GitFile[], parent: GitCommit[]): Promise<void> {
    const clean = cleanFiles(files);
    const at = Date.now();
    await this.saveRef({
      name,
      message,
      author: owner.name,
      email: owner.email,
      at,
      files: clean,
      history: [...parent, { message, author: owner.name, email: owner.email, at, files: clean }].slice(-30),
    });
  }

  private describeRefs(refs: GitRef[]) {
    return refs.map((ref) => ({
      name: ref.name,
      message: ref.message,
      author: ref.author,
      at: ref.at,
      history: this.commitLog(ref.history ?? []),
    }));
  }

  private async note(text: string): Promise<void> {
    const items = await this.activity();
    items.unshift({ at: Date.now(), text });
    await this.state.storage.put(`activity:${this.projectId}`, items.slice(0, 40));
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/auth/me" && request.method === "GET") {
        return json({ user: await this.actor(request) });
      }
      if (url.pathname === "/auth/signup" && request.method === "POST") {
        const body = (await request.json()) as { name?: string; email?: string; password?: string };
        const name = body.name?.trim() ?? "";
        const email = normalizeEmail(body.email ?? "");
        const password = body.password ?? "";
        if (name.length < 2 || !email.includes("@") || password.length < 8) {
          return json({ error: "Name, email, and a password of 8 or more characters are required", code: "invalid" }, 400);
        }
        const users = await this.users();
        if (users.some((user) => user.email === email)) {
          return json({ error: "An account already uses that email", code: "exists" }, 400);
        }
        const secret = await hashPassword(password);
        const user: StoredUser = {
          id: crypto.randomUUID(),
          email,
          name,
          salt: secret.salt,
          hash: secret.hash,
          createdAt: Date.now(),
        };
        users.push(user);
        await this.state.storage.put("users", users);
        const token = sessionToken();
        const sessions = await this.sessions();
        sessions[token] = { userId: user.id, expires: Date.now() + 30 * 24 * 60 * 60 * 1000 };
        await this.state.storage.put("sessions", sessions);
        return json({ user: publicUser(user), token }, 201, sessionCookie(token, this.secure(request)));
      }
      if (url.pathname === "/auth/login" && request.method === "POST") {
        const body = (await request.json()) as { email?: string; password?: string };
        const email = normalizeEmail(body.email ?? "");
        const user = (await this.users()).find((item) => item.email === email);
        if (!user || !(await verifyPassword(body.password ?? "", user.salt, user.hash))) {
          return json({ error: "Email or password is wrong", code: "unauthorized" }, 401);
        }
        const token = sessionToken();
        const sessions = await this.sessions();
        sessions[token] = { userId: user.id, expires: Date.now() + 30 * 24 * 60 * 60 * 1000 };
        await this.state.storage.put("sessions", sessions);
        return json({ user: publicUser(user), token }, 200, sessionCookie(token, this.secure(request)));
      }
      if (url.pathname === "/auth/logout" && request.method === "POST") {
        const token = readSession(request);
        if (token) {
          const sessions = await this.sessions();
          delete sessions[token];
          await this.state.storage.put("sessions", sessions);
        }
        return json({ ok: true }, 200, clearSessionCookie(this.secure(request)));
      }
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
        const owner = await this.requireActor(request);
        if (owner instanceof Response) return owner;
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
        await this.ensureCanon();
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
        await this.ensureCanon();
        const projects = await this.projects();
        const project = projects.find((item) => item.id === this.projectId) ?? null;
        const store = await this.load();
        const intents = store.list(Date.now());
        await this.save(store);
        return json({
          project,
          intents,
          activity: await this.activity(),
          brief: store.brief(Date.now()),
          issues: await this.issues(),
          pulls: await this.pulls(),
          refs: this.describeRefs(await this.refs()),
        });
      }
      if (url.pathname === "/issues" && request.method === "GET") {
        return json({ issues: await this.issues() });
      }
      if (url.pathname === "/issues" && request.method === "POST") {
        const owner = await this.requireActor(request);
        if (owner instanceof Response) return owner;
        const body = (await request.json()) as { title?: string; body?: string; labels?: string[] | string };
        if (!body.title?.trim()) return json({ error: "title is required", code: "invalid" }, 400);
        const issues = await this.issues();
        const rawLabels = Array.isArray(body.labels) ? body.labels : String(body.labels ?? "").split(",");
        const issue: Issue = {
          number: nextNumber(issues),
          title: body.title.trim(),
          body: body.body?.trim() || "",
          author: owner.name,
          status: "open",
          createdAt: Date.now(),
          labels: rawLabels.map((label) => label.trim()).filter(Boolean).slice(0, 5),
          comments: [],
        };
        issues.unshift(issue);
        await this.saveIssues(issues);
        await this.note(`${owner.name} opened issue #${issue.number}.`);
        return json({ issue }, 201);
      }
      const issueMatch = url.pathname.match(/^\/issues\/(\d+)(?:\/(comments|close|reopen))?$/);
      if (issueMatch) {
        const number = Number(issueMatch[1]);
        const issues = await this.issues();
        const issue = issues.find((item) => item.number === number);
        if (!issue) return json({ error: "Unknown issue", code: "missing" }, 404);
        if (!issueMatch[2] && request.method === "GET") return json({ issue });
        const owner = await this.requireActor(request);
        if (owner instanceof Response) return owner;
        if (issueMatch[2] === "comments" && request.method === "POST") {
          const body = (await request.json()) as { body?: string };
          if (!body.body?.trim()) return json({ error: "body is required", code: "invalid" }, 400);
          addComment(issue.comments, owner.name, body.body.trim(), Date.now());
          await this.saveIssues(issues);
          return json({ issue });
        }
        if ((issueMatch[2] === "close" || issueMatch[2] === "reopen") && request.method === "POST") {
          issue.status = issueMatch[2] === "close" ? "closed" : "open";
          await this.saveIssues(issues);
          await this.note(`${owner.name} ${issue.status === "closed" ? "closed" : "reopened"} issue #${issue.number}.`);
          return json({ issue });
        }
      }
      if (url.pathname === "/pulls" && request.method === "GET") {
        return json({ pulls: await this.pulls() });
      }
      if (url.pathname === "/pulls" && request.method === "POST") {
        const owner = await this.requireActor(request);
        if (owner instanceof Response) return owner;
        const body = (await request.json()) as {
          title?: string;
          body?: string;
          goal?: string;
          patch?: string;
          paths?: string[];
          symbols?: string[];
          head?: string;
          commit?: string;
        };
        return this.openPull(request, owner, body);
      }
      if (url.pathname === "/git/push" && request.method === "POST") {
        const owner = await this.requireActor(request);
        if (owner instanceof Response) return owner;
        const body = (await request.json()) as {
          ref?: string;
          commit?: string;
          message?: string;
          diff?: string;
          files?: GitFile[];
        };
        const diff = body.diff ?? "";
        const paths = pathsFromDiff(diff);
        const head = refName(body.ref || "refs/heads/main");
        const files = Array.isArray(body.files) ? body.files : [];
        await this.rememberRef(owner, head, body.message || "", files);
        const pulls = await this.pulls();
        const existing = pulls.find((pull) => pull.status === "open" && pull.author === owner.name && pull.head === head);
        if (existing) {
          existing.patch = diff;
          existing.commit = body.commit ?? existing.commit;
          existing.checks = checksFor(existing.body || existing.title, diff);
          const store = await this.load();
          store.setPatch(existing.intentId, diff);
          store.setChecks(existing.intentId, existing.checks.map((check) => ({ name: check.name, passed: check.status === "pass", detail: check.detail })));
          await this.save(store);
          await this.savePulls(pulls);
          await this.note(`${owner.name} pushed ${body.commit ?? "a commit"} to #${existing.number}.`);
          return json({ pull: existing });
        }
        return this.openPull(request, owner, {
          title: body.message || `Push ${head}`,
          body: body.message || "",
          goal: body.message || `Land ${paths.join(", ") || "the pushed files"}.`,
          patch: diff,
          paths,
          head,
          commit: body.commit,
        });
      }
      if (url.pathname === "/actions" && request.method === "GET") {
        const pulls = await this.pulls();
        const runs = pulls.map((pull) => ({
          name: `pull #${pull.number}`,
          title: pull.title,
          status: pull.checks.some((check) => check.status === "fail") ? "fail" : "pass",
          checks: pull.checks,
          at: pull.createdAt,
        }));
        return json({ runs });
      }
      if (url.pathname === "/git/commit" && request.method === "POST") {
        const owner = await this.requireActor(request);
        if (owner instanceof Response) return owner;
        const body = (await request.json()) as {
          ref?: string;
          branch?: string;
          message?: string;
          path?: string;
          content?: string;
          delete?: boolean;
        };
        await this.ensureCanon();
        const sourceName = refName(body.ref || "refs/heads/main");
        const source = (await this.refs()).find((ref) => ref.name === sourceName);
        if (!source) return json({ error: "Unknown branch", code: "missing" }, 404);
        const path = (body.path || "").replaceAll("\\", "/").replace(/^\/+/, "");
        if (!path || path.split("/").includes("..")) return json({ error: "path is invalid", code: "invalid" }, 400);
        const files = source.files.map((file) => ({ path: file.path, content: file.content }));
        const index = files.findIndex((file) => file.path === path);
        if (body.delete) {
          if (index < 0) return json({ error: "That file is not on this branch", code: "missing" }, 404);
          files.splice(index, 1);
        } else if (typeof body.content !== "string") {
          return json({ error: "content is required", code: "invalid" }, 400);
        } else if (index >= 0) files[index] = { path, content: body.content };
        else files.push({ path, content: body.content });
        const targetName = body.branch?.trim() ? refName(body.branch) : sourceName;
        const original = source.files;
        const changed = diffFiles(original, files);
        if (!changed.trim()) return json({ error: "Nothing changed", code: "invalid" }, 400);
        const message = body.message?.trim() || (body.delete ? `Delete ${path}` : `Update ${path}`);
        const target = (await this.refs()).find((ref) => ref.name === targetName);
        const parent = target?.history ?? (targetName === sourceName ? source.history ?? [] : source.history ?? []);
        await this.writeCommit(owner, targetName, message, files, parent);
        if (!body.branch?.trim()) return json({ ref: targetName });
        const pulls = await this.pulls();
        const existing = pulls.find((pull) => pull.status === "open" && pull.head === targetName && pull.author === owner.name);
        if (existing) {
          existing.patch = changed;
          existing.checks = checksFor(existing.body || existing.title, changed);
          await this.savePulls(pulls);
          return json({ ref: targetName, pull: existing });
        }
        return this.openPull(request, owner, {
          title: message,
          body: message,
          goal: message,
          patch: changed,
          paths: pathsFromDiff(changed),
          head: targetName,
        });
      }
      if (url.pathname === "/git/compare" && request.method === "GET") {
        await this.ensureCanon();
        const baseName = refName(url.searchParams.get("base") || "refs/heads/main");
        const headName = refName(url.searchParams.get("head") || "refs/heads/main");
        const refs = await this.refs();
        const base = refs.find((ref) => ref.name === baseName);
        const head = refs.find((ref) => ref.name === headName);
        if (!base || !head) return json({ error: "Unknown branch", code: "missing" }, 404);
        return json({ base: base.name, head: head.name, diff: diffFiles(base.files, head.files) });
      }
      if (url.pathname === "/git/commits" && request.method === "GET") {
        await this.ensureCanon();
        const name = refName(url.searchParams.get("ref") || "refs/heads/main");
        const ref = (await this.refs()).find((item) => item.name === name);
        if (!ref) return json({ error: "Unknown branch", code: "missing" }, 404);
        const history = ref.history ?? [];
        return json({
          ref: ref.name,
          commits: history.map((commit, index) => ({
            index,
            message: commit.message,
            author: commit.author,
            at: commit.at,
            diff: diffFiles(index === 0 ? [] : history[index - 1]?.files ?? [], commit.files ?? []),
          })),
        });
      }
      if (url.pathname === "/git/tree" && request.method === "GET") {
        await this.ensureCanon();
        const name = refName(url.searchParams.get("ref") || "refs/heads/main");
        const ref = (await this.refs()).find((item) => item.name === name);
        if (!ref) return json({ error: "Unknown branch", code: "missing" }, 404);
        return json({
          ref: ref.name,
          message: ref.message,
          author: ref.author,
          at: ref.at,
          history: this.commitLog(ref.history ?? []),
          files: ref.files,
        });
      }
      if (url.pathname === "/git/refs" && request.method === "GET") {
        const owner = await this.requireActor(request);
        if (owner instanceof Response) return owner;
        await this.ensureCanon();
        return json({ refs: this.describeRefs(await this.refs()) });
      }
      if (url.pathname === "/git/import" && request.method === "GET") {
        const owner = await this.requireActor(request);
        if (owner instanceof Response) return owner;
        const wanted = url.searchParams.getAll("ref");
        await this.ensureCanon();
        const refs = await this.refs();
        const selected = wanted.length ? refs.filter((ref) => wanted.includes(ref.name)) : refs;
        return new Response(fastImport(selected), { headers: { "content-type": "text/plain; charset=utf-8" } });
      }
      const pullMatch = url.pathname.match(/^\/pulls\/(\d+)(?:\/(comments|merge|close))?$/);
      if (pullMatch) {
        const number = Number(pullMatch[1]);
        const pulls = await this.pulls();
        const pull = pulls.find((item) => item.number === number);
        if (!pull) return json({ error: "Unknown pull request", code: "missing" }, 404);
        if (!pullMatch[2] && request.method === "GET") return json({ pull });
        const owner = await this.requireActor(request);
        if (owner instanceof Response) return owner;
        if (pullMatch[2] === "comments" && request.method === "POST") {
          const body = (await request.json()) as { body?: string };
          if (!body.body?.trim()) return json({ error: "body is required", code: "invalid" }, 400);
          addComment(pull.comments, owner.name, body.body.trim(), Date.now());
          await this.savePulls(pulls);
          return json({ pull });
        }
        if (pullMatch[2] === "close" && request.method === "POST") {
          pull.status = "closed";
          await this.savePulls(pulls);
          await this.note(`${owner.name} closed pull #${pull.number}.`);
          return json({ pull });
        }
        if (pullMatch[2] === "merge" && request.method === "POST") {
          if (pull.status !== "open") return json({ error: "This pull request is already finished", code: "invalid" }, 400);
          const failed = pull.checks.find((check) => check.status === "fail");
          if (failed) return json({ error: `${failed.name} failed. ${failed.detail}`, code: "checks" }, 400);
          const store = await this.load();
          const intent = store.get(pull.intentId);
          if (!intent) return json({ error: "The lease for this pull request is gone", code: "missing" }, 404);
          try {
            if (intent.contended) store.decide(pull.intentId, Date.now());
            else store.land(pull.intentId, Date.now());
          } catch (error) {
            if (error instanceof LeaseError) return json({ error: error.message, code: error.code }, 400);
            throw error;
          }
          const head = (await this.refs()).find((ref) => ref.name === pull.head);
          await this.ensureCanon();
          const main = (await this.refs()).find((ref) => ref.name === "refs/heads/main");
          const at = Date.now();
          let nextFiles = head?.files;
          if (!nextFiles) {
            const applied = applyDiff(main?.files ?? [], pull.patch);
            if (applied.error) return json({ error: applied.error, code: "apply" }, 400);
            nextFiles = applied.files;
          }
          await this.save(store);
          pull.status = "merged";
          await this.savePulls(pulls);
          await this.saveRef({
            name: "refs/heads/main",
            message: head?.message || pull.title,
            author: head?.author || owner.name,
            email: head?.email || owner.email,
            at,
            files: nextFiles,
            history: [...(main?.history ?? []), { message: head?.message || pull.title, author: owner.name, at }].slice(-30),
          });
          await this.note(`${owner.name} merged pull #${pull.number} into canon.`);
          return json({ pull });
        }
      }
      if (url.pathname === "/intents" && request.method === "GET") {
        const store = await this.load();
        const intents = store.list(Date.now());
        await this.save(store);
        return json({ intents });
      }
      if (url.pathname === "/intents" && request.method === "POST") {
        const owner = await this.requireActor(request);
        if (owner instanceof Response) return owner;
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

  private async openPull(
    request: Request,
    owner: PublicUser,
    body: {
      title?: string;
      body?: string;
      goal?: string;
      patch?: string;
      paths?: string[];
      symbols?: string[];
      head?: string;
      commit?: string;
    },
  ): Promise<Response> {
    const title = body.title?.trim() || "";
    const patch = body.patch ?? "";
    const paths = body.paths?.length ? body.paths : pathsFromDiff(patch);
    if (!title) return json({ error: "title is required", code: "invalid" }, 400);
    if (!paths.length) return json({ error: "A pull request needs at least one path", code: "invalid" }, 400);
    const pulls = await this.pulls();
    const number = nextNumber(pulls);
    const head = refName(body.head || `refs/heads/pull-${number}`);
    if (!(await this.refs()).some((ref) => ref.name === head) && patch.trim()) {
      await this.ensureCanon();
      const main = (await this.refs()).find((ref) => ref.name === "refs/heads/main");
      const applied = applyDiff(main?.files ?? [], patch);
      if (applied.error) return json({ error: applied.error, code: "apply" }, 400);
      const at = Date.now();
      await this.saveRef({
        name: head,
        message: title,
        author: owner.name,
        email: owner.email,
        at,
        files: applied.files,
        history: [{ message: title, author: owner.name, at }],
      });
    }
    const goal = body.goal?.trim() || body.body?.trim() || title;
    const claimed = await this.claim(new Request(request.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: `pr-${this.projectId}-${number}`.slice(0, 48),
        title,
        goal,
        agentId: owner.name,
        surface: { paths, symbols: body.symbols ?? [] },
      }),
    }));
    if (!claimed.ok) return claimed;
    const created = (await claimed.json()) as { intent: Intent };
    const checks = checksFor(goal, patch);
    const store = await this.load();
    store.setPatch(created.intent.id, patch);
    store.setChecks(
      created.intent.id,
      checks.map((check) => ({ name: check.name, passed: check.status === "pass", detail: check.detail })),
    );
    await this.save(store);
    const pull: PullRequest = {
      number,
      title,
      body: body.body?.trim() || "",
      author: owner.name,
      status: "open",
      intentId: created.intent.id,
      base: "canon",
      head,
      commit: body.commit ?? null,
      patch,
      createdAt: Date.now(),
      comments: [],
      checks,
    };
    pulls.unshift(pull);
    await this.savePulls(pulls);
    await this.note(`${owner.name} opened pull #${pull.number}.`);
    return json({ pull, intent: store.get(created.intent.id) }, 201);
  }

  private async claim(request: Request): Promise<Response> {
    const owner = await this.actor(request);
    const body = (await request.json()) as {
      id?: string;
      title?: string;
      goal?: string;
      agentId?: string;
      surface?: Surface;
    };
    const agentId = body.agentId || owner?.name;
    if (!body.title || !body.goal || !agentId || !body.surface) {
      return json({ error: "title, goal, agentId, and surface are required", code: "invalid" }, 400);
    }
    const store = await this.load();
    const { intent, overlap } = store.claim(
      {
        id: body.id ?? crypto.randomUUID(),
        title: body.title,
        goal: body.goal,
        agentId,
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
    await this.note(`${stored?.agentId ?? agentId} claimed ${stored?.surface.paths.join(", ") || "a surface"}.`);
    const brief = store.brief(Date.now());
    return json({ intent: stored ?? intent, overlap, token, agentsMd, brief }, 201);
  }
}
