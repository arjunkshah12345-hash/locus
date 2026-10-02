import { resolveArena, runDemo } from "../src/demo-script.ts";

const now = Date.now();
const open = runDemo(now);

console.log("Locus demo — eight agents, one canon\n");
for (const line of open.log) console.log(line);

console.log("\nArena");
for (const intent of open.intents) {
  const mark = intent.contended ? "contended" : intent.status;
  const preview = intent.previewUrl ? ` ${intent.previewUrl}` : "";
  console.log(`${mark.padEnd(12)} ${intent.id.padEnd(16)}${preview}`);
}

const resolved = resolveArena(open.intents, now);
console.log(`\nReferee: ${resolved.decision?.verdict ?? "none"}`);
console.log(resolved.decision?.rationale ?? "");
const winner = resolved.intents.find((intent) => intent.id === resolved.decision?.winnerId);
if (winner?.capsule) {
  console.log(`\nCanon why file ${winner.capsule.file}`);
  console.log(JSON.stringify(winner.capsule, null, 2));
}
