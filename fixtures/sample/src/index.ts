import { getFlag, setFlag } from "./flags.ts";
import { verifyToken, type Token } from "./auth.ts";

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/flags") {
      const name = url.searchParams.get("name") ?? "newCheckout";
      return Response.json({ name, value: getFlag(name) });
    }
    if (request.method === "POST" && url.pathname === "/flags") {
      const body = (await request.json()) as { name?: string; value?: boolean; token?: Token };
      if (!body.token || !verifyToken(body.token, Date.now()) || !body.name || typeof body.value !== "boolean") {
        return new Response("unauthorized", { status: 401 });
      }
      setFlag(body.name, body.value);
      return Response.json({ name: body.name, value: body.value });
    }
    return new Response("not found", { status: 404 });
  },
};
