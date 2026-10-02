import { runDemo } from "../src/demo-script.ts";

const { intents, log } = runDemo(Date.now());

console.log("Locus demo — eight agents, one canon\n");
for (const line of log) console.log(line);

console.log("\nBoard");
for (const intent of intents) {
  const mark = intent.contended ? "contended" : intent.status;
  const conflicts = intent.conflicts.length ? ` overlaps ${intent.conflicts.join(", ")}` : "";
  console.log(`${mark.padEnd(12)} ${intent.id.padEnd(16)} ${intent.agentId}${conflicts}`);
}
