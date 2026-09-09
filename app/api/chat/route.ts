import { NextRequest } from "next/server";
import { embedQuery } from "@/lib/embeddings";
import { searchCodeChunks } from "@/lib/retrieval";
import { streamChatAnswer } from "@/lib/llm";
import { assertRepoAccess, AccessDeniedError } from "@/lib/access";
import { decryptToken, GH_TOKEN_COOKIE } from "@/lib/session";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const { repositoryId, question, apiKey, baseUrl, model, mode } = await req.json();
  if (!repositoryId || !question) {
    return new Response(JSON.stringify({ error: "repositoryId and question are required" }), {
      status: 400,
    });
  }
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "apiKey is required (e.g. a free Groq API key)" }), {
      status: 400,
    });
  }

  const encrypted = req.cookies.get(GH_TOKEN_COOKIE)?.value;
  const accessToken = encrypted ? decryptToken(encrypted) ?? undefined : undefined;

  try {
    await assertRepoAccess(repositoryId, accessToken);
  } catch (err) {
    const status = err instanceof AccessDeniedError ? 403 : 500;
    return new Response(JSON.stringify({ error: (err as Error).message }), { status });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );
      };

      try {
        const queryEmbedding = await embedQuery(question);
        const matches = await searchCodeChunks(repositoryId, queryEmbedding, question);

        send("citations", matches.map((m) => ({
          filePath: m.filePath,
          startLine: m.startLine,
          endLine: m.endLine,
          language: m.language,
          content: m.content,
        })));

        await streamChatAnswer(question, matches, { apiKey, baseUrl, model, mode }, (token) =>
          send("token", token)
        );
        send("done", {});
      } catch (err: any) {
        send("error", { message: err.message ?? "Chat failed" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
