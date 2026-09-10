import { NextRequest } from "next/server";
import { parsePrUrl, buildPrContext } from "@/lib/pr";
import { streamPrExplanation } from "@/lib/llm";
import { decryptToken, GH_TOKEN_COOKIE } from "@/lib/session";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const { prUrl, apiKey, baseUrl, model } = await req.json();
  if (!prUrl || !apiKey) {
    return new Response(JSON.stringify({ error: "prUrl and apiKey are required" }), { status: 400 });
  }

  const encrypted = req.cookies.get(GH_TOKEN_COOKIE)?.value;
  const accessToken = encrypted ? decryptToken(encrypted) ?? undefined : undefined;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      try {
        const ref = parsePrUrl(prUrl);
        const context = await buildPrContext(ref, accessToken);
        await streamPrExplanation(context, { apiKey, baseUrl, model }, (token) => send("token", token));
        send("done", {});
      } catch (err: any) {
        send("error", { message: err.message ?? "PR explanation failed" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
}
