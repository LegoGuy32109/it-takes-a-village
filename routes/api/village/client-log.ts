import { define } from "../../../utils.ts";

const MAX_BODY_BYTES = 16_384;

function getRequestIp(req: Request): string {
  return req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";
}

export const handler = define.handlers({
  async POST(ctx) {
    const body = await ctx.req.text();
    if (body.length > MAX_BODY_BYTES) {
      return new Response("Log payload too large.", { status: 413 });
    }

    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      return new Response("Invalid log payload.", { status: 400 });
    }

    console.info("[village:client]", {
      at: new Date().toISOString(),
      ip: getRequestIp(ctx.req),
      ua: ctx.req.headers.get("user-agent") ?? "unknown",
      payload,
    });

    return new Response(null, { status: 204 });
  },
});
