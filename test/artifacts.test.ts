import assert from "node:assert/strict";
import { test } from "node:test";
import { ensureCanonRepo, readForkHead, tokenString, type ArtifactsNamespace } from "../src/artifacts.ts";
import { referee, scoreFlagsSource } from "../src/referee.ts";
import { LeaseStore } from "../src/lease.ts";

test("tokenString reads create() strings and createToken() plaintext", () => {
  assert.equal(tokenString("art_v1_abc?expires=1"), "art_v1_abc?expires=1");
  assert.equal(tokenString({ plaintext: "art_v1_xyz", expiresAt: "2026-10-10T00:00:00Z" }), "art_v1_xyz");
  assert.equal(tokenString({ token: "old" }), "old");
  assert.equal(tokenString({}), null);
});

function fakeArtifacts(files: Record<string, string>, exists = true): ArtifactsNamespace {
  const handle = {
    info: async () => ({ name: "canon", defaultBranch: "main", remote: "https://acct.artifacts.cloudflare.net/git/locus/canon.git" }),
    readFile: async ({ path }: { ref: string; path: string }) => (path in files ? new Blob([files[path]]) : null),
    fork: async () => ({ name: "f", remote: "r" }),
    createToken: async () => ({ plaintext: "art_v1_write", expiresAt: "later" }),
    log: async () => [{ hash: "a".repeat(40), message: "edit" }],
  };
  return {
    get: async () => {
      if (!exists) throw new Error("not found");
      return handle;
    },
    create: async (name) => ({ name, remote: `https://acct.artifacts.cloudflare.net/git/locus/${name}.git`, defaultBranch: "main", token: "art_v1_new" }),
  };
}

test("ensureCanonRepo creates the canon once and mints a write token after", async () => {
  const created = await ensureCanonRepo(fakeArtifacts({}, false), "canon");
  assert.equal(created.created, true);
  assert.equal(created.token, "art_v1_new");
  const opened = await ensureCanonRepo(fakeArtifacts({}), "canon");
  assert.equal(opened.created, false);
  assert.equal(opened.token, "art_v1_write");
  assert.match(opened.remote, /canon\.git$/);
});

test("readForkHead returns the head hash and the pushed file text", async () => {
  const head = await readForkHead(fakeArtifacts({ "src/flags.ts": "newCheckout: true," }), "i-x", ["src/flags.ts", "missing.ts"]);
  assert.equal(head.commit, "a".repeat(40));
  assert.equal(head.files["src/flags.ts"], "newCheckout: true,");
  assert.equal(head.files["missing.ts"], null);
});

test("scoreFlagsSource fails a fork that flips newCheckout on", () => {
  const bad = scoreFlagsSource("export const DEFAULT_FLAGS = { newCheckout: true };\nexport function setFlag(n, v) {}");
  assert.equal(bad[0].passed, false);
  const good = scoreFlagsSource("export const DEFAULT_FLAGS = { newCheckout: false, stagedRollout: false };\nexport function setFlag(n, v) {}");
  assert.ok(good.every((check) => check.passed));
});

test("the referee trusts fork checks over the goal text", () => {
  const store = new LeaseStore();
  const now = Date.UTC(2026, 9, 9);
  const surface = { paths: ["src/flags.ts"], symbols: ["src/flags.ts#DEFAULT_FLAGS"] };
  // The goal sounds safe, but the pushed file flips the default.
  store.claim({ id: "flag-a", title: "a", goal: "Tidy the defaults.", agentId: "a", surface }, now);
  store.claim({ id: "flag-b", title: "b", goal: "Add a staged rollout flag.", agentId: "b", surface }, now);
  store.setChecks("flag-a", scoreFlagsSource("export const DEFAULT_FLAGS = { newCheckout: true };\nexport function setFlag() {}"));
  store.setChecks("flag-b", scoreFlagsSource("export const DEFAULT_FLAGS = { newCheckout: false, stagedRollout: false };\nexport function setFlag() {}"));
  const decision = referee(store.list(now));
  assert.equal(decision.checks["flag-a"][0].passed, false);
  assert.ok(decision.checks["flag-b"].every((check) => check.passed));
});
