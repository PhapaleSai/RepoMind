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
const MAX_COMPLETION_TOKENS = 2_200;

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
single broken diagram fails to render at all): node/participant labels must be plain alphanumeric text and
spaces ONLY — no parentheses, no colons, no literal "\\n" or real line breaks inside a label, no slashes.
Keep every label to 1-3 words. If a label needs a line break, split it into two connected nodes instead.
Keep every diagram compact: 8-10 lines of Mermaid source at most. This is a strict budget shared with the
other JSON fields — a long, elaborate diagram risks the whole response being cut off mid-JSON.`;

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
              return an empty string exactly: \\"\\". Valid Mermaid syntax only when non-empty.",
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
    return JSON.parse(extractJson(text));
  } catch {
    console.error("[profile] failed to parse model output, finish_reason:", json.choices?.[0]?.finish_reason, "raw:", text.slice(-500));
    throw new Error("Model did not return valid JSON for the repo profile");
  }
}

export async function getOrBuildRepoProfile(repositoryId: string, config: LlmConfig, force = false): Promise<RepoProfile> {
  const pool = getPool();

  if (!force) {
    const { rows } = await pool.query(`SELECT profile FROM repositories WHERE id = $1`, [repositoryId]);
    if (rows[0]?.profile) return rows[0].profile as RepoProfile;
  }

  const context = await buildOverviewContext(repositoryId);
  const profile = await callLlmJson(context, config);

  await pool.query(`UPDATE repositories SET profile = $1 WHERE id = $2`, [JSON.stringify(profile), repositoryId]);
  return profile;
}
