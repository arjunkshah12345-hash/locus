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

A new repository starts with `README.md` on `main`. The code tab reads that tree. Merging a pull request applies its patch, or replaces `main` with the pushed branch, and the code tab shows the result.

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

Artifacts is Workers Paid only. On this account the binding deploy returns `10403` until the plan is upgraded, so a claim records a memory fork. After the upgrade, add:

```jsonc
"artifacts": [{ "binding": "ARTIFACTS", "namespace": "locus" }],
"vars": { "CANON_REPO": "canon" }
```

A claim then calls `get`, `info`, `readFile` for `AGENTS.md`, `fork`, and `createToken("write")` if the fork result has no token. The board does not store the token. Push events on `locus-artifact-events` update the matching intent and start `RefereeWorkflow`.

## Submit

Form, once, by hand: https://www.cloudflare.com/git-competition/submit/

| Field | Value |
| --- | --- |
| Team | Locus |
| Live app | https://locus.arjunkshah21.workers.dev |
| Source | https://github.com/arjunkshah12345-hash/locus |
| License | Apache-2.0 |
| Run | Open the live app, open **Storefront flags**, choose **Watch it arrive**, then **Resolve arena**. Locally: `npm install && npm test && npm run dev` |

The form also wants a 5–10 minute video. Record the live board: the swarm arriving, the three diffs on `src/flags.ts`, the synthesis that keeps `newCheckout` off, then Ask why on that file.

License: Apache-2.0.
