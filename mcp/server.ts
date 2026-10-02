const base = process.env.LOCUS_URL ?? "http://127.0.0.1:8787";

async function rpc(message: unknown): Promise<unknown> {
  const response = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(message),
  });
  const body = (await response.json()) as { result?: unknown; error?: { message?: string } };
  if (!response.ok || body.error) {
    throw new Error(body.error?.message ?? `MCP request failed (${response.status})`);
  }
  return body.result;
}

const decoder = new TextDecoder();
let buffer = "";

process.stdin.on("data", (chunk: Buffer) => {
  buffer += decoder.decode(chunk);
  let newline = buffer.indexOf("\n");
  while (newline >= 0) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    newline = buffer.indexOf("\n");
    if (!line) continue;
    void handle(line);
  }
});

async function handle(line: string): Promise<void> {
  const message = JSON.parse(line) as { id?: number | string | null; method?: string };
  try {
    const result = await rpc(message);
    if (message.id === undefined || message.id === null) return;
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, result })}\n`);
  } catch (error) {
    if (message.id === undefined || message.id === null) return;
    const messageText = error instanceof Error ? error.message : "mcp failed";
    process.stdout.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { code: -32000, message: messageText } })}\n`,
    );
  }
}
