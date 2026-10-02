export const PATCHES: Record<string, string> = {
  "rate-limit": `src/index.ts
+ if (tooMany(request)) return new Response("slow down", { status: 429 });`,
  "flag-default": `src/flags.ts
- newCheckout: false,
+ newCheckout: true,`,
  "flag-audit": `src/flags.ts
+ const audit: string[] = [];
  export function setFlag(name: string, value: boolean): void {
+   audit.push(name);
    DEFAULT_FLAGS[name] = value;
  }`,
  "flag-default-b": `src/flags.ts
  export const DEFAULT_FLAGS = {
    newCheckout: false,
+   stagedRollout: false,
  };`,
  docs: `README.md
+ GET /flags?name=newCheckout reads a flag.`,
  auth: `src/auth.ts
- return token.subject.length > 0;
+ return token.subject.length > 0 && token.exp > now;`,
  obs: `src/log.ts
+ export function logLine(path: string, status: number): string {
+   return path + " " + status;
+ }`,
  reader: `src/health.ts
+ return Response.json({ ok: true });`,
  "flag-synthesis": `src/flags.ts
  export const DEFAULT_FLAGS = {
    newCheckout: false,
+   stagedRollout: false,
  };
+ const audit: string[] = [];
  export function setFlag(name: string, value: boolean): void {
+   audit.push(name);
    DEFAULT_FLAGS[name] = value;
  }`,
};

export const SYNTHESIS_PATCH = PATCHES["flag-synthesis"];
