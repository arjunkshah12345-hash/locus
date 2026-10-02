export type Surface = {
  paths: string[];
  symbols: string[];
};

export type IntentStatus = "active" | "ready" | "landed" | "abandoned";

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

export class LeaseStore {
  private intents: Intent[];

  constructor(initial: Intent[] = []) {
    this.intents = initial.map((intent) => ({
      ...intent,
      surface: {
        paths: [...intent.surface.paths],
        symbols: [...intent.surface.symbols],
      },
      conflicts: [...intent.conflicts],
    }));
  }

  snapshot(): Intent[] {
    return this.intents.map((intent) => ({
      ...intent,
      surface: {
        paths: [...intent.surface.paths],
        symbols: [...intent.surface.symbols],
      },
      conflicts: [...intent.conflicts],
    }));
  }

  list(now: number): Intent[] {
    this.expire(now);
    return this.snapshot();
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
    this.markLanded(intent, now);
    this.recompute();
    return this.clone(intent);
  }

  decide(winnerId: string, now: number): { winner: Intent; abandoned: string[] } {
    this.expire(now);
    const winner = this.requireHolding(winnerId);
    const abandoned: string[] = [];
    for (const other of this.intents) {
      if (other.id === winner.id || !holdsLease(other)) continue;
      if (!overlaps(winner.surface, other.surface)) continue;
      other.status = "abandoned";
      other.abandonedReason = `lost to ${winner.id}`;
      other.contended = false;
      other.conflicts = [];
      abandoned.push(other.id);
    }
    this.markLanded(winner, now);
    this.recompute();
    return { winner: this.clone(winner), abandoned };
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

  why(path: string): Intent[] {
    const key = `path:${path}`;
    return this.snapshot().filter(
      (intent) =>
        intent.status === "landed" && surfaceKeys(intent.surface).includes(key),
    );
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

  private markLanded(intent: Intent, now: number): void {
    intent.status = "landed";
    intent.landedAt = now;
    intent.contended = false;
    intent.conflicts = [];
    intent.abandonedReason = null;
  }

  private clone(intent: Intent): Intent {
    return {
      ...intent,
      surface: {
        paths: [...intent.surface.paths],
        symbols: [...intent.surface.symbols],
      },
      conflicts: [...intent.conflicts],
    };
  }
}
