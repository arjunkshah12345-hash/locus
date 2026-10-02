#!/usr/bin/env node
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
const queueId = process.env.LOCUS_QUEUE_ID;
const namespace = process.env.LOCUS_NAMESPACE ?? "locus";

if (!account || !token || !queueId) {
  console.log(
    "Set CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, and LOCUS_QUEUE_ID to subscribe this account to Artifacts push events.",
  );
  process.exit(0);
}

const response = await fetch(
  `https://api.cloudflare.com/client/v4/accounts/${account}/event_subscriptions/subscriptions`,
  {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      name: "locus-artifacts",
      enabled: true,
      source: { type: "artifacts", namespace },
      events: ["cf.artifacts.repo.pushed", "cf.artifacts.repo.forked", "cf.artifacts.repo.deleted"],
      destination: { type: "queue", config: { queue_id: queueId } },
    }),
  },
);

const body = await response.text();
console.log(response.status);
console.log(body);
if (!response.ok) process.exit(1);
