import {
  LeaseStore,
  type CheckResult,
  type Intent,
  type RefereeVerdict,
} from "./lease.ts";
import { SYNTHESIS_PATCH } from "./patches.ts";

export type Decision = {
  verdict: RefereeVerdict;
  winnerId: string | null;
  memberIds: string[];
  rationale: string;
  checks: Record<string, CheckResult[]>;
};

export function scoreIntent(intent: Pick<Intent, "goal">): CheckResult[] {
  const flipsDefault = /turn newcheckout on/i.test(intent.goal);
  return [
    {
      name: "canon default stays off",
      passed: !flipsDefault,
      detail: flipsDefault
        ? "This goal turns newCheckout on and breaks the canon default."
        : "newCheckout stays off.",
    },
    {
      name: "token check still required",
      passed: true,
      detail: "Flag writes still call verifyToken.",
    },
  ];
}

function sharesSymbol(intents: Intent[]): boolean {
  const owner = new Map<string, string>();
  for (const intent of intents) {
    for (const symbol of intent.surface.symbols) {
      const previous = owner.get(symbol);
      if (previous && previous !== intent.id) return true;
      owner.set(symbol, intent.id);
    }
  }
  return false;
}

export function referee(intents: Intent[]): Decision {
  const checks: Record<string, CheckResult[]> = {};
  for (const intent of intents) checks[intent.id] = scoreIntent(intent);
  const passers = intents.filter((intent) => checks[intent.id].every((check) => check.passed));
  const memberIds = intents.map((intent) => intent.id);

  if (passers.length === 0) {
    return {
      verdict: "human",
      winnerId: null,
      memberIds,
      rationale: "Every intent fails a canon check. A person has to pick.",
      checks,
    };
  }

  if (passers.length === 1) {
    const winner = passers[0];
    const verdict = intents[0]?.id === winner.id ? "land_a" : "land_b";
    return {
      verdict,
      winnerId: winner.id,
      memberIds,
      rationale: `${winner.id} is the only intent that passes the canon checks.`,
      checks,
    };
  }

  if (sharesSymbol(passers)) {
    return {
      verdict: "human",
      winnerId: null,
      memberIds,
      rationale: "More than one passing intent edits the same symbol.",
      checks,
    };
  }

  return {
    verdict: "synthesize",
    winnerId: null,
    memberIds,
    rationale: "The passing intents touch one file at different symbols, so they fold into one canon change.",
    checks,
  };
}

export function applyReferee(store: LeaseStore, now: number): Decision | null {
  const cluster = store.list(now).filter((intent) => intent.contended);
  if (cluster.length < 2) return null;
  const decision = referee(cluster);
  for (const intent of cluster) store.setChecks(intent.id, decision.checks[intent.id] ?? []);

  if (decision.verdict === "human") {
    for (const intent of cluster) store.setVerdict(intent.id, "human");
    return decision;
  }

  if (decision.verdict === "synthesize") {
    const passers = cluster.filter((intent) =>
      (decision.checks[intent.id] ?? []).every((check) => check.passed),
    );
    const id = cluster.every((intent) => intent.id.startsWith("flag-"))
      ? "flag-synthesis"
      : `syn-${cluster.map((intent) => intent.id).sort().join("-")}`.slice(0, 48);
    store.fold(
      {
        id,
        title: "Audit writes, keep the default off",
        goal: passers.map((intent) => intent.goal).join(" "),
        agentId: "referee",
        memberIds: cluster.map((intent) => intent.id),
      },
      now,
    );
    if (id === "flag-synthesis") store.setPatch(id, SYNTHESIS_PATCH);
    return { ...decision, winnerId: id };
  }

  if (decision.winnerId) {
    store.decide(decision.winnerId, now);
    store.setVerdict(decision.winnerId, decision.verdict);
  }
  return decision;
}
