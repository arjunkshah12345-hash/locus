import { LeaseStore, type Surface } from "./lease.ts";

export type ToolCall = {
  name: string;
  arguments?: Record<string, unknown>;
};

export const TOOLS = [
  {
    name: "list_active",
    description: "List intents that still hold a lease, with their goals and surfaces.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "claim",
    description: "Claim a surface. Returns the fork remote, a brief, and any overlap. The write token is issued once by the worker and is not stored.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        title: { type: "string" },
        goal: { type: "string" },
        agentId: { type: "string" },
        paths: { type: "array", items: { type: "string" } },
        symbols: { type: "array", items: { type: "string" } },
      },
      required: ["title", "goal", "agentId"],
    },
  },
  {
    name: "heartbeat",
    description: "Extend the lease on an intent you hold.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "append_context",
    description: "Record why you are changing the fork. This becomes part of the intent context.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" }, note: { type: "string" } },
      required: ["id", "note"],
    },
  },
  {
    name: "mark_ready",
    description: "Mark an intent ready for landing. Overlaps open the arena.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "ask_why",
    description: "Read the landed capsule for a path, plus the current brief.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
  },
];

function surface(args: Record<string, unknown>): Surface {
  const paths = Array.isArray(args.paths) ? args.paths.filter((item) => typeof item === "string") : [];
  const symbols = Array.isArray(args.symbols)
    ? args.symbols.filter((item) => typeof item === "string")
    : [];
  return { paths, symbols };
}

export function callTool(store: LeaseStore, call: ToolCall, now: number): unknown {
  const args = call.arguments ?? {};
  if (call.name === "list_active") {
    return {
      intents: store.list(now).filter((intent) => intent.status === "active" || intent.status === "ready"),
    };
  }
  if (call.name === "claim") {
    const title = args.title;
    const goal = args.goal;
    const agentId = args.agentId;
    if (typeof title !== "string" || typeof goal !== "string" || typeof agentId !== "string") {
      throw new Error("claim requires title, goal, and agentId");
    }
    const claimed = store.claim(
      {
        id: typeof args.id === "string" ? args.id : crypto.randomUUID(),
        title,
        goal,
        agentId,
        surface: surface(args),
      },
      now,
    );
    const repo = `i-${claimed.intent.id}`.slice(0, 63);
    store.attachFork(claimed.intent.id, { forkRepo: repo, remote: `memory://locus/${repo}` });
    store.notePush(repo, "pending", claimed.intent.surface.paths);
    return {
      intent: store.get(claimed.intent.id),
      overlap: claimed.overlap,
      brief: store.brief(now),
    };
  }
  if (call.name === "heartbeat") {
    if (typeof args.id !== "string") throw new Error("heartbeat requires id");
    return { intent: store.heartbeat(args.id, now) };
  }
  if (call.name === "append_context") {
    if (typeof args.id !== "string" || typeof args.note !== "string") {
      throw new Error("append_context requires id and note");
    }
    return { intent: store.appendContext(args.id, args.note, now) };
  }
  if (call.name === "mark_ready") {
    if (typeof args.id !== "string") throw new Error("mark_ready requires id");
    return { intent: store.ready(args.id, now) };
  }
  if (call.name === "ask_why") {
    if (typeof args.path !== "string") throw new Error("ask_why requires path");
    return { path: args.path, intents: store.why(args.path), brief: store.brief(now) };
  }
  throw new Error(`Unknown tool ${call.name}`);
}

export type McpMessage = {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: { name?: string; arguments?: Record<string, unknown> };
};

export function handleMcp(store: LeaseStore, message: McpMessage, now: number): unknown {
  if (message.method === "initialize") {
    return {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "locus", version: "0.1.0" },
    };
  }
  if (message.method === "tools/list") return { tools: TOOLS };
  if (message.method === "tools/call") {
    const name = message.params?.name;
    if (!name) throw new Error("tools/call requires a name");
    const result = callTool(store, { name, arguments: message.params?.arguments }, now);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
  if (message.method === "notifications/initialized" || message.method === "ping") return {};
  throw new Error(`Unsupported MCP method ${message.method ?? ""}`);
}
