import assert from "node:assert/strict";
import { test } from "node:test";
import { applyDiff, cleanFiles, fastImport, refName } from "../src/git.ts";

test("fast-import writes the file bytes and a commit", () => {
  const stream = fastImport([
    {
      name: "refs/heads/main",
      message: "Hello",
      author: "Casey",
      email: "casey@locus.dev",
      at: 1_700_000_000_000,
      files: [{ path: "README.md", content: "hello" }],
    },
  ]);
  assert.match(stream, /^feature done\n/);
  assert.match(stream, /data 5\nhello\n/);
  assert.match(stream, /M 100644 :1 README.md\n/);
  assert.match(stream, /committer Casey <casey@locus.dev> 1700000000 \+0000\n/);
  assert.match(stream, /done\n$/);
});

test("a unified diff updates main and rejects a mismatched hunk", () => {
  const base = [{ path: "README.md", content: "# Hi\nold\n" }];
  const created = applyDiff(base, [
    "diff --git a/notes.txt b/notes.txt",
    "new file mode 100644",
    "--- /dev/null",
    "+++ b/notes.txt",
    "@@ -0,0 +1 @@",
    "+hello",
  ].join("\n"));
  assert.equal(created.error, null);
  assert.equal(created.files.find((file) => file.path === "notes.txt")?.content, "hello\n");

  const edited = applyDiff(base, [
    "diff --git a/README.md b/README.md",
    "--- a/README.md",
    "+++ b/README.md",
    "@@ -1,2 +1,2 @@",
    " # Hi",
    "-old",
    "+new",
  ].join("\n"));
  assert.equal(edited.files.find((file) => file.path === "README.md")?.content, "# Hi\nnew\n");

  const missed = applyDiff(base, [
    "diff --git a/README.md b/README.md",
    "--- a/README.md",
    "+++ b/README.md",
    "@@ -1,2 +1,2 @@",
    " # Hi",
    "-missing",
    "+new",
  ].join("\n"));
  assert.match(missed.error ?? "", /does not apply/);
});

test("ref names and file paths stay inside the repository", () => {
  assert.equal(refName("feature"), "refs/heads/feature");
  assert.equal(refName("refs/heads/main"), "refs/heads/main");
  assert.equal(refName("refs/heads/../../etc"), "refs/heads/main");
  assert.deepEqual(
    cleanFiles([
      { path: "../secret", content: "no" },
      { path: "ok.txt", content: "yes" },
    ]),
    [{ path: "ok.txt", content: "yes" }],
  );
});
