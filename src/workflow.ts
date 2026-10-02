import { WorkflowEntrypoint } from "cloudflare:workers";
import type { Env } from "./board.ts";

type RefereeParams = { intentIds: string[] };

export class RefereeWorkflow extends WorkflowEntrypoint<Env, RefereeParams> {
  async run(
    event: { readonly payload: RefereeParams; readonly instanceId: string },
    step: { do<R>(name: string, callback: () => Promise<R>): Promise<R> },
  ): Promise<unknown> {
    return step.do("score and land", async () => {
      const id = this.env.BOARD.idFromName("locus");
      const stub = this.env.BOARD.get(id);
      const response = await stub.fetch("https://locus/referee", { method: "POST" });
      return response.json();
    });
  }
}
