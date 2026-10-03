export type GitFile = {
  path: string;
  content: string;
};

export type GitCommit = {
  message: string;
  author: string;
  at: number;
  email?: string;
  files?: GitFile[];
};

export type GitRef = {
  name: string;
  message: string;
  author: string;
  email: string;
  at: number;
  files: GitFile[];
  history?: GitCommit[];
};

export function readmeFiles(name: string, summary: string): GitFile[] {
  return [{
    path: "README.md",
    content: `# ${name}\n\n${summary}\n\nClone this repository, commit, and push a branch. A push opens a pull request. Merging it updates main.\n`,
  }];
}

function linesOf(content: string): string[] {
  if (content === "") return [];
  const trimmed = content.endsWith("\n") ? content.slice(0, -1) : content;
  return trimmed === "" ? [] : trimmed.split("\n");
}

function joinLines(lines: string[], trailingNewline: boolean): string {
  if (!lines.length) return trailingNewline ? "\n" : "";
  return lines.join("\n") + (trailingNewline ? "\n" : "");
}

function addedFile(part: string): string {
  const lines: string[] = [];
  let inHunk = false;
  for (const line of part.split("\n")) {
    if (line.startsWith("@@")) {
      inHunk = true;
      continue;
    }
    if (!inHunk || !line.startsWith("+")) continue;
    lines.push(line.slice(1));
  }
  return joinLines(lines, !part.includes("No newline at end of file"));
}

function applyHunks(source: string, part: string): string | null {
  const lines = linesOf(source);
  const out: string[] = [];
  let cursor = 0;
  const body = part.split("\n");
  let index = body.findIndex((line) => line.startsWith("@@"));
  if (index < 0) return null;
  while (index < body.length) {
    const hunk = body[index].match(/^@@ -(\d+)(?:,\d+)? \+\d+(?:,\d+)? @@/);
    if (!hunk) break;
    const start = Number(hunk[1]) === 0 ? 0 : Number(hunk[1]) - 1;
    if (start < cursor || start > lines.length) return null;
    out.push(...lines.slice(cursor, start));
    cursor = start;
    index += 1;
    while (index < body.length && !body[index].startsWith("@@")) {
      const line = body[index];
      if (line.startsWith("\\")) {
        index += 1;
        continue;
      }
      if (line.startsWith("+")) {
        out.push(line.slice(1));
        index += 1;
        continue;
      }
      if (line.startsWith("-") || line.startsWith(" ")) {
        const expected = line.slice(1);
        if (lines[cursor] !== expected) return null;
        if (line.startsWith(" ")) out.push(expected);
        cursor += 1;
        index += 1;
        continue;
      }
      if (line === "") {
        index += 1;
        continue;
      }
      return null;
    }
  }
  out.push(...lines.slice(cursor));
  return joinLines(out, !part.includes("No newline at end of file"));
}

export function applyDiff(base: GitFile[], diff: string): { files: GitFile[]; error: string | null } {
  if (!diff.trim()) return { files: base, error: null };
  if (!diff.includes("diff --git ")) return { files: base, error: "The patch is not a unified diff." };
  const parts = diff.split(/\n(?=diff --git )/);
  const map = new Map(base.map((file) => [file.path, file.content]));
  for (const part of parts) {
    const header = part.split("\n")[0] ?? "";
    const match = header.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (!match) return { files: base, error: "A diff header is missing a path." };
    const from = match[1];
    const to = match[2];
    if (part.includes("\ndeleted file mode ") || part.includes("+++ /dev/null")) {
      map.delete(from);
      continue;
    }
    if (part.includes("\nnew file mode ") || part.includes("--- /dev/null")) {
      map.set(to, addedFile(part));
      continue;
    }
    const source = map.get(to) ?? map.get(from);
    if (source === undefined) return { files: base, error: `${to} is not on this branch.` };
    const next = applyHunks(source, part);
    if (next === null) return { files: base, error: `${to} does not apply on this branch.` };
    if (from !== to) map.delete(from);
    map.set(to, next);
  }
  return {
    files: [...map.entries()].map(([path, content]) => ({ path, content })),
    error: null,
  };
}

function unsafePath(path: string): boolean {
  if (path.includes("\0") || path.includes("\n") || path.includes("\r") || path.startsWith("/")) return true;
  return path.split("/").includes("..");
}

export function refName(input: string): string {
  const trimmed = input.trim();
  const name = trimmed.startsWith("refs/") ? trimmed : `refs/heads/${trimmed.replace(/^heads\//, "")}`;
  if (!/^refs\/heads\/[A-Za-z0-9._/-]+$/.test(name) || name.includes("..")) return "refs/heads/main";
  return name;
}

export function cleanFiles(files: GitFile[]): GitFile[] {
  const out: GitFile[] = [];
  const encoder = new TextEncoder();
  let bytes = 0;
  for (const file of files) {
    if (!file || typeof file.path !== "string" || typeof file.content !== "string") continue;
    if (file.content.includes("\0")) continue;
    const path = file.path.replaceAll("\\", "/").replace(/^\/+/, "");
    if (!path || path.length > 200 || unsafePath(path)) continue;
    const size = encoder.encode(file.content).byteLength;
    if (bytes + size > 800_000) break;
    bytes += size;
    out.push({ path, content: file.content });
    if (out.length >= 200) break;
  }
  return out;
}

function quotePath(path: string): string {
  if (!/[\s"]/.test(path)) return path;
  return `"${path.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

export function fastImport(refs: GitRef[]): string {
  const encoder = new TextEncoder();
  const chunks: string[] = ["feature done\n"];
  let mark = 1;
  for (const ref of refs) {
    const modes: string[] = [];
    for (const file of ref.files) {
      const size = encoder.encode(file.content).byteLength;
      chunks.push(`blob\nmark :${mark}\ndata ${size}\n${file.content}\n`);
      modes.push(`M 100644 :${mark} ${quotePath(file.path)}\n`);
      mark += 1;
    }
    const message = ref.message || ref.name;
    const when = Math.floor(ref.at / 1000);
    chunks.push(`commit ${ref.name}\n`);
    chunks.push(`mark :${mark}\n`);
    chunks.push(`committer ${ref.author} <${ref.email}> ${when} +0000\n`);
    chunks.push(`data ${encoder.encode(message).byteLength}\n${message}\n`);
    chunks.push(...modes, "\n");
    mark += 1;
  }
  chunks.push("done\n");
  return chunks.join("");
}

type Edit = { op: "eq" | "del" | "ins"; line: string };

function edits(before: string[], after: string[]): Edit[] {
  const n = before.length;
  const m = after.length;
  if (n * m > 250_000) {
    return [
      ...before.map((line) => ({ op: "del" as const, line })),
      ...after.map((line) => ({ op: "ins" as const, line })),
    ];
  }
  const scores = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      scores[i][j] = before[i] === after[j] ? scores[i + 1][j + 1] + 1 : Math.max(scores[i + 1][j], scores[i][j + 1]);
    }
  }
  const script: Edit[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      script.push({ op: "eq", line: before[i] });
      i += 1;
      j += 1;
    } else if (scores[i + 1][j] >= scores[i][j + 1]) {
      script.push({ op: "del", line: before[i] });
      i += 1;
    } else {
      script.push({ op: "ins", line: after[j] });
      j += 1;
    }
  }
  while (i < n) script.push({ op: "del", line: before[i++] });
  while (j < m) script.push({ op: "ins", line: after[j++] });
  return script;
}

function unified(path: string, before: string, after: string, kind: "new" | "delete" | "modify"): string {
  const older = linesOf(before);
  const newer = linesOf(after);
  const script = edits(older, newer);
  const context = 3;
  const keep = script.map((edit) => edit.op !== "eq");
  for (let index = 0; index < script.length; index += 1) {
    if (!keep[index]) continue;
    for (let near = Math.max(0, index - context); near <= Math.min(script.length - 1, index + context); near += 1) keep[near] = true;
  }
  const oldAt: number[] = [];
  const newAt: number[] = [];
  let oldLine = 1;
  let newLine = 1;
  for (const edit of script) {
    oldAt.push(oldLine);
    newAt.push(newLine);
    if (edit.op !== "ins") oldLine += 1;
    if (edit.op !== "del") newLine += 1;
  }
  const header = [`diff --git a/${path} b/${path}`];
  if (kind === "new") header.push("new file mode 100644", "--- /dev/null", `+++ b/${path}`);
  else if (kind === "delete") header.push("deleted file mode 100644", `--- a/${path}`, "+++ /dev/null");
  else header.push(`--- a/${path}`, `+++ b/${path}`);
  const body: string[] = [];
  let index = 0;
  while (index < script.length) {
    if (!keep[index]) {
      index += 1;
      continue;
    }
    let end = index;
    while (end < script.length && keep[end]) end += 1;
    const slice = script.slice(index, end);
    const oldCount = slice.filter((edit) => edit.op !== "ins").length;
    const newCount = slice.filter((edit) => edit.op !== "del").length;
    body.push(`@@ -${oldCount === 0 ? 0 : oldAt[index]},${oldCount} +${newCount === 0 ? 0 : newAt[index]},${newCount} @@`);
    for (const edit of slice) {
      const prefix = edit.op === "del" ? "-" : edit.op === "ins" ? "+" : " ";
      body.push(prefix + edit.line);
    }
    index = end;
  }
  return [...header, ...body].join("\n");
}

export function diffFiles(before: GitFile[], after: GitFile[]): string {
  const older = new Map(before.map((file) => [file.path, file.content]));
  const newer = new Map(after.map((file) => [file.path, file.content]));
  const parts: string[] = [];
  for (const path of [...new Set([...older.keys(), ...newer.keys()])].sort()) {
    const previous = older.get(path);
    const next = newer.get(path);
    if (previous === next) continue;
    if (previous === undefined) parts.push(unified(path, "", next ?? "", "new"));
    else if (next === undefined) parts.push(unified(path, previous, "", "delete"));
    else parts.push(unified(path, previous, next, "modify"));
  }
  return parts.join("\n");
}
