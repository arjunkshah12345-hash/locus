export type Surface = {
  paths: string[];
  symbols: string[];
};

export type IntentStatus = "active" | "ready" | "landed" | "abandoned";

export type CheckResult = {
  name: string;
  passed: boolean;
  detail: string;
};

export type Capsule = {
  id: string;
  goal: string;
  agentId: string;
  evidence: CheckResult[];
  rejected: { id: string; goal: string }[];
  file: string;
};

export type RefereeVerdict = "land_a" | "land_b" | "synthesize" | "human";

export type Intent = {
  id: string;
  title: string;
  goal: string;
  agentId: string;
  surface: Surface;
  status: IntentStatus;
  contended: boolean;
  conflicts: string[];
  forkRepo: string | null;
  remote: string | null;
  forkError: string | null;
  previewUrl: string | null;
  headCommit: string | null;
  checks: CheckResult[];
  capsule: Capsule | null;
  verdict: RefereeVerdict | null;
  contextNotes: string[];
  createdAt: number;
  expiresAt: number;
  landedAt: number | null;
  abandonedReason: string | null;
};

export type ClaimInput = {
  id: string;
  title: string;
  goal: string;
  agentId: string;
  surface: Surface;
};

export const LEASE_TTL_MS = 15 * 60 * 1000;

export class LeaseError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "LeaseError";
    this.code = code;
  }
}

export function surfaceKeys(surface: Surface): string[] {
  return [
    ...surface.paths.map((path) => `path:${path}`),
    ...surface.symbols.map((symbol) => `symbol:${symbol}`),
  ];
}

export function overlapKeys(left: Surface, right: Surface): string[] {
  const keys = new Set(surfaceKeys(right));
  return surfaceKeys(left).filter((key) => keys.has(key));
}

export function overlaps(left: Surface, right: Surface): boolean {
  return overlapKeys(left, right).length > 0;
}

function holdsLease(intent: Intent): boolean {
  return intent.status === "active" || intent.status === "ready";
}

function copyChecks(checks: CheckResult[] | undefined): CheckResult[] {
  return (checks ?? []).map((check) => ({ ...check }));
}

function copyCapsule(capsule: Capsule | null | undefined): Capsule | null {
  if (!capsule) return null;
  return {
    ...capsule,
    evidence: copyChecks(capsule.evidence),
    rejected: capsule.rejected.map((item) => ({ ...item })),
  };
}

export class LeaseStore {
  private intents: Intent[];

  constructor(initial: Intent[] = []) {
    this.intents = initial.map((intent) => this.clone(intent));
  }

  snapshot(): Intent[] {
    return this.intents.map((intent) => this.clone(intent));
  }

  list(now: number): Intent[] {
    this.expire(now);
    return this.snapshot();
  }

  get(id: string): Intent | null {
    const intent = this.intents.find((item) => item.id === id);
    return intent ? this.clone(intent) : null;
  }

  claim(input: ClaimInput, now: number): { intent: Intent; overlap: string[] } {
    this.expire(now);
    if (this.intents.some((intent) => intent.id === input.id)) {
      throw new LeaseError(`Intent ${input.id} already exists`, "exists");
    }
    const surface = {
      paths: [...input.surface.paths],
      symbols: [...input.surface.symbols],
    };
    const overlap = new Set<string>();
    for (const other of this.intents) {
      if (!holdsLease(other)) continue;
      for (const key of overlapKeys(surface, other.surface)) overlap.add(key);
    }
    const intent: Intent = {
      id: input.id,
      title: input.title,
      goal: input.goal,
      agentId: input.agentId,
      surface,
      status: "active",
      contended: false,
      conflicts: [],
      forkRepo: null,
      remote: null,
      forkError: null,
      previewUrl: null,
      headCommit: null,
      checks: [],
      capsule: null,
      verdict: null,
      contextNotes: [],
      createdAt: now,
      expiresAt: now + LEASE_TTL_MS,
      landedAt: null,
      abandonedReason: null,
    };
    this.intents.push(intent);
    this.recompute();
    const stored = this.intents.find((item) => item.id === intent.id);
    if (!stored) throw new LeaseError("Claim disappeared", "internal");
    return { intent: this.clone(stored), overlap: [...overlap] };
  }

  heartbeat(id: string, now: number): Intent {
    this.expire(now);
    const intent = this.requireHolding(id);
    intent.expiresAt = now + LEASE_TTL_MS;
    return this.clone(intent);
  }

  ready(id: string, now: number): Intent {
    this.expire(now);
    const intent = this.requireHolding(id);
    intent.status = "ready";
    this.recompute();
    return this.clone(intent);
  }

  land(id: string, now: number): Intent {
    this.expire(now);
    const intent = this.requireHolding(id);
    if (intent.contended) {
      throw new LeaseError(
        `${id} overlaps ${intent.conflicts.join(", ")}. Decide a winner instead of landing it alone.`,
        "contended",
      );
    }
    this.markLanded(intent, now, []);
    this.recompute();
    return this.clone(intent);
  }

  decide(winnerId: string, now: number): { winner: Intent; abandoned: string[] } {
    this.expire(now);
    const winner = this.requireHolding(winnerId);
    const rejected = this.intents.filter(
      (other) =>
        other.id !== winner.id && holdsLease(other) && overlaps(winner.surface, other.surface),
    );
    const abandoned: string[] = [];
    for (const other of rejected) {
      other.status = "abandoned";
      other.abandonedReason = `lost to ${winner.id}`;
      other.contended = false;
      other.conflicts = [];
      abandoned.push(other.id);
    }
    this.markLanded(winner, now, rejected.map((item) => ({ id: item.id, goal: item.goal })));
    this.recompute();
    return { winner: this.clone(winner), abandoned };
  }

  fold(
    input: { id: string; title: string; goal: string; agentId: string; memberIds: string[] },
    now: number,
  ): Intent {
    this.expire(now);
    const members = input.memberIds.map((id) => {
      const intent = this.intents.find((item) => item.id === id);
      if (!intent) throw new LeaseError(`Unknown intent ${id}`, "missing");
      return intent;
    });
    const rejected = members.map((member) => ({ id: member.id, goal: member.goal }));
    const paths = [...new Set(members.flatMap((member) => member.surface.paths))];
    const symbols = [...new Set(members.flatMap((member) => member.surface.symbols))];
    const checks = members
      .filter((member) => member.checks.length > 0 && member.checks.every((check) => check.passed))
      .flatMap((member) => member.checks);
    for (const member of members) {
      if (!holdsLease(member)) continue;
      member.status = "abandoned";
      member.abandonedReason = `folded into ${input.id}`;
      member.contended = false;
      member.conflicts = [];
    }
    this.claim(
      {
        id: input.id,
        title: input.title,
        goal: input.goal,
        agentId: input.agentId,
        surface: { paths, symbols },
      },
      now,
    );
    const stored = this.requireHolding(input.id);
    stored.checks = copyChecks(checks);
    stored.verdict = "synthesize";
    stored.forkRepo = `i-${input.id}`;
    stored.remote = `memory://locus/i-${input.id}`;
    stored.previewUrl = `/preview/${input.id}`;
    this.markLanded(stored, now, rejected);
    this.recompute();
    return this.clone(stored);
  }

  attachFork(
    id: string,
    fork: { forkRepo: string; remote: string } | { forkError: string },
  ): Intent {
    const intent = this.intents.find((item) => item.id === id);
    if (!intent) throw new LeaseError(`Unknown intent ${id}`, "missing");
    if ("forkError" in fork) {
      intent.forkError = fork.forkError;
    } else {
      intent.forkRepo = fork.forkRepo;
      intent.remote = fork.remote;
      intent.forkError = null;
    }
    return this.clone(intent);
  }

  notePush(
    repoName: string,
    after: string,
    files?: string[],
    previewUrl?: string,
  ): Intent | null {
    const intent = this.intents.find((item) => item.forkRepo === repoName);
    if (!intent || !holdsLease(intent)) return null;
    intent.headCommit = after;
    if (files && files.length > 0) intent.surface.paths = [...files];
    intent.previewUrl = previewUrl ?? `/preview/${intent.id}`;
    this.recompute();
    return this.clone(intent);
  }

  setChecks(id: string, checks: CheckResult[]): void {
    const intent = this.intents.find((item) => item.id === id);
    if (!intent) throw new LeaseError(`Unknown intent ${id}`, "missing");
    intent.checks = copyChecks(checks);
  }

  setVerdict(id: string, verdict: RefereeVerdict): void {
    const intent = this.intents.find((item) => item.id === id);
    if (!intent) throw new LeaseError(`Unknown intent ${id}`, "missing");
    intent.verdict = verdict;
  }

  appendContext(id: string, note: string, now: number): Intent {
    this.expire(now);
    const intent = this.requireHolding(id);
    intent.contextNotes.push(note);
    return this.clone(intent);
  }

  why(path: string): Intent[] {
    const key = `path:${path}`;
    return this.snapshot().filter(
      (intent) =>
        intent.status === "landed" && surfaceKeys(intent.surface).includes(key),
    );
  }

  brief(now: number): string {
    const intents = this.list(now);
    const lines = ["Active leases:"];
    for (const intent of intents) {
      if (!holdsLease(intent)) continue;
      lines.push(
        `- ${intent.agentId} holds ${intent.surface.paths.join(", ") || "no path"} for: ${intent.goal}`,
      );
    }
    lines.push("Landed:");
    for (const intent of intents) {
      if (intent.status !== "landed" || !intent.capsule) continue;
      lines.push(`- ${intent.capsule.file}: ${intent.goal}`);
    }
    return lines.join("\n");
  }

  private expire(now: number): void {
    let changed = false;
    for (const intent of this.intents) {
      if (!holdsLease(intent) || intent.expiresAt > now) continue;
      intent.status = "abandoned";
      intent.abandonedReason = "lease expired";
      changed = true;
    }
    if (changed) this.recompute();
  }

  private recompute(): void {
    const active = this.intents.filter(holdsLease);
    for (const intent of active) {
      const hits = active.filter(
        (other) => other.id !== intent.id && overlaps(intent.surface, other.surface),
      );
      intent.contended = hits.length > 0;
      intent.conflicts = hits.map((other) => other.id);
    }
    for (const intent of this.intents) {
      if (holdsLease(intent)) continue;
      intent.contended = false;
      intent.conflicts = [];
    }
  }

  private requireHolding(id: string): Intent {
    const intent = this.intents.find((item) => item.id === id);
    if (!intent) throw new LeaseError(`Unknown intent ${id}`, "missing");
    if (!holdsLease(intent)) {
      throw new LeaseError(`${id} is ${intent.status}`, intent.status);
    }
    return intent;
  }

  private markLanded(
    intent: Intent,
    now: number,
    rejected: { id: string; goal: string }[],
  ): void {
    intent.status = "landed";
    intent.landedAt = now;
    intent.contended = false;
    intent.conflicts = [];
    intent.abandonedReason = null;
    intent.capsule = {
      id: intent.id,
      goal: intent.goal,
      agentId: intent.agentId,
      evidence: copyChecks(intent.checks),
      rejected: rejected.map((item) => ({ ...item })),
      file: `.locus/landed/${intent.id}.json`,
    };
  }

  private clone(intent: Intent): Intent {
    return {
      ...intent,
      surface: {
        paths: [...(intent.surface?.paths ?? [])],
        symbols: [...(intent.surface?.symbols ?? [])],
      },
      conflicts: [...(intent.conflicts ?? [])],
      checks: copyChecks(intent.checks),
      capsule: copyCapsule(intent.capsule),
      contextNotes: [...(intent.contextNotes ?? [])],
      headCommit: intent.headCommit ?? null,
      verdict: intent.verdict ?? null,
      previewUrl: intent.previewUrl ?? null,
      forkRepo: intent.forkRepo ?? null,
      remote: intent.remote ?? null,
      forkError: intent.forkError ?? null,
    };
  }
}
