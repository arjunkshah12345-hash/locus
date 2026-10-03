import assert from "node:assert/strict";
import { test } from "node:test";
import { hashPassword, verifyPassword } from "../src/accounts.ts";
import { checksFor, nextNumber, pathsFromDiff } from "../src/hub.ts";

test("passwords round-trip and reject a wrong password", async () => {
  const stored = await hashPassword("correct-horse");
  assert.equal(await verifyPassword("correct-horse", stored.salt, stored.hash), true);
  assert.equal(await verifyPassword("wrong-horse", stored.salt, stored.hash), false);
});

test("a unified diff names the destination paths", () => {
  const diff = [
    "diff --git a/src/flags.ts b/src/flags.ts",
    "--- a/src/flags.ts",
    "+++ b/src/flags.ts",
    "diff --git a/README.md b/docs/flags.md",
  ].join("\n");
  assert.deepEqual(pathsFromDiff(diff), ["src/flags.ts", "docs/flags.md"]);
});

test("checks fail a goal that flips the canon default and an empty diff", () => {
  const checks = checksFor("Turn newCheckout on", "");
  assert.equal(checks.find((check) => check.name === "canon default stays off")?.status, "fail");
  assert.equal(checks.find((check) => check.name === "diff is present")?.status, "fail");
  assert.equal(checks.find((check) => check.name === "patch is clean")?.status, "pass");
  const flipped = checksFor("Keep the default", "diff --git a/src/flags.ts b/src/flags.ts\n+newCheckout = true\n");
  assert.equal(flipped.find((check) => check.name === "canon default stays off")?.status, "fail");
  const conflicted = checksFor("Keep the default", "<<<<<<< HEAD\n");
  assert.equal(conflicted.find((check) => check.name === "patch is clean")?.status, "fail");
  assert.equal(nextNumber([{ number: 2 }, { number: 7 }]), 8);
});
