#!/usr/bin/env node
// Locus swarm: N agents (default 10, minimum 8) claim, edit, push and land
// against one canon at the same time.
//
// With Artifacts bound on the Worker, every agent gets its own Artifacts fork,
// clones it with its fork token, pushes a real commit, and the board reads the
// pushed file back from Artifacts before the referee scores it. The script then
// merges the landed forks into the canon repo and pushes the canon.
//
// Without Artifacts (local `wrangler dev`, or a free plan), the same git flow runs
// against a local bare repo standing in for the canon, and agents report what they
// pushed. The board marks those checks as reported, not verified.
//
//   LOCUS_URL=https://locus.<you>.workers.dev LOCUS_EMAIL=... LOCUS_PASSWORD=... npm run swarm
//   npm run swarm -- --agents 10 --seed
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback;
};

const base = (option("url", process.env.LOCUS_URL) ?? "http://127.0.0.1:8787").replace(/\/$/, "");
const agentCount = Math.max(8, Number(option("agents", "10")));
const tag = Date.now().toString(36).slice(-5);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = join(root, "fixtures", "sample");
const work = mkdtempSync(join(tmpdir(), `locus-swarm-${tag}-`));
const started = Date.now();

const timeline = [];
function log(who, text) {
  const line = `${String(Date.now() - started).padStart(6)}ms  ${who.padEnd(16)} ${text}`;
  timeline.push(line);
  console.log(line);
}

function git(cwd, list, token) {
  const auth = token ? ["-c", `http.extraHeader=Authorization: Bearer ${token}`] : [];
  return execFileSync("git", [...auth, "-c", "user.name=locus-swarm", "-c", "user.email=swarm@locus.dev", ...list], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

let session = null;
async function api(path, init = {}) {
  const response = await fetch(`${base}/api${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(session ? { authorization: `Bearer ${session}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }
  if (!response.ok) throw new Error(`${init.method ?? "GET"} ${path} ${response.status}: ${body.error ?? text.slice(0, 200)}`);
  return body;
}

function edit(dir, path, change) {
  const file = join(dir, path);
  mkdirSync(dirname(file), { recursive: true });
  const before = existsSync(file) ? readFileSync(file, "utf8") : "";
  writeFileSync(file, change(before));
}

// Ten agents. Three of them hold src/flags.ts on purpose: one flips newCheckout on,
// two make compatible edits. The referee has to sort that out.
const TASKS = [
  {
    key: "rate-limit", title: "Rate limit /flags", goal: "Reject bursts against the flag API.",
    paths: ["src/index.ts"], symbols: ["src/index.ts#fetch"],
    apply: (d) => edit(d, "src/index.ts", (s) => s.replace(
      "    const url = new URL(request.url);",
      "    const url = new URL(request.url);\n    if (request.headers.get(\"x-burst\") === \"1\") return new Response(\"slow down\", { status: 429 });",
    )),
  },
  {
    key: "flag-default", title: "Change the flag default", goal: "Ship newCheckout to everyone by default.",
    paths: ["src/flags.ts"], symbols: ["src/flags.ts#DEFAULT_FLAGS"],
    apply: (d) => edit(d, "src/flags.ts", (s) => s.replace("newCheckout: false,", "newCheckout: true,")),
  },
  {
    key: "flag-audit", title: "Audit flag writes", goal: "Record which flags were written.",
    paths: ["src/flags.ts"], symbols: ["src/flags.ts#setFlag"],
    apply: (d) => edit(d, "src/flags.ts", (s) => s.replace(
      "export function setFlag(name: string, value: boolean): void {\n",
      "export const audit: string[] = [];\n\nexport function setFlag(name: string, value: boolean): void {\n  audit.push(name);\n",
    )),
  },
  {
    key: "flag-staged", title: "Staged rollout flag", goal: "Keep newCheckout off and add a staged rollout flag.",
    paths: ["src/flags.ts"], symbols: ["src/flags.ts#DEFAULT_FLAGS"],
    apply: (d) => edit(d, "src/flags.ts", (s) => s.replace("  newCheckout: false,\n", "  newCheckout: false,\n  stagedRollout: false,\n")),
  },
  {
    key: "docs", title: "Document the flags", goal: "Explain the flag endpoint in the README.",
    paths: ["README.md"], symbols: [],
    apply: (d) => edit(d, "README.md", (s) => s + "\n`POST /flags` takes `{ name, value, token }` and returns the new value.\n"),
  },
  {
    key: "auth", title: "Tighten token checks", goal: "Reject blank subjects in verifyToken.",
    paths: ["src/auth.ts"], symbols: ["src/auth.ts#verifyToken"],
    apply: (d) => edit(d, "src/auth.ts", (s) => s.replace("token.subject.length > 0", "token.subject.trim().length > 0")),
  },
  {
    key: "obs", title: "Add a log helper", goal: "Add src/log.ts for request lines.",
    paths: ["src/log.ts"], symbols: [],
    apply: (d) => edit(d, "src/log.ts", () => "export function logLine(path: string, status: number): string {\n  return `${path} ${status}`;\n}\n"),
  },
  {
    key: "health", title: "Health route helper", goal: "Add src/health.ts that reports ok.",
    paths: ["src/health.ts"], symbols: [],
    apply: (d) => edit(d, "src/health.ts", () => "export function health(): Response {\n  return Response.json({ ok: true });\n}\n"),
  },
  {
    key: "metrics", title: "Count flag reads", goal: "Add src/metrics.ts with a read counter.",
    paths: ["src/metrics.ts"], symbols: [],
    apply: (d) => edit(d, "src/metrics.ts", () => "let reads = 0;\n\nexport function countRead(): number {\n  reads += 1;\n  return reads;\n}\n"),
  },
  {
    key: "agents-md", title: "Note the arena rule", goal: "Tell agents where context notes go.",
    paths: ["AGENTS.md"], symbols: [],
    apply: (d) => edit(d, "AGENTS.md", (s) => s + "\nContext notes are plain Markdown, one file per intent.\n"),
  },
];

async function signIn() {
  const email = process.env.LOCUS_EMAIL ?? `swarm-${tag}@example.com`;
  const password = process.env.LOCUS_PASSWORD ?? `swarm-${tag}-password`;
  const body = process.env.LOCUS_EMAIL
    ? await api("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) })
    : await api("/auth/signup", { method: "POST", body: JSON.stringify({ name: "Swarm operator", email, password }) });
  session = body.token;
  log("operator", `signed in as ${body.user?.email ?? email}`);
}

// The canon. Artifacts mode asks the Worker for the canon remote and a write token,
// and seeds it from fixtures/sample if it is empty. Local mode uses a bare repo.
async function prepareCanon(projectId, artifacts) {
  const seedDir = join(work, "seed");
  cpSync(fixture, seedDir, { recursive: true });
  git(seedDir, ["init", "-q", "-b", "main"]);
  git(seedDir, ["add", "-A"]);
  git(seedDir, ["commit", "-q", "-m", "Seed canon from fixtures/sample"]);
  if (!artifacts) {
    const bare = join(work, "canon.git");
    git(work, ["clone", "-q", "--bare", seedDir, bare]);
    return { remote: bare, token: null };
  }
  const { canon } = await api(`/projects/${projectId}/canon`, { method: "POST" });
  log("operator", `${canon.created ? "created" : "opened"} canon ${canon.remote}`);
  let empty = true;
  try {
    empty = git(work, ["ls-remote", canon.remote, "refs/heads/main"], canon.token) === "";
  } catch {
    empty = true;
  }
  if (empty) {
    git(seedDir, ["push", "-q", canon.remote, "HEAD:main"], canon.token);
    log("operator", "seeded canon main from fixtures/sample");
  } else if (flag("seed")) {
    log("operator", "canon already has main; leaving it alone");
  }
  return { remote: canon.remote, token: canon.token };
}

async function runAgent(projectId, task, canon, artifacts) {
  const id = `${task.key}-${tag}`;
  const agent = `agent-${task.key}`;
  const claimed = await api(`/projects/${projectId}/intents`, {
    method: "POST",
    body: JSON.stringify({ id, title: task.title, goal: task.goal, agentId: agent, surface: { paths: task.paths, symbols: task.symbols } }),
  });
  const real = artifacts && claimed.token && claimed.intent.remote?.startsWith("https://");
  log(agent, `claimed ${task.paths.join(", ")}${claimed.overlap.length ? ` (overlaps ${claimed.overlap.join(", ")})` : ""} fork ${claimed.intent.forkRepo}${real ? " on Artifacts" : ""}`);
  if (artifacts && !real) log(agent, `fork error: ${claimed.intent.forkError ?? "no token returned"}`);

  const dir = join(work, id);
  const remote = real ? claimed.intent.remote : canon.remote;
  const token = real ? claimed.token : canon.token;
  git(work, ["clone", "-q", remote, dir], token);
  task.apply(dir);
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", `${task.title}\n\nLocus-Intent: ${id}`]);
  const commit = git(dir, ["rev-parse", "HEAD"]);
  if (real) {
    git(dir, ["push", "-q", remote, "HEAD:main"], token);
  } else {
    // Local stand-in for a fork: a branch on the bare canon.
    git(dir, ["push", "-q", "origin", `HEAD:refs/heads/fork/${id}`]);
  }
  const flagsSource = task.paths.includes("src/flags.ts") ? readFileSync(join(dir, "src/flags.ts"), "utf8") : undefined;
  const pushed = await api(`/projects/${projectId}/intents/${id}/pushed`, {
    method: "POST",
    body: JSON.stringify({ commit, files: task.paths, flagsSource }),
  });
  log(agent, `pushed ${commit.slice(0, 8)}${pushed.verified ? ", board read it back from Artifacts" : ", reported to board"}`);

  await api(`/projects/${projectId}/intents/${id}/context`, {
    method: "POST",
    body: JSON.stringify({ note: `${agent}: ${task.goal}` }),
  });
  await api(`/projects/${projectId}/intents/${id}/ready`, { method: "POST" });
  return { id, agent, task, dir, commit, remote, token, real };
}

async function landInCanon(projectId, canon, results, landedIds) {
  const dir = join(work, "canon-land");
  git(work, ["clone", "-q", canon.remote, dir], canon.token);
  const merged = [];
  for (const result of results.filter((item) => landedIds.has(item.id))) {
    const ref = result.real ? "main" : `fork/${result.id}`;
    git(dir, ["fetch", "-q", result.real ? result.remote : "origin", `${ref}:refs/locus/${result.id}`], result.real ? result.token : canon.token);
    try {
      git(dir, ["merge", "-q", "--no-edit", "-m", `Land ${result.id}`, `refs/locus/${result.id}`]);
      merged.push(result.id);
      log("canon", `merged ${result.id}`);
    } catch (error) {
      git(dir, ["merge", "--abort"]);
      log("canon", `merge conflict on ${result.id}, left for a person`);
    }
  }
  const { intents } = await api(`/projects/${projectId}/intents`);
  mkdirSync(join(dir, ".locus", "landed"), { recursive: true });
  for (const intent of intents.filter((item) => item.status === "landed")) {
    const lines = [
      `# ${intent.id}`,
      "",
      `Goal: ${intent.goal}`,
      `Agent: ${intent.agentId}`,
      `Verdict: ${intent.verdict ?? "free lane"}`,
      "",
      "Checks:",
      ...(intent.capsule?.evidence ?? intent.checks ?? []).map((check) => `- ${check.passed ? "pass" : "fail"} ${check.name}: ${check.detail}`),
      "",
      "Arena members (folded or rejected):",
      ...(intent.capsule?.rejected ?? []).map((item) => `- ${item.id}: ${item.goal}`),
      "",
      "Context:",
      ...(intent.contextNotes ?? []).map((note) => `- ${note}`),
      "",
    ];
    writeFileSync(join(dir, ".locus", "landed", `${intent.id}.md`), lines.join("\n"));
  }
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", `Locus: land ${merged.length} intents with their why files`]);
  git(dir, ["push", "-q", "origin", "HEAD:main"], canon.token);
  log("canon", `pushed canon main ${git(dir, ["rev-parse", "--short", "HEAD"])}`);
  return { dir, merged };
}

async function main() {
  const health = await (await fetch(`${base}/health`)).json();
  const artifacts = Boolean(health.artifacts);
  log("operator", `${base} artifacts=${artifacts} referee=${health.referee}`);
  await signIn();
  const { project } = await api("/projects", {
    method: "POST",
    body: JSON.stringify({ name: `Swarm ${tag}`, summary: `${agentCount} agents on the flag service` }),
  });
  log("operator", `opened project ${project.id}`);
  const canon = await prepareCanon(project.id, artifacts);

  const tasks = Array.from({ length: agentCount }, (_, i) => {
    const task = TASKS[i % TASKS.length];
    return i < TASKS.length ? task : { ...task, key: `${task.key}-${Math.floor(i / TASKS.length)}` };
  });
  const results = await Promise.all(tasks.map((task) => runAgent(project.id, task, canon, artifacts)));
  log("operator", `${results.length} agents pushed`);

  // Free lanes land straight away. Contended ones wait for the referee.
  const before = (await api(`/projects/${project.id}/intents`)).intents;
  for (const intent of before.filter((item) => results.some((r) => r.id === item.id) && !item.contended)) {
    await api(`/projects/${project.id}/intents/${intent.id}/land`, { method: "POST" });
    log("referee", `landed free lane ${intent.id}`);
  }
  const contended = before.filter((item) => item.contended).map((item) => item.id);
  log("referee", `arena: ${contended.join(", ") || "none"}`);
  const { decision } = await api(`/projects/${project.id}/referee`, { method: "POST" });
  if (decision) {
    log("referee", `${decision.verdict}${decision.winnerId ? ` -> ${decision.winnerId}` : ""}. ${decision.rationale}`);
    for (const [id, checks] of Object.entries(decision.checks)) {
      for (const check of checks) log("referee", `${check.passed ? "pass" : "FAIL"} ${id} ${check.name}: ${check.detail}`);
    }
  }

  // What lands in git: free lanes plus every arena member that passed when the
  // referee synthesized, or the single winner when it picked one.
  const landedIds = new Set(results.filter((r) => !contended.includes(r.id)).map((r) => r.id));
  if (decision?.verdict === "synthesize") {
    for (const id of decision.memberIds) {
      if ((decision.checks[id] ?? []).every((check) => check.passed)) landedIds.add(id);
    }
    await api(`/projects/${project.id}/intents/${decision.winnerId}/land`, { method: "POST" }).catch(() => undefined);
  } else if (decision?.winnerId) {
    landedIds.add(decision.winnerId);
  }
  const landed = await landInCanon(project.id, canon, results, landedIds);

  const why = await api(`/projects/${project.id}/why?path=src/flags.ts`);
  log("operator", `why src/flags.ts: ${JSON.stringify(why).slice(0, 240)}`);
  const flags = readFileSync(join(landed.dir, "src/flags.ts"), "utf8");
  console.log("\nCanon src/flags.ts after the swarm:\n" + flags);
  console.log(`Board: ${base}/app  Project: ${project.id}  Work dir: ${work}`);
  writeFileSync(join(work, "timeline.txt"), timeline.join("\n") + "\n");
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
