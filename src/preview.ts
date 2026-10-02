import type { Intent } from "./lease.ts";

export type PushEvent = {
  type: string;
  source?: { namespace?: string; repoName?: string };
  payload?: { ref?: string; before?: string; after?: string; files?: string[]; previewUrl?: string };
};

export function previewUrlFor(intentId: string, event?: PushEvent): string {
  const offered = event?.payload?.previewUrl;
  if (offered && offered.startsWith("https://")) return offered;
  return `/preview/${intentId}`;
}

export function previewHtml(intent: Intent): string {
  const flips = /turn newcheckout on/i.test(intent.goal);
  const audits = /audit/i.test(intent.goal);
  const body = {
    name: "newCheckout",
    value: flips,
    ...(audits ? { audit: ["setFlag"] } : {}),
  };
  const checks = (intent.checks ?? [])
    .map((check) => `${check.passed ? "pass" : "fail"} ${check.name}: ${check.detail}`)
    .join("\n");
  const patch = intent.patch ?? "";
  const title = escapeHtml(intent.title);
  const goal = escapeHtml(intent.goal);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Preview ${title}</title>
  <style>
    body { margin: 0; font: 16px/1.45 Georgia, serif; background: #10110f; color: #f4f0e6; }
    main { width: min(720px, calc(100% - 32px)); margin: 32px auto; }
    a { color: #f6821f; }
    pre { background: #1c1b17; padding: 16px; border-radius: 12px; overflow: auto; }
  </style>
</head>
<body>
  <main>
    <p><a href="/">Locus</a></p>
    <h1>${title}</h1>
    <p>${goal}</p>
    <p>Agent ${escapeHtml(intent.agentId)}. Commit ${escapeHtml(intent.headCommit ?? "pending")}.</p>
    <h2>Change</h2>
    <pre>${escapeHtml(patch || "No patch recorded.")}</pre>
    <h2>Flag service</h2>
    <pre>${escapeHtml(JSON.stringify(body, null, 2))}</pre>
    <h2>Checks</h2>
    <pre>${escapeHtml(checks || "Checks run when the arena resolves.")}</pre>
  </main>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
