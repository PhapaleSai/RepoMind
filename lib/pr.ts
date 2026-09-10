// PR/diff explainer: fetches a pull request's metadata and file diffs straight from the
// GitHub API (no ingestion/DB involved — this works for any PR, ingested repo or not) and
// builds a compact context string for the LLM to summarize.

const GITHUB_API = "https://api.github.com";
const MAX_FILES = 25;
const MAX_PATCH_CHARS = 1_500;
const MAX_TOTAL_CHARS = 9_000;

export interface PrRef {
  owner: string;
  repo: string;
  number: number;
}

export function parsePrUrl(url: string): PrRef {
  const match = url.trim().match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (!match) {
    throw new Error("Could not parse a GitHub PR URL — expected something like https://github.com/owner/repo/pull/123");
  }
  return { owner: match[1], repo: match[2], number: Number(match[3]) };
}

function ghHeaders(accessToken?: string): HeadersInit {
  const headers: HeadersInit = { Accept: "application/vnd.github+json" };
  const token = accessToken || process.env.GITHUB_TOKEN;
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

interface PrFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
}

export async function buildPrContext(ref: PrRef, accessToken?: string): Promise<string> {
  const headers = ghHeaders(accessToken);

  const prRes = await fetch(`${GITHUB_API}/repos/${ref.owner}/${ref.repo}/pulls/${ref.number}`, { headers });
  if (!prRes.ok) {
    if (prRes.status === 404) throw new Error("PR not found — check the URL, or connect GitHub if it's private");
    throw new Error(`GitHub API failed: ${prRes.status} ${await prRes.text()}`);
  }
  const pr = await prRes.json();

  const filesRes = await fetch(
    `${GITHUB_API}/repos/${ref.owner}/${ref.repo}/pulls/${ref.number}/files?per_page=${MAX_FILES}`,
    { headers }
  );
  if (!filesRes.ok) {
    throw new Error(`GitHub API failed: ${filesRes.status} ${await filesRes.text()}`);
  }
  const files: PrFile[] = await filesRes.json();

  let out = `Title: ${pr.title}\n`;
  if (pr.body) out += `Description: ${pr.body.slice(0, 800)}\n`;
  out += `Files changed: ${pr.changed_files}, +${pr.additions}/-${pr.deletions}\n\n`;

  const perFileBudget = Math.max(200, Math.floor(MAX_TOTAL_CHARS / Math.max(files.length, 1)));
  for (const f of files) {
    if (out.length >= MAX_TOTAL_CHARS) break;
    out += `--- ${f.filename} (${f.status}, +${f.additions}/-${f.deletions}) ---\n`;
    if (f.patch) {
      const patch = f.patch.length > Math.min(perFileBudget, MAX_PATCH_CHARS)
        ? f.patch.slice(0, Math.min(perFileBudget, MAX_PATCH_CHARS)) + "\n… (truncated)"
        : f.patch;
      out += `${patch}\n\n`;
    } else {
      out += "(binary or too large to diff)\n\n";
    }
  }

  return out.slice(0, MAX_TOTAL_CHARS);
}
