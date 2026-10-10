#!/usr/bin/env node
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
const queueId = process.env.LOCUS_QUEUE_ID;
const namespace = process.env.LOCUS_NAMESPACE ?? "locus";
// Optional: a single repo to watch for pushes (for example the canon).
const repoName = process.env.LOCUS_REPO;

// Artifacts account-level events cover created, deleted, forked and imported.
// cf.artifacts.repo.pushed is repository-level only, so it needs one
// subscription per repo. Agents also call POST /intents/:id/pushed, which reads
// the fork head back through the Workers binding, so the board does not depend
// on push events arriving.

if (!account || !token || !queueId) {
  console.log(
    "Set CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, and LOCUS_QUEUE_ID to subscribe this account to Artifacts push events.",
  );
  process.exit(0);
}

async function subscribe(name, source, events) {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}/event_subscriptions/subscriptions`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name,
        enabled: true,
        source,
        events,
        destination: { type: "queue", config: { queue_id: queueId } },
      }),
    },
  );
  console.log(name, response.status, await response.text());
  return response.ok;
}

let ok = await subscribe(
  "locus-artifacts",
  { type: "artifacts", namespace },
  ["cf.artifacts.repo.forked", "cf.artifacts.repo.deleted"],
);
if (repoName) {
  ok = (await subscribe(
    `locus-push-${repoName}`.slice(0, 60),
    { type: "artifacts.repo", namespace, repo_name: repoName },
    ["cf.artifacts.repo.pushed"],
  )) && ok;
}
if (!ok) process.exit(1);
