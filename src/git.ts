export type GitFile = {
  path: string;
  content: string;
};

export type GitRef = {
  name: string;
  message: string;
  author: string;
  email: string;
  at: number;
  files: GitFile[];
};

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
