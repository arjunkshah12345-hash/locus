export type GitFile = {
  path: string;
  content: string;
};

export type GitCommit = {
  message: string;
  author: string;
  at: number;
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
