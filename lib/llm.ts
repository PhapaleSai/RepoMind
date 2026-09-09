import type { CodeChunkMatch } from "./retrieval";

// Chat is bring-your-own-key: the user pastes their own API key in the UI (never
// persisted server-side) so RepoMind itself incurs no LLM cost. Groq is the
// suggested default because it has a genuinely free tier and an OpenAI-compatible
// chat completions API, but any OpenAI-compatible endpoint works.
const DEFAULT_BASE_URL = "https://api.groq.com/openai/v1";
const DEFAULT_MODEL = "openai/gpt-oss-120b";

// Groq's free/on-demand tier caps openai/gpt-oss-120b at 8000 tokens/minute — prompt +
// completion combined. A handful of ~120-line code chunks plus the system prompt can
// exceed that on a real repo (observed: 10821 requested vs 8000 limit), so context is
// capped by characters (~4 chars/token is a safe rough estimate) and completions get an
// explicit, modest max_tokens budget instead of the provider's (often much larger) default.
const MAX_CONTEXT_CHARS = 9_000;
const MAX_COMPLETION_TOKENS = 900;

function truncateChunk(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;
  return content.slice(0, maxChars) + "\n… (truncated)";
}

function buildContext(matches: CodeChunkMatch[]): string {
  const perChunkBudget = Math.max(300, Math.floor(MAX_CONTEXT_CHARS / Math.max(matches.length, 1)));
  return matches
    .map(
      (m, i) =>
        `[${i + 1}] ${m.filePath}#L${m.startLine}-L${m.endLine}\n\`\`\`${m.language}\n${truncateChunk(m.content, perChunkBudget)}\n\`\`\``
    )
    .join("\n\n");
}

// Multi-persona explainer (plan.md Enhancement #5): same retrieved context, different
// framing depending on who's asking. Citation rules stay identical across modes so the
// UI's [n] -> chip linking always works regardless of persona.
export type ExplainerMode = "technical" | "beginner" | "analogy";

const CITATION_RULE = `Answer only using the provided code context. When you reference behavior, cite the source using
the bracketed numbers from the context (e.g. "[1]"), which map to file:line ranges the UI will
render as links. If the context doesn't contain the answer, say so plainly instead of guessing.`;

const BREVITY_RULE = `Match your answer length to the question's scope — use judgment, not a fixed rule:
- A narrow, specific question ("where is X defined", "what does function Y do") gets a short answer:
  2-4 bullet points, straight to the point.
- A broad, open-ended request to understand the codebase as a whole ("help me understand this code",
  "explain this repo", "give me an overview", "walk me through how this works") gets a fuller structured
  answer covering the key pieces (entry point, main components, how they connect) — one bullet point per
  component/piece, still scannable, not padded, but don't cut it artificially short just to be brief.

Formatting rules, always:
- ALWAYS answer as a markdown bullet list ("- " items), never a wall-of-text paragraph. Never use a
  markdown table.
- Every bullet point MUST start on its own line — put a real line break before each "- ", never chain
  multiple points after each other on the same line.
- Start each bullet with exactly one relevant emoji (e.g. 🗄️ database, ⚙️ backend/service, 🌐
  API/webhook, 🚀 deploy/CI, 🔐 auth/security, 📦 build/package, 🔗 integration/connection) that fits
  that point's topic, then a short bold label, then a dash, then the explanation — e.g.
  "- 🗄️ **Database** – stores user records in Postgres [1]."
- Keep each bullet to one short sentence. Do not add a closing summary or restatement ("In short...",
  "In summary...") — stop right after your last point.`;

const SYSTEM_PROMPTS: Record<ExplainerMode, string> = {
  technical: `You are RepoMind, an assistant that explains a specific GitHub repository to an experienced
software engineer. Use precise technical vocabulary: exact route/function/class names, design patterns,
architectural terms. Don't oversimplify. ${BREVITY_RULE} ${CITATION_RULE}`,
  beginner: `You are RepoMind, an assistant that explains a specific GitHub repository to someone new to
programming. Use short sentences and plain language. Define any technical term the first time you use it,
in a few words, inline. Prefer concrete examples over abstract description. ${BREVITY_RULE} ${CITATION_RULE}`,
  analogy: `You are RepoMind, an assistant that explains a specific GitHub repository using a real-world
analogy (pick whichever fits best: a restaurant kitchen, an airport, city planning, or traffic control).
Map the repo's actual components (routes, services, queues, databases) onto roles in that analogy, then
briefly connect the analogy back to the real code. Don't let the analogy replace precision — still name
the actual files/functions involved. ${BREVITY_RULE} ${CITATION_RULE}`,
};

export interface LlmConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  mode?: ExplainerMode;
}

async function callChatCompletions(
  baseUrl: string,
  model: string,
  systemPrompt: string,
  userMessage: string,
  apiKey: string,
  onToken: (text: string) => void
): Promise<Response> {
  return fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      stream: true,
      max_tokens: MAX_COMPLETION_TOKENS,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
    }),
  });
}

async function streamResponseBody(res: Response, onToken: (text: string) => void): Promise<void> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice("data:".length).trim();
      if (payload === "[DONE]") return;
      try {
        const json = JSON.parse(payload);
        const token = json.choices?.[0]?.delta?.content;
        if (token) onToken(token);
      } catch {
        // ignore malformed SSE fragments (e.g. split across chunks)
      }
    }
  }
}

export async function streamChatAnswer(
  question: string,
  matches: CodeChunkMatch[],
  config: LlmConfig,
  onToken: (text: string) => void
): Promise<void> {
  const baseUrl = config.baseUrl?.replace(/\/$/, "") || DEFAULT_BASE_URL;
  const model = config.model || DEFAULT_MODEL;
  const systemPrompt = SYSTEM_PROMPTS[config.mode ?? "technical"];

  // If the provider still rejects the request as too large (a tighter TPM limit than we
  // assumed, or a longer question), retry once with half as many chunks before giving up —
  // better than failing outright on a request that was only modestly over budget.
  for (const chunkSet of [matches, matches.slice(0, Math.ceil(matches.length / 2))]) {
    const context = buildContext(chunkSet);
    const userMessage = `Repository context:\n\n${context}\n\nQuestion: ${question}`;
    const res = await callChatCompletions(baseUrl, model, systemPrompt, userMessage, config.apiKey, onToken);

    if (res.ok && res.body) {
      return streamResponseBody(res, onToken);
    }
    if (res.status !== 413 || chunkSet.length <= 1) {
      throw new Error(`LLM request failed: ${res.status} ${await res.text()}`);
    }
  }
}
