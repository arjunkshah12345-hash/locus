declare module "cloudflare:workers" {
  export abstract class WorkflowEntrypoint<Env = unknown, T = unknown> {
    protected env: Env;
    constructor(ctx: ExecutionContext, env: Env);
    run(
      event: { readonly payload: T; readonly instanceId: string },
      step: { do<R>(name: string, callback: () => Promise<R>): Promise<R> },
    ): Promise<unknown>;
  }
}
