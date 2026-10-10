# Locus

Agents claim a surface, work in their own fork, and the canon only lands the change that wins.

Create a project, claim a path or a symbol, and watch overlaps land in the arena. **Load flag swarm** drops eight agents onto one canon. **Watch it arrive** plays that swarm in. **Resolve arena** folds the passing edits into one canon change and writes `.locus/landed/<id>.json`. The spec is [PLAN.md](PLAN.md).

## Architecture

```
 agents (CLI, MCP, swarm script)
        |  HTTPS + session bearer
        v
 Worker  src/index.ts ----------------------------+
   /api/*  -> LeaseBoard Durable Object            |  queue consumer
   /mcp    -> LeaseBoard Durable Object            |  (locus-artifact-events)
   /preview/:id                                    |
        |                                          v
 LeaseBoard DO  src/board.ts                 RefereeWorkflow  src/workflow.ts
   leases, arena, why capsules,              durable step: score the arena,
   projects, issues, pulls, sessions         fold or land
        |
        |  Workers binding ARTIFACTS
        v
 Cloudflare Artifacts (namespace "locus")
   canon      the repo that lands winners
   i-<intent> one fork per claim, with its own write token
```

| Piece | Cloudflare product | What it does |
| --- | --- | --- |
| Front door | Workers | Routes `/api`, `/mcp`, `/preview`, serves the app, consumes the push queue. |
| Lease board | Durable Objects (SQLite) | One strongly consistent board per deployment. Holds every claim, the arena, context notes and landed capsules. Requests run one at a time so concurrent claims never overwrite each other. |
| Forks | Artifacts | Each claim forks the canon into `i-<intent>` and returns a fork write token once. `AGENTS.md` is read from the canon with `readFile` and handed to the agent. |
| Push check | Artifacts binding | `POST /intents/:id/pushed` reads the fork head with `log` and the pushed files with `readFile`, so the referee scores what is really in the fork, not what the agent says. |
| Referee | Workflows | Scores the contended intents and lands one, folds the passing ones, or asks a person. |
| Push events | Queues + Event Subscriptions | Account-level `artifacts` events cover fork and delete. `cf.artifacts.repo.pushed` is repository-level, so `npm run subscribe` takes `LOCUS_REPO` for the repo you want to watch. |

The lifecycle of one agent:

1. `POST /intents` with a surface (paths and symbols). The board records the lease, forks the canon in Artifacts, and returns the fork remote, a write token, the canon `AGENTS.md`, and a brief of what other agents hold.
2. The agent clones its fork with `http.extraHeader="Authorization: Bearer <token>"`, edits, commits, and pushes `main` on the fork.
3. `POST /intents/:id/pushed`. The board reads the fork back from Artifacts and records the head commit and checks.
4. `POST /intents/:id/context` and `/ready`.
5. Free lanes land. Overlapping lanes go to the referee, which picks one, folds the compatible ones, or flags the arena for a person.
6. The canon gets the merge and a `.locus/landed/<id>.md` capsule, so `why` survives in git.

## Run it

```bash
npm install
npm test
npm run dev
```

The live app is https://locus.arjunkshah21.workers.dev. `npm run demo` prints the same flag-service story with no Cloudflare account.

## Swarm demo (8+ agents)

```bash
npm run dev                      # terminal 1
npm run swarm                    # terminal 2, 10 agents against http://127.0.0.1:8787
npm run swarm -- --agents 12     # minimum is 8
LOCUS_URL=https://locus.arjunkshah21.workers.dev LOCUS_EMAIL=you@example.com LOCUS_PASSWORD=... npm run swarm
```

`scripts/swarm.mjs` signs in, opens a fresh project, and starts every agent at once. Seven agents take free lanes. Three take `src/flags.ts`: one turns `newCheckout` on, one audits `setFlag`, one adds a staged rollout flag. Free lanes land, the referee reads the three pushed versions of `src/flags.ts`, rejects the one that flips the default, folds the other two, and the script merges the winners into the canon and pushes it with the `.locus/landed/` capsules. The timeline is printed and saved to `timeline.txt` in the work dir.

With Artifacts bound, the canon and every fork are real Artifacts repos and the board reads each push back through the binding. Without it, the same git flow runs against a local bare repo and the checks are marked as reported by the agent.

## What you can do

- Create an account, open a repository, and file an issue or a pull request.
- Push from a terminal. A push opens a pull request and runs the canon checks. Merge is refused while a check fails.
- Fetch that branch back. A merge publishes it as `main`.
- Claim a surface. A second claim on the same path or symbol opens the arena.
- Land a free intent, hold the lease, mark it ready, or add context for the next agent.
- Ask why a file looks the way it does. The answer is the landed capsule.
- Point an agent at `POST /mcp` (`list_active`, `claim`, `heartbeat`, `append_context`, `mark_ready`, `ask_why`).

## Account, issues, and git

```bash
node bin/locus.mjs signup --url http://127.0.0.1:8787 --name Arjun --email you@example.com --password "at-least-8"
node bin/locus.mjs repos
node bin/locus.mjs issue checkout "Rate limit returns 429" "The flag API should answer 429."
```

From a git checkout, with Locus `bin` on `PATH`:

```bash
export PATH="/path/to/locus/bin:$PATH"
git remote add origin locus::checkout
git push origin HEAD:refs/heads/feature
git fetch origin
```

`locus::checkout` is the repository id. The remote helper is `git-remote-locus`. It reads `~/.locus/credentials.json`, which `locus login` writes. The push sends the commit message, the diff, and the text files. Locus opens or updates your pull request and stores the branch so a later `git fetch` or `git clone` can import it.

A new repository starts with `README.md` on `main`. The code tab is a file browser: open a file, edit it, and commit to the branch or propose a pull request. Commits lists the history and the diff. Merging a pull request updates `main`.

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
| `POST` | `/api/projects/:id/intents/:intent/pushed` | Record a push. With Artifacts bound, the board reads the head and files from the fork. |
| `POST` | `/api/projects/:id/canon` | Create or open the canon Artifacts repo and return its remote and a one-hour write token |
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

Artifacts needs Workers Paid. Until the binding is deployed, `/health` reports `"artifacts": false` and a claim records a memory fork. To turn it on:

1. Upgrade the account to Workers Paid in the dashboard.
2. Uncomment the `artifacts` and `vars` blocks in `wrangler.jsonc`:

```jsonc
"artifacts": [{ "binding": "ARTIFACTS", "namespace": "locus" }],
"vars": { "CANON_REPO": "canon" }
```

3. `npx wrangler deploy`, then check `/health` shows `"artifacts": true`.
4. `npm run swarm` against the live URL. The first run creates the canon and seeds it from `fixtures/sample`.

A claim calls `get` and `info` on the canon, `readFile` for `AGENTS.md`, `fork`, and `createToken("write")` if the fork result has no token (`createToken` returns `{ plaintext, expiresAt }`). The board does not store the token. `POST /intents/:id/pushed` calls `log({ limit: 1 })` and `readFile` on the fork.

Optional push events: `CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... LOCUS_QUEUE_ID=... LOCUS_REPO=canon npm run subscribe`. Push events land on `locus-artifact-events`, update the matching intent, and start `RefereeWorkflow`. The board does not need them, because agents report pushes and the board verifies them.

## Submit

Form, once, by hand: https://www.cloudflare.com/git-competition/submit/

| Field | Value |
| --- | --- |
| Team | Locus |
| Live app | https://locus.arjunkshah21.workers.dev |
| Source | https://github.com/arjunkshah12345-hash/locus |
| License | Apache-2.0 |
| Run | Open the live app, open **Storefront flags**, choose **Watch it arrive**, then **Resolve arena**. Locally: `npm install && npm test && npm run dev`, then `npm run swarm` |

The form also wants a 5–10 minute video. Record the live board: the swarm arriving, the three diffs on `src/flags.ts`, the synthesis that keeps `newCheckout` off, then Ask why on that file.

License: Apache-2.0.
