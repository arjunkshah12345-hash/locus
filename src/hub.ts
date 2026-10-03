import { scoreIntent } from "./referee.ts";

export type Comment = {
  id: string;
  author: string;
  body: string;
  createdAt: number;
};

export type Issue = {
  number: number;
  title: string;
  body: string;
  author: string;
  status: "open" | "closed";
  createdAt: number;
  comments: Comment[];
};

export type Check = {
  name: string;
  status: "pass" | "fail";
  detail: string;
};

export type PullRequest = {
  number: number;
  title: string;
  body: string;
  author: string;
  status: "open" | "merged" | "closed";
  intentId: string;
  base: string;
  head: string;
  commit: string | null;
  patch: string;
  createdAt: number;
  comments: Comment[];
  checks: Check[];
};

export function pathsFromDiff(diff: string): string[] {
  const paths = new Set<string>();
  for (const line of diff.split("\n")) {
    const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (match) paths.add(match[2]);
  }
  return [...paths];
}

export function checksFor(goal: string, diff: string): Check[] {
  const scored = scoreIntent({ goal }).map((check) => ({
    name: check.name,
    status: check.passed ? "pass" as const : "fail" as const,
    detail: check.detail,
  }));
  scored.push({
    name: "diff is present",
    status: diff.trim() ? "pass" : "fail",
    detail: diff.trim() ? "The push includes a patch." : "Push a diff before this can merge.",
  });
  const conflicted = diff.includes("<<<<<<<");
  scored.push({
    name: "patch is clean",
    status: conflicted ? "fail" : "pass",
    detail: conflicted ? "The patch still has conflict markers." : "No conflict markers.",
  });
  if (/newCheckout\s*[:=]\s*true/.test(diff)) {
    const canon = scored.find((check) => check.name === "canon default stays off");
    if (canon) {
      canon.status = "fail";
      canon.detail = "The patch turns newCheckout on.";
    }
  }
  return scored;
}

export function nextNumber(items: { number: number }[]): number {
  return items.reduce((max, item) => Math.max(max, item.number), 0) + 1;
}

export function addComment(comments: Comment[], author: string, body: string, now: number): Comment {
  const comment = { id: crypto.randomUUID(), author, body, createdAt: now };
  comments.push(comment);
  return comment;
}
