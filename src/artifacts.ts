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

function tokenString(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  if (value && typeof value === "object" && "token" in value) {
    const token = (value as { token: unknown }).token;
    if (typeof token === "string" && token.length > 0) return token;
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
