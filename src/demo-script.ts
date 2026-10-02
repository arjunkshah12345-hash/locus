import { LeaseStore, type Intent } from "./lease.ts";

export type DemoTask = {
  id: string;
  title: string;
  goal: string;
  agentId: string;
  paths: string[];
  symbols: string[];
};

export const DEMO_TASKS: DemoTask[] = [
  {
    id: "rate-limit",
    title: "Rate limit /flags",
    goal: "Reject bursts against the flag API without changing flag storage.",
    agentId: "agent-rate",
    paths: ["src/index.ts"],
    symbols: ["src/index.ts#fetch"],
  },
  {
    id: "flag-default",
    title: "Change the flag default",
    goal: "Turn newCheckout on by default.",
    agentId: "agent-default",
    paths: ["src/flags.ts"],
    symbols: ["src/flags.ts#DEFAULT_FLAGS"],
  },
  {
    id: "flag-audit",
    title: "Audit flag writes",
    goal: "Record who called setFlag and when.",
    agentId: "agent-audit",
    paths: ["src/flags.ts"],
    symbols: ["src/flags.ts#setFlag"],
  },
  {
    id: "flag-default-b",
    title: "Alternate flag default",
    goal: "Keep newCheckout off and add a staged rollout flag instead.",
    agentId: "agent-default-b",
    paths: ["src/flags.ts"],
    symbols: ["src/flags.ts#DEFAULT_FLAGS"],
  },
  {
    id: "docs",
    title: "Document the flags",
    goal: "Explain the flag endpoint in the README.",
    agentId: "agent-docs",
    paths: ["README.md"],
    symbols: [],
  },
  {
    id: "auth",
    title: "Tighten token checks",
    goal: "Reject expired tokens in verifyToken.",
    agentId: "agent-auth",
    paths: ["src/auth.ts"],
    symbols: ["src/auth.ts#verifyToken"],
  },
  {
    id: "obs",
    title: "Add a log helper",
    goal: "Add src/log.ts for request lines.",
    agentId: "agent-obs",
    paths: ["src/log.ts"],
    symbols: [],
  },
  {
    id: "reader",
    title: "Ask why, then claim health",
    goal: "Read why src/index.ts changed, then add a health route on a free file.",
    agentId: "agent-reader",
    paths: ["src/health.ts"],
    symbols: [],
  },
];

const AUTO_LAND = ["rate-limit", "docs", "auth", "obs"];
const ARENA = ["flag-default", "flag-audit", "flag-default-b"];

export function runDemo(now: number): { intents: Intent[]; log: string[] } {
  const store = new LeaseStore();
  const log: string[] = [];

  for (const task of DEMO_TASKS) {
    const { intent, overlap } = store.claim(
      {
        id: task.id,
        title: task.title,
        goal: task.goal,
        agentId: task.agentId,
        surface: { paths: task.paths, symbols: task.symbols },
      },
      now,
    );
    log.push(
      overlap.length === 0
        ? `claim ${intent.id} by ${intent.agentId}`
        : `claim ${intent.id} by ${intent.agentId} overlaps ${overlap.join(" ")}`,
    );
  }

  for (const id of AUTO_LAND) {
    store.ready(id, now);
    store.land(id, now);
    log.push(`landed ${id}`);
  }

  for (const id of ARENA) store.ready(id, now);

  const intents = store.list(now);
  const arena = intents.filter((intent) => intent.contended).map((intent) => intent.id);
  log.push(`arena: ${arena.join(", ")}`);
  const why = store.why("src/index.ts").map((intent) => intent.id);
  log.push(`why src/index.ts: ${why.join(", ")}`);
  const reader = intents.find((intent) => intent.id === "reader");
  log.push(
    `reader status: ${reader?.status ?? "missing"}${reader?.contended ? " contended" : ""}`,
  );

  return { intents, log };
}
