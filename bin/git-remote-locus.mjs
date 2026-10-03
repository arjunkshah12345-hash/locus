#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { homedir } from "node:os";
import { join } from "node:path";

process.stdout.on("error", () => {});

const project = (process.argv[3] || "").replace(/^locus::/, "");
const creds = JSON.parse(readFileSync(join(homedir(), ".locus", "credentials.json"), "utf8"));
const base = creds.url.replace(/\/$/, "");

function say(line = "") {
  try {
    process.stdout.write(`${line}\n`);
  } catch {
    // Git closes the pipe after it has the result.
  }
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trimEnd();
}

function authHeaders() {
  return { authorization: `Bearer ${creds.token}` };
}

function filesAt(src) {
  let names = [];
  try {
    names = git(["ls-tree", "-r", "--name-only", "-z", src]).split("\0").filter(Boolean);
  } catch {
    return [];
  }
  const files = [];
  let bytes = 0;
  for (const path of names) {
    if (files.length >= 200) break;
    let content = "";
    try {
      content = execFileSync("git", ["show", `${src}:${path}`], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    } catch {
      continue;
    }
    if (content.includes("\0")) continue;
    bytes += Buffer.byteLength(content);
    if (bytes > 800_000) break;
    files.push({ path, content });
  }
  return files;
}

async function pushRef(src, dst) {
  const commit = git(["rev-parse", src]);
  let hasParent = true;
  try {
    git(["rev-parse", "--verify", "--quiet", `${src}^`]);
  } catch {
    hasParent = false;
  }
  const diff = hasParent ? git(["diff", `${src}^`, src]) : git(["show", "--format=", src]);
  const message = git(["log", "-1", "--format=%s", src]);
  const response = await fetch(`${base}/api/projects/${encodeURIComponent(project)}/git/push`, {
    method: "POST",
    headers: { ...authHeaders(), "content-type": "application/json" },
    body: JSON.stringify({ ref: dst, commit, message, diff, files: filesAt(src) }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    say(`error ${dst} ${body.error || "push failed"}`);
    return;
  }
  say(`ok ${dst}`);
}

async function listRefs() {
  const response = await fetch(`${base}/api/projects/${encodeURIComponent(project)}/git/refs`, {
    headers: authHeaders(),
  });
  if (!response.ok) return [];
  const body = await response.json().catch(() => ({}));
  return body.refs || [];
}

async function importRefs(names) {
  const params = new URLSearchParams();
  for (const name of names) params.append("ref", name);
  const response = await fetch(`${base}/api/projects/${encodeURIComponent(project)}/git/import?${params}`, {
    headers: authHeaders(),
  });
  const text = await response.text();
  if (!response.ok) {
    process.stderr.write(`${text}\n`);
    process.stdout.write("feature done\ndone\n");
    return;
  }
  process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
let batch = [];

for await (const line of lines) {
  if (line === "capabilities") {
    say("push");
    say("import");
    say("refspec refs/heads/*:refs/heads/*");
    say("option");
    say();
    continue;
  }
  if (line === "list") {
    const refs = await listRefs();
    for (const ref of refs) say(`? ${ref.name}`);
    if (refs.length) {
      const head = refs.find((ref) => ref.name === "refs/heads/main") ?? refs[0];
      say(`@${head.name} HEAD`);
    }
    say();
    continue;
  }
  if (line === "list for-push") {
    say();
    continue;
  }
  if (line.startsWith("option ")) {
    say("unsupported");
    continue;
  }
  if (line !== "") {
    batch.push(line);
    continue;
  }
  const pushes = batch.filter((item) => item.startsWith("push "));
  const imports = batch.filter((item) => item.startsWith("import ")).map((item) => item.slice(7));
  batch = [];
  if (imports.length) {
    await importRefs(imports);
    continue;
  }
  if (!pushes.length) continue;
  try {
    for (const item of pushes) {
      const ref = item.slice(5);
      const [src, dst] = ref.split(":");
      await pushRef(src, dst || src);
    }
    say();
  } catch (error) {
    say(`error refs/heads/main ${error.message}`);
    say();
  }
}
