export type ArtifactsCreateResult = {
  name: string;
  remote: string;
  defaultBranch?: string;
  token?: unknown;
};

export type ArtifactsRepoHandle = {
  info: () => Promise<{ defaultBranch?: string }>;
  readFile: (args: { ref: string; path: string }) => Promise<Blob | null>;
  fork: (
    name: string,
    opts?: { description?: string; defaultBranchOnly?: boolean; readOnly?: boolean },
  ) => Promise<ArtifactsCreateResult>;
  createToken: (scope: "read" | "write", ttlSeconds: number) => Promise<unknown>;
  log?: (opts?: { ref?: string; limit?: number }) => Promise<{ id?: string; hash?: string; message?: string }[]>;
  [Symbol.dispose]?: () => void;
  [Symbol.asyncDispose]?: () => Promise<void>;
};

export type ArtifactsNamespace = {
  get: (name: string) => Promise<ArtifactsRepoHandle>;
  create?: (
    name: string,
    opts?: { description?: string; setDefaultBranch?: string },
  ) => Promise<ArtifactsCreateResult>;
};

export type ForkResult = {
  name: string;
  remote: string;
  defaultBranch: string;
  token: string | null;
  agentsMd: string | null;
};

// create(), import() and fork() return the token as a string.
// repo.createToken() returns { plaintext, expiresAt }.
export function tokenString(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  if (value && typeof value === "object") {
    for (const key of ["plaintext", "token"]) {
      if (key in value) {
        const token = (value as Record<string, unknown>)[key];
        if (typeof token === "string" && token.length > 0) return token;
      }
    }
  }
  return null;
}

async function release(handle: ArtifactsRepoHandle): Promise<void> {
  const dispose = handle[Symbol.asyncDispose];
  if (dispose) {
    await dispose.call(handle);
    return;
  }
  handle[Symbol.dispose]?.call(handle);
}

export async function forkIntent(
  artifacts: ArtifactsNamespace,
  canon: string,
  name: string,
): Promise<ForkResult> {
  const repo = await artifacts.get(canon);
  try {
    const info = await repo.info();
    const defaultBranch = info.defaultBranch ?? "main";
    const file = await repo.readFile({ ref: defaultBranch, path: "AGENTS.md" });
    const agentsMd = file ? await file.text() : null;
    const forked = await repo.fork(name, {
      description: `Locus intent ${name}`,
      defaultBranchOnly: true,
      readOnly: false,
    });
    let token = tokenString(forked.token);
    if (!token) {
      const forkedRepo = await artifacts.get(forked.name);
      try {
        token = tokenString(await forkedRepo.createToken("write", 3600));
      } finally {
        await release(forkedRepo);
      }
    }
    return {
      name: forked.name,
      remote: forked.remote,
      defaultBranch,
      token,
      agentsMd,
    };
  } finally {
    await release(repo);
  }
}

export type CanonResult = {
  name: string;
  remote: string;
  defaultBranch: string;
  token: string | null;
  created: boolean;
};

// Make sure the canon repo exists in Artifacts and mint a short write token
// so the operator can seed it with `git push`.
export async function ensureCanonRepo(
  artifacts: ArtifactsNamespace,
  name: string,
): Promise<CanonResult> {
  let repo: ArtifactsRepoHandle | null = null;
  try {
    repo = await artifacts.get(name);
  } catch {
    repo = null;
  }
  if (!repo) {
    if (!artifacts.create) throw new Error("This Artifacts binding cannot create repos");
    const created = await artifacts.create(name, {
      description: "Locus canon",
      setDefaultBranch: "main",
    });
    return {
      name: created.name,
      remote: created.remote,
      defaultBranch: created.defaultBranch ?? "main",
      token: tokenString(created.token),
      created: true,
    };
  }
  try {
    const info = (await repo.info()) as { defaultBranch?: string; remote?: string; name?: string };
    const token = tokenString(await repo.createToken("write", 3600));
    return {
      name: info.name ?? name,
      remote: info.remote ?? "",
      defaultBranch: info.defaultBranch ?? "main",
      token,
      created: false,
    };
  } finally {
    await release(repo);
  }
}

export type ForkHead = { commit: string | null; files: Record<string, string | null> };

// Read the fork head and the named files straight from Artifacts, so the board
// records what the agent actually pushed instead of what it says it pushed.
export async function readForkHead(
  artifacts: ArtifactsNamespace,
  repoName: string,
  paths: string[],
): Promise<ForkHead> {
  const repo = await artifacts.get(repoName);
  try {
    const info = await repo.info();
    const ref = info.defaultBranch ?? "main";
    const history = repo.log ? await repo.log({ ref, limit: 1 }) : [];
    const top = history[0];
    const commit = (top?.id ?? top?.hash ?? null) as string | null;
    const files: Record<string, string | null> = {};
    for (const path of paths.slice(0, 8)) {
      const blob = await repo.readFile({ ref, path });
      files[path] = blob ? await blob.text() : null;
    }
    return { commit, files };
  } finally {
    await release(repo);
  }
}
