import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanFiles, fastImport, refName } from "../src/git.ts";

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
