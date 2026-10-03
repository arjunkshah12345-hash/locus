#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const home = join(homedir(), ".locus");
const credPath = join(home, "credentials.json");

function creds() {
  return JSON.parse(readFileSync(credPath, "utf8"));
}

function save(next) {
  mkdirSync(home, { recursive: true });
  writeFileSync(credPath, JSON.stringify(next, null, 2));
}

function args(argv) {
  const out = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item.startsWith("--")) {
      out[item.slice(2)] = argv[index + 1];
      index += 1;
    } else out._.push(item);
  }
  return out;
}

async function api(path, options = {}) {
  const auth = creds();
  const response = await fetch(auth.url.replace(/\/$/, "") + path, {
    ...options,
    headers: {
      authorization: `Bearer ${auth.token}`,
      "content-type": "application/json",
      ...(options.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}

const flags = args(process.argv.slice(3));
const command = process.argv[2];

if (command === "signup" || command === "login") {
  const url = flags.url || "http://127.0.0.1:8787";
  const response = await fetch(`${url.replace(/\/$/, "")}/api/auth/${command}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: flags.name, email: flags.email, password: flags.password }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Auth failed");
  save({ url, token: body.token, email: body.user.email, name: body.user.name });
  console.log(`${body.user.name} signed in at ${url}`);
} else if (command === "whoami") {
  const auth = creds();
  console.log(`${auth.name} <${auth.email}> ${auth.url}`);
} else if (command === "repos") {
  const body = await api("/api/projects");
  for (const project of body.projects) console.log(`${project.id}\t${project.name}`);
} else if (command === "issue") {
  const [project, title, text] = flags._;
  const body = await api(`/api/projects/${encodeURIComponent(project)}/issues`, {
    method: "POST",
    body: JSON.stringify({ title, body: text || "" }),
  });
  console.log(`#${body.issue.number} ${body.issue.title}`);
} else if (command === "pr") {
  const project = flags._[0];
  const body = await api(`/api/projects/${encodeURIComponent(project)}/pulls`, {
    method: "POST",
    body: JSON.stringify({
      title: flags.title,
      body: flags.body || "",
      goal: flags.body || flags.title,
      paths: String(flags.paths || "").split(",").map((item) => item.trim()).filter(Boolean),
      patch: flags.patch || "",
      head: flags.head || "refs/heads/main",
    }),
  });
  console.log(`#${body.pull.number} ${body.pull.title}`);
} else {
  console.log(`locus signup --url <worker> --name <name> --email <email> --password <password>
locus login --url <worker> --email <email> --password <password>
locus whoami
locus repos
locus issue <project> <title> <body>
locus pr <project> --title <title> --paths <a,b> --patch <diff>
git remote add origin locus::<project>
git push origin HEAD:refs/heads/feature
git fetch origin`);
  process.exit(command ? 1 : 0);
}
