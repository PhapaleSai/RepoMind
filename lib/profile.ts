import { getPool } from "./db";
import type { LlmConfig } from "./llm";

// Repo profile (plan.md Phase 3 diagrams + Phase 5 onboarding/complexity): a single
// LLM call over a compact repo overview (file list + README + manifest), cached on the
// repositories row since generation costs a real LLM call. Generation is BYOK, same as
// chat — the frontend triggers it automatically right after a successful ingest if a
// key is already present, falling back to a manual button otherwise (see RepoProfilePanel).

export interface RepoProfile {
  architectureDiagram: string;
  flowDiagram: string;
  /** Empty string when the repo has no clear persisted data model to diagram. */
  erDiagram: string;
  onboarding: string[];
  complexity: {
    estimateWeeks: number;
    confidence: "low" | "medium" | "high";
    breakdown: { frontend: string; backend: string; devops: string };
  };
}

const MAX_KEY_FILE_CHARS = 1_500;
const MAX_COMPLETION_TOKENS = 3_000;

async function buildOverviewContext(repositoryId: string): Promise<string> {
  const pool = getPool();

  const { rows: fileRows } = await pool.query(
    `SELECT DISTINCT file_path, language FROM code_chunks WHERE repository_id = $1 ORDER BY file_path LIMIT 200`,
    [repositoryId]
  );
  const fileList = fileRows.map((r) => `${r.file_path} (${r.language})`).join("\n");

  const { rows: keyFileRows } = await pool.query(
    `SELECT file_path, content FROM code_chunks
     WHERE repository_id = $1 AND (file_path ILIKE '%readme%' OR file_path IN ('package.json', 'requirements.txt', 'pyproject.toml', 'go.mod', 'Cargo.toml'))
     ORDER BY start_line ASC LIMIT 5`,
    [repositoryId]
  );
  const keyFiles = keyFileRows
    .map((r) => {
      const content = r.content.length > MAX_KEY_FILE_CHARS ? r.content.slice(0, MAX_KEY_FILE_CHARS) + "\n… (truncated)" : r.content;
      return `--- ${r.file_path} ---\n${content}`;
    })
    .join("\n\n");

  return `File list:\n${fileList}\n\nKey files:\n${keyFiles}`;
}

const MERMAID_SAFETY_RULE = `Mermaid syntax rules that must never be violated in any diagram field below (a
single broken diagram fails to render at all):

- Every flowchart node and every sequenceDiagram participant MUST have a short ID with NO spaces
  (e.g. FE, BE, DB, AiProvider) — this is what edges/arrows reference. NEVER write an edge between
  bare multi-word text like "Backend --> AI Provider" (invalid: "AI Provider" is not a valid node ID).
- If you want a human-readable multi-word label, attach it to the short ID:
  - flowchart: FE[Frontend App] then use "FE --> BE" for edges (the bracket label may contain spaces).
  - sequenceDiagram: "participant AI as AI Provider" then use "AI" in every message line.
- Inside any label or bracket text: no parentheses, no colons, no literal "\\n", no real line breaks.
- In an erDiagram entity block, each attribute MUST be on its own line as "type name" with NO
  semicolons and nothing else on that line — never put multiple attributes on one line.
- Keep every diagram compact: 8-10 lines of Mermaid source at most — this budget is shared with the
  other JSON fields, so an elaborate diagram risks the whole response being cut off mid-JSON.

Valid flowchart example (copy this exact pattern, just change the content):
graph TD
    FE[Frontend App] --> BE[Backend API]
    BE --> DB[Database]
    BE --> AI[AI Provider]

Valid sequenceDiagram example (copy this exact pattern, just change the content):
sequenceDiagram
    participant U as User
    participant FE as Frontend
    participant BE as Backend
    U->>FE: submit request
    FE->>BE: call API
    BE-->>FE: response
    FE-->>U: show result

Valid erDiagram example (copy this exact pattern, just change the content — one attribute per
line, no semicolons, no more than 2 attribute lines per entity):
erDiagram
    USER ||--o{ ORDER : places
    USER {
        int id
        string email
    }
    ORDER {
        int id
        int userId
    }`;

const PROFILE_SYSTEM_PROMPT = `You are RepoMind's repository analyst. Given a file list and key files (README,
package manifest) from a GitHub repository, produce a JSON object with exactly these fields.

${MERMAID_SAFETY_RULE}

{
  "architectureDiagram": "a Mermaid flowchart (graph TD) showing the high-level architecture:
              frontend/backend/database/external services/workers as nodes, edges showing data flow.
              Short node labels. Valid Mermaid syntax only, no markdown fences inside this string.",
  "flowDiagram": "a Mermaid sequenceDiagram (or graph TD if a sequence doesn't fit) walking through ONE
              concrete, important request/data flow in this repo end to end (e.g. a user request hitting
              a route, through middleware/services, to a database or external API, and back). Name real
              functions/routes/files where you can tell them from the file list. Valid Mermaid syntax only.",
  "erDiagram": "a Mermaid erDiagram showing the repo's persisted data models/tables and their relationships,
              ONLY if the file list clearly shows a database schema, ORM models, or migrations. Otherwise
              return an empty string exactly: \\"\\". Show relationships between entities, but list AT MOST
              2 attributes per entity (e.g. just id and one other key field) — this is a relationship
              diagram, not a full schema dump. Valid Mermaid syntax only when non-empty.",
  "onboarding": ["3-6 short imperative steps a new developer should follow to start understanding this repo,
                 starting with the actual entry point file"],
  "complexity": {
    "estimateWeeks": <number, realistic developer-weeks for a competent engineer to become productive>,
    "confidence": "low" | "medium" | "high",
    "breakdown": { "frontend": "<one short phrase>", "backend": "<one short phrase>", "devops": "<one short phrase>" }
  }
}

Respond with ONLY the JSON object, no prose, no markdown code fences.`;

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  return (fenced ? fenced[1] : text).trim();
}

// Defense in depth: even with an explicit example in the prompt, models occasionally cram
// multiple erDiagram attributes onto one line separated by semicolons (invalid Mermaid — each
// attribute must be its own line). Semicolons have no other valid use inside an erDiagram entity
// block, so splitting on them and re-joining with newlines is a safe, mechanical fix.
function sanitizeErDiagram(diagram: string): string {
  if (!diagram.includes(";")) return diagram;
  return diagram
    .split("\n")
    .flatMap((line) => line.split(";").map((part) => part.trimEnd()))
    .filter((line) => line.trim() !== "")
    .join("\n");
}

async function callLlmJson(context: string, config: LlmConfig): Promise<RepoProfile> {
  const baseUrl = (config.baseUrl?.replace(/\/$/, "") || "https://api.groq.com/openai/v1");
  const model = config.model || "openai/gpt-oss-120b";

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: MAX_COMPLETION_TOKENS,
      messages: [
        { role: "system", content: PROFILE_SYSTEM_PROMPT },
        { role: "user", content: context },
      ],
    }),
  });

  if (!res.ok) {
    throw new Error(`Profile generation failed: ${res.status} ${await res.text()}`);
  }

  const json = await res.json();
  const text = json.choices?.[0]?.message?.content ?? "";
  try {
    const parsed = JSON.parse(extractJson(text)) as RepoProfile;
    if (parsed.erDiagram) parsed.erDiagram = sanitizeErDiagram(parsed.erDiagram);
    return parsed;
  } catch {
    console.error("[profile] failed to parse model output, finish_reason:", json.choices?.[0]?.finish_reason, "raw:", text.slice(-500));
    throw new Error("Model did not return valid JSON for the repo profile");
  }
}

export async function getOrBuildRepoProfile(repositoryId: string, config: LlmConfig, force = false): Promise<RepoProfile> {
  const pool = getPool();

  if (!force) {
    const { rows } = await pool.query(`SELECT profile FROM repositories WHERE id = $1`, [repositoryId]);
    const cached = rows[0]?.profile as RepoProfile | undefined;
    // Cached profiles from before architectureDiagram/flowDiagram/erDiagram existed (an
    // earlier schema used a single `mermaid` field) would otherwise crash the Mermaid
    // renderer with `chart` undefined — treat a profile missing the new required field
    // as stale and regenerate instead of returning it as-is.
    if (cached?.architectureDiagram) return cached;
  }

  const context = await buildOverviewContext(repositoryId);
  const profile = await callLlmJson(context, config);

  await pool.query(`UPDATE repositories SET profile = $1 WHERE id = $2`, [JSON.stringify(profile), repositoryId]);
  return profile;
}
