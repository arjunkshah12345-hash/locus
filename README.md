# Locus

Agents claim a surface, work in their own fork, and the canon only lands the change that wins.

This is the Cloudflare Git competition entry. The spec is [PLAN.md](PLAN.md). The sample canon the agents edit is [fixtures/sample](fixtures/sample).

## Run it

```bash
npm install
npm test
npm run demo
npm run dev
```

Open the URL Wrangler prints.

1. **Seed demo.** Eight agents claim the flag service. Four disjoint intents land and write a why file. Three overlap on `src/flags.ts`. The reader asks why `src/index.ts` changed, sees the flag file is leased, and claims `src/health.ts` instead.
2. Open a **Preview** link. It shows what that fork would do to `GET /flags`.
3. **Resolve arena.** The referee keeps the canon default off, folds the audit and the staged rollout together, and abandons the change that flips the default. The winner's why file is `.locus/landed/flag-synthesis.json`.

`npm run demo` prints the same story with no Cloudflare account.

## API

| Method | Path | Effect |
| --- | --- | --- |
| `GET` | `/api/intents` | Board |
| `POST` | `/api/intents` | Claim a surface. Forks the canon when Artifacts is bound. Otherwise it records a memory fork. |
| `POST` | `/api/intents/:id/ready` | Mark ready |
| `POST` | `/api/intents/:id/land` | Land a free intent and write its why capsule |
| `POST` | `/api/intents/:id/decide` | Land this intent and abandon overlaps |
| `POST` | `/api/referee` | Score the arena and fold or land |
| `POST` | `/api/events` | Accept `cf.artifacts.repo.pushed` |
| `POST` | `/api/demo/seed` | Load the eight-agent story |
| `GET` | `/api/why?path=src/index.ts` | Landed capsules for that path |
| `GET` | `/preview/:id` | Preview of one intent |
| `POST` | `/mcp` | MCP tools: `list_active`, `claim`, `heartbeat`, `append_context`, `mark_ready`, `ask_why` |

Point a stdio MCP client at the local worker:

```bash
LOCUS_URL=http://127.0.0.1:8787 npm run mcp
```

A claim body:

```json
{
  "id": "rate-limit",
  "title": "Rate limit /flags",
  "goal": "Reject bursts against the flag API.",
  "agentId": "agent-rate",
  "surface": { "paths": ["src/index.ts"], "symbols": ["src/index.ts#fetch"] }
}
```

The claim response may include a Git token once. The board does not store it.

## Artifacts

Wrangler 4.145 or newer. Add the binding next to the queue and workflow already in `wrangler.jsonc`:

```jsonc
"artifacts": [{ "binding": "ARTIFACTS", "namespace": "locus" }]
```

Set `CANON_REPO` to the canon repository name. A claim then calls `get`, `info`, `readFile` for `AGENTS.md`, `fork`, and `createToken("write")` if the fork result has no token.

Push events land on the `locus-artifact-events` queue. The consumer notes the commit, sets the preview URL, and starts `RefereeWorkflow`. Without the workflow binding it runs the referee in the same turn.

To subscribe the account, set `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, and `LOCUS_QUEUE_ID`, then run `npm run subscribe`.

Workers Builds preview URLs are accepted on the push payload as `payload.previewUrl` when they are `https` URLs. Otherwise the card links to `/preview/:id`.

## Submit

Form: https://www.cloudflare.com/git-competition/submit/

Team name: **Locus**. Source: https://github.com/arjunkshah12345-hash/locus. License: Apache-2.0. Send one 5–10 minute video and these run instructions. The official rules void a scripted or second entry, so submit the form once, by hand.

License: Apache-2.0.
