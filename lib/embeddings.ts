// Cohere embed-english-v3.0: free trial key, no credit card required, 1024 dims
// (matches the vector(1024) column in the schema). Used server-side only, since
// embeddings never go through the user-facing BYOK chat path.
//
// Tried first: Groq (no embedding models at all — a bad web-search result, not a real
// Groq feature) and Gemini (gemini-embedding-001 works technically, but new/free Google
// Cloud projects can get hit with a blanket "project has been denied access" 403 that
// has nothing to do with API keys or code — a real account-gating issue in some regions).
const EMBEDDING_MODEL = "embed-english-v3.0";

// Cohere trial keys are capped at 100k tokens/minute account-wide. A 120-line code chunk
// is roughly 1-2k tokens, so a large batch can blow the per-minute budget in one request.
// Small batches + a spacing delay + retry-with-backoff on 429 keeps ingestion reliable
// instead of failing outright partway through a repo.
const BATCH_SIZE = 16;
const BATCH_DELAY_MS = 1200;
const MAX_RETRIES = 5;
const RETRY_BASE_DELAY_MS = 8000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function embedBatch(
  apiKey: string,
  batch: string[],
  inputType: EmbeddingInputType
): Promise<number[][]> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch("https://api.cohere.com/v2/embed", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        texts: batch,
        input_type: inputType,
        embedding_types: ["float"],
      }),
    });

    if (res.status === 429 && attempt < MAX_RETRIES) {
      await sleep(RETRY_BASE_DELAY_MS * (attempt + 1));
      continue;
    }
    if (!res.ok) {
      throw new Error(`Cohere embeddings failed: ${res.status} ${await res.text()}`);
    }
    const json = await res.json();
    return json.embeddings.float;
  }
  throw new Error("Cohere embeddings failed: exhausted retries after repeated 429s");
}

export type EmbeddingInputType = "search_document" | "search_query";

export async function embedTexts(
  texts: string[],
  inputType: EmbeddingInputType = "search_document"
): Promise<number[][]> {
  const apiKey = process.env.COHERE_API_KEY;
  if (!apiKey) {
    throw new Error("COHERE_API_KEY is not set (needed for embeddings)");
  }

  const results: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const embeddings = await embedBatch(apiKey, batch, inputType);
    results.push(...embeddings);
    if (i + BATCH_SIZE < texts.length) {
      await sleep(BATCH_DELAY_MS);
    }
  }
  return results;
}

// Chunks stored at ingestion time are "search_document"; a chat question is "search_query" —
// Cohere v3 models embed these asymmetrically, so using the wrong type hurts retrieval quality.
export async function embedQuery(text: string): Promise<number[]> {
  const [embedding] = await embedTexts([text], "search_query");
  return embedding;
}
