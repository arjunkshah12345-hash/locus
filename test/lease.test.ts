import assert from "node:assert/strict";
import { test } from "node:test";
import { LEASE_TTL_MS, LeaseError, LeaseStore } from "../src/lease.ts";
import { runDemo } from "../src/demo-script.ts";

const now = Date.UTC(2026, 9, 2);

function claim(
  store: LeaseStore,
  id: string,
  paths: string[],
  symbols: string[] = [],
) {
  return store.claim(
    {
      id,
      title: id,
      goal: id,
      agentId: `agent-${id}`,
      surface: { paths, symbols },
    },
    now,
  );
}

test("disjoint claims stay free and can land", () => {
  const store = new LeaseStore();
  claim(store, "rate", ["src/index.ts"]);
  claim(store, "auth", ["src/auth.ts"]);
  store.ready("rate", now);
  const landed = store.land("rate", now);
  assert.equal(landed.status, "landed");
  assert.equal(landed.contended, false);
  const auth = store.list(now).find((intent) => intent.id === "auth");
  assert.equal(auth?.status, "active");
  assert.equal(auth?.contended, false);
});

test("shared paths and shared symbols both contend", () => {
  const store = new LeaseStore();
  claim(store, "a", ["src/flags.ts"], ["src/flags.ts#DEFAULT_FLAGS"]);
  claim(store, "b", ["src/flags.ts"], ["src/flags.ts#setFlag"]);
  claim(store, "c", ["other.ts"], ["src/flags.ts#DEFAULT_FLAGS"]);
  const intents = store.list(now);
  for (const id of ["a", "b", "c"]) {
    const intent = intents.find((item) => item.id === id);
    assert.equal(intent?.contended, true, id);
  }
  assert.deepEqual(intents.find((item) => item.id === "a")?.conflicts.sort(), ["b", "c"]);
});

test("land refuses a contended intent and decide abandons the losers", () => {
  const store = new LeaseStore();
  claim(store, "flag-default", ["src/flags.ts"]);
  claim(store, "flag-audit", ["src/flags.ts"]);
  store.ready("flag-default", now);
  assert.throws(() => store.land("flag-default", now), (error: unknown) => {
    return error instanceof LeaseError && error.code === "contended";
  });
  const { winner, abandoned } = store.decide("flag-default", now);
  assert.equal(winner.status, "landed");
  assert.deepEqual(abandoned, ["flag-audit"]);
  const loser = store.list(now).find((intent) => intent.id === "flag-audit");
  assert.equal(loser?.status, "abandoned");
  assert.equal(loser?.abandonedReason, "lost to flag-default");
  assert.deepEqual(
    store.why("src/flags.ts").map((intent) => intent.id),
    ["flag-default"],
  );
});

test("a missed heartbeat abandons the lease on the next read", () => {
  const store = new LeaseStore();
  claim(store, "rate", ["src/index.ts"]);
  store.heartbeat("rate", now + 1000);
  const live = store.list(now + 1000).find((intent) => intent.id === "rate");
  assert.equal(live?.expiresAt, now + 1000 + LEASE_TTL_MS);
  const dead = store.list(now + 1000 + LEASE_TTL_MS + 1).find((intent) => intent.id === "rate");
  assert.equal(dead?.status, "abandoned");
  assert.equal(dead?.abandonedReason, "lease expired");
});

test("the demo lands disjoint work and parks the flag arena", () => {
  const { intents, log } = runDemo(now);
  const byId = new Map(intents.map((intent) => [intent.id, intent]));
  for (const id of ["rate-limit", "docs", "auth", "obs"]) {
    assert.equal(byId.get(id)?.status, "landed", id);
  }
  for (const id of ["flag-default", "flag-audit", "flag-default-b"]) {
    assert.equal(byId.get(id)?.status, "ready", id);
    assert.equal(byId.get(id)?.contended, true, id);
  }
  assert.equal(byId.get("reader")?.status, "active");
  assert.equal(byId.get("reader")?.contended, false);
  assert.match(log.join("\n"), /arena: flag-default, flag-audit, flag-default-b/);
  assert.match(log.join("\n"), /why src\/index.ts: rate-limit/);
});
