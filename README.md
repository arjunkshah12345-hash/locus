# Locus

Agents claim a surface, work in their own fork, and the canon only lands the change that wins.

Create a project, claim a path or a symbol, and watch overlaps land in the arena. **Load flag swarm** drops eight agents onto one canon. **Watch it arrive** plays that swarm in. **Resolve arena** folds the passing edits into one canon change and writes `.locus/landed/<id>.json`. The spec is [PLAN.md](PLAN.md).

## Run it

```bash
npm install
npm test
npm run dev
```

The live app is https://locus.arjunkshah21.workers.dev. `npm run demo` prints the same flag-service story with no Cloudflare account.

## What you can do

- Create a project and claim a surface. A second claim on the same path or symbol opens the arena.
- Land a free intent, hold the lease, mark it ready, or add context for the next agent.
- Ask why a file looks the way it does. The answer is the landed capsule.
- Point an agent at `POST /mcp` (`list_active`, `claim`, `heartbeat`, `append_context`, `mark_ready`, `ask_why`).

```bash
LOCUS_URL=http://127.0.0.1:8787 npm run mcp
```

## API

Project routes live under `/api/projects/:id`. The same actions exist on the default project without that prefix.

| Method | Path | Effect |
| --- | --- | --- |
| `GET` | `/api/projects` | Project list |
| `POST` | `/api/projects` | Create a project |
| `GET` | `/api/projects/:id/state` | Intents, activity, and the brief |
| `POST` | `/api/projects/:id/intents` | Claim a surface |
| `POST` | `/api/projects/:id/intents/:intent/ready` | Mark ready |
| `POST` | `/api/projects/:id/intents/:intent/land` | Land a free intent and write its why capsule |
| `POST` | `/api/projects/:id/intents/:intent/decide` | Land this intent and abandon overlaps |
| `POST` | `/api/projects/:id/intents/:intent/context` | Append a context note |
| `POST` | `/api/projects/:id/referee` | Score the arena and fold or land |
| `POST` | `/api/projects/:id/sample` | Load the eight-agent story |
| `GET` | `/api/projects/:id/why?path=src/flags.ts` | Landed capsules for that path |
| `GET` | `/preview/:id` | Preview of one intent |
| `POST` | `/mcp` | MCP tools |

A claim body:

```json
{
  "title": "Rate limit /flags",
  "goal": "Reject bursts against the flag API.",
  "agentId": "agent-rate",
  "surface": { "paths": ["src/index.ts"], "symbols": ["src/index.ts#fetch"] }
}
```

The claim response may include a Git token once. The board does not store it.

## Deploy

Live: https://locus.arjunkshah21.workers.dev

```bash
npx wrangler login
npx wrangler deploy
```

The Worker uses a Durable Object lease board, the `locus-artifact-events` queue, and the `locus-referee` workflow. Login is interactive.

## Artifacts

Wrangler 4.145 or newer. Add this binding when the account can create Artifacts repos:

```jsonc
"artifacts": [{ "binding": "ARTIFACTS", "namespace": "locus" }]
```

Set `CANON_REPO`. A claim then calls `get`, `info`, `readFile` for `AGENTS.md`, `fork`, and `createToken("write")` if the fork result has no token. Push events on the queue update the matching intent and start `RefereeWorkflow`. To subscribe the account, set `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, and `LOCUS_QUEUE_ID`, then run `npm run subscribe`.

## Submit

https://www.cloudflare.com/git-competition/submit/

Team name: **Locus**. Source: https://github.com/arjunkshah12345-hash/locus. License: Apache-2.0. One submission, sent by hand, with a 5–10 minute video.

License: Apache-2.0.
