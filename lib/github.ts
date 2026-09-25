const GITHUB_API = "https://api.github.com";

// Free-tier guardrails: keep ingestion cheap in both GitHub API calls and embedding cost.
const MAX_FILES = 200;
const MAX_FILE_BYTES = 80_000;
const MAX_TOTAL_BYTES = 4_000_000;

const CODE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".java", ".rb", ".php",
  ".c", ".cpp", ".h", ".hpp", ".cs", ".swift", ".kt", ".scala", ".sql",
]);

const KEY_FILES = new Set([
  "README.md", "readme.md", "package.json", "requirements.txt", "pyproject.toml",
  "Dockerfile", "docker-compose.yml", ".env.example", "go.mod", "Cargo.toml",
]);

export interface RepoRef {
  owner: string;
  repo: string;
}

export interface FetchedFile {
  path: string;
  content: string;
}

export interface RepoSnapshot {
  owner: string;
  repo: string;
  defaultBranch: string;
  commitSha: string;
  isPrivate: boolean;
  files: FetchedFile[];
}

export function parseGitHubUrl(url: string): RepoRef {
  const cleaned = url.trim().replace(/\.git$/, "").replace(/\/$/, "");
  const match = cleaned.match(/github\.com[/:]([^/]+)\/([^/]+)$/);
  if (!match) {
    throw new Error("Could not parse a GitHub owner/repo from that URL");
  }
  return { owner: match[1], repo: match[2] };
}

// An access token here is the user's own OAuth token (private repos, via "Connect
// GitHub"); falling back to the server-side GITHUB_TOKEN just raises anonymous rate
// limits for public repos and never grants private access.
function ghHeaders(accessToken?: string, accept = "application/vnd.github+json"): HeadersInit {
  const headers: HeadersInit = { Accept: accept };
  const token = accessToken || process.env.GITHUB_TOKEN;
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

async function ghFetch(path: string, accessToken?: string): Promise<any> {
  const res = await fetch(`${GITHUB_API}${path}`, { headers: ghHeaders(accessToken) });
  if (!res.ok) {
    throw new Error(`GitHub API ${path} failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

function isWanted(path: string): boolean {
  const base = path.split("/").pop() ?? "";
  if (KEY_FILES.has(base)) return true;
  const dot = base.lastIndexOf(".");
  if (dot === -1) return false;
  return CODE_EXTENSIONS.has(base.slice(dot));
}

const FETCH_CONCURRENCY = 16;

// Bounded-concurrency map: fetching 200 files one at a time was the biggest ingestion
// bottleneck (mostly network latency, not GitHub rate limits), so run a worker pool
// instead of a sequential loop.
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// Postgres text columns reject embedded NUL bytes outright ("invalid byte sequence for
// encoding UTF8: 0x00") even though 0x00 is technically valid UTF-8 — it's a Postgres storage
// limitation, not an encoding one. A handful of source files in the wild carry a stray NUL
// (bad line endings, a misdetected binary file, a generated file with embedded resources), and
// without this the whole ingest transaction dies on that one file's chunk insert.
function stripNulBytes(content: string): string {
  return content.includes("\u0000") ? content.replace(/\u0000/g, "") : content;
}

async function fetchFileContents(
  owner: string,
  repo: string,
  commitSha: string,
  paths: string[],
  accessToken?: string
): Promise<FetchedFile[]> {
  const fetched = await mapWithConcurrency(paths, FETCH_CONCURRENCY, async (path) => {
    let content: string;
    if (accessToken) {
      // Private repos (and any authenticated fetch) go through the Contents API with the
      // raw media type — raw.githubusercontent.com does not reliably serve private blobs
      // even with an Authorization header, so this is the officially supported path.
      const res = await fetch(
        `${GITHUB_API}/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${commitSha}`,
        { headers: ghHeaders(accessToken, "application/vnd.github.raw") }
      );
      if (!res.ok) return null;
      content = await res.text();
    } else {
      const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${commitSha}/${path}`;
      const res = await fetch(rawUrl);
      if (!res.ok) return null;
      content = await res.text();
    }
    return { path, content: stripNulBytes(content) } as FetchedFile;
  });

  const files: FetchedFile[] = [];
  let totalBytes = 0;
  for (const file of fetched) {
    if (!file) continue;
    if (totalBytes >= MAX_TOTAL_BYTES) break;
    totalBytes += file.content.length;
    files.push(file);
  }
  return files;
}

export interface RepoMeta {
  description: string | null;
  stars: number;
  forks: number;
  openIssues: number;
  language: string | null;
  license: string | null;
  pushedAt: string;
  defaultBranch: string;
}

// Lightweight "at a glance" stats card data — a single cheap GitHub API call, no ingestion
// needed, so it can render the moment a repo URL is entered.
export async function fetchRepoMeta({ owner, repo }: RepoRef, accessToken?: string): Promise<RepoMeta> {
  const info = await ghFetch(`/repos/${owner}/${repo}`, accessToken);
  return {
    description: info.description,
    stars: info.stargazers_count,
    forks: info.forks_count,
    openIssues: info.open_issues_count,
    language: info.language,
    license: info.license?.spdx_id ?? null,
    pushedAt: info.pushed_at,
    defaultBranch: info.default_branch,
  };
}

// Cheap check for the incremental-ingest path: just the latest commit SHA, no tree walk.
export async function fetchLatestCommit(
  { owner, repo }: RepoRef,
  accessToken?: string
): Promise<{ defaultBranch: string; commitSha: string; isPrivate: boolean }> {
  const repoInfo = await ghFetch(`/repos/${owner}/${repo}`, accessToken);
  const defaultBranch: string = repoInfo.default_branch;
  const branchInfo = await ghFetch(`/repos/${owner}/${repo}/branches/${defaultBranch}`, accessToken);
  return { defaultBranch, commitSha: branchInfo.commit.sha, isPrivate: !!repoInfo.private };
}

export async function fetchRepoSnapshot({ owner, repo }: RepoRef, accessToken?: string): Promise<RepoSnapshot> {
  const { defaultBranch, commitSha, isPrivate } = await fetchLatestCommit({ owner, repo }, accessToken);

  const tree = await ghFetch(`/repos/${owner}/${repo}/git/trees/${commitSha}?recursive=1`, accessToken);

  const candidates = (tree.tree as any[])
    .filter((n) => n.type === "blob" && isWanted(n.path) && n.size && n.size <= MAX_FILE_BYTES)
    .slice(0, MAX_FILES)
    .map((n) => n.path as string);

  const files = await fetchFileContents(owner, repo, commitSha, candidates, accessToken);
  return { owner, repo, defaultBranch, commitSha, isPrivate, files };
}

export interface RepoDiff {
  commitSha: string;
  changed: FetchedFile[];
  removedPaths: string[];
  /** true when GitHub couldn't produce a diff (e.g. history rewrite) — caller should fall back to a full re-ingest */
  fallbackToFull: boolean;
}

// Incremental re-ingest (plan.md Phase 5): use GitHub's compare API to get only the
// files that actually changed between the previously-indexed commit and the latest one,
// instead of re-fetching and re-embedding the whole repo on every re-ingest.
export async function fetchRepoDiff(
  { owner, repo }: RepoRef,
  baseSha: string,
  headSha: string,
  accessToken?: string
): Promise<RepoDiff> {
  if (baseSha === headSha) {
    return { commitSha: headSha, changed: [], removedPaths: [], fallbackToFull: false };
  }

  let compare: any;
  try {
    compare = await ghFetch(`/repos/${owner}/${repo}/compare/${baseSha}...${headSha}`, accessToken);
  } catch {
    return { commitSha: headSha, changed: [], removedPaths: [], fallbackToFull: true };
  }

  const files: any[] = compare.files ?? [];
  const removedPaths: string[] = [];
  const changedPaths: string[] = [];

  for (const f of files) {
    const status = f.status as string;
    if (status === "removed") {
      removedPaths.push(f.filename);
    } else if (status === "renamed") {
      removedPaths.push(f.previous_filename ?? f.filename);
      if (isWanted(f.filename)) changedPaths.push(f.filename);
    } else if (isWanted(f.filename)) {
      // added, modified, copied
      changedPaths.push(f.filename);
    }
  }

  const changed = await fetchFileContents(owner, repo, headSha, changedPaths.slice(0, MAX_FILES), accessToken);
  return { commitSha: headSha, changed, removedPaths, fallbackToFull: false };
}
