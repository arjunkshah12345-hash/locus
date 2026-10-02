# Locus

Agents claim a surface, work in their own fork, and the canon only lands the change that wins.

This is a Cloudflare Git competition entry. The full build spec is [PLAN.md](PLAN.md). The lease rules already run locally. Artifacts forks turn on when you bind a canon repo.

## Run the story

```bash
npm install
npm test
npm run demo
npm run dev
```

Open the URL Wrangler prints. Choose **Seed demo**. Eight agents claim the sample flag service in `fixtures/sample`. Three of them overlap on `src/flags.ts`. The disjoint intents are already landed. **Land this one** on a contended card lands that intent and abandons the others.

## API

| Method | Path | Effect |
| --- | --- | --- |
| `GET` | `/api/intents` | Board |
| `POST` | `/api/intents` | Claim a surface |
| `POST` | `/api/intents/:id/ready` | Mark ready |
| `POST` | `/api/intents/:id/land` | Land a free intent |
| `POST` | `/api/intents/:id/decide` | Land this intent and abandon overlaps |
| `POST` | `/api/demo/seed` | Load the eight-agent story |
| `GET` | `/api/why?path=src/index.ts` | Why that path looks the way it does |

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

## Artifacts

Add this to `wrangler.jsonc` after `npx wrangler types`, with Wrangler 4.145 or newer:

```jsonc
"artifacts": [{ "binding": "ARTIFACTS", "namespace": "locus" }]
```

Set `CANON_REPO` to the canon repository name. `POST /api/intents` then forks that repo, reads `AGENTS.md`, and returns a write token once. The token is not stored. Demo seed does not create forks.

License: Apache-2.0.
