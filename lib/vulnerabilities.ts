import { getPool } from "./db";

// Dependency vulnerability scan: parses package.json/requirements.txt from the ingested repo
// and checks each dependency against OSV.dev (osv.dev — Google's open, free, keyless
// vulnerability database covering npm, PyPI, and more) via its batch query API. Real known-CVE
// data, not an LLM guess.

const OSV_API = "https://api.osv.dev/v1";
const MAX_DEPS = 80;
const MAX_VULN_DETAILS = 20;
const DETAIL_CONCURRENCY = 5;

interface Dep {
  name: string;
  version: string;
  ecosystem: "npm" | "PyPI";
}

export interface Vulnerability {
  packageName: string;
  version: string;
  ecosystem: string;
  id: string;
  summary: string;
  severity?: string;
}

function parsePackageJson(content: string): Dep[] {
  try {
    const json = JSON.parse(content);
    const deps: Dep[] = [];
    for (const field of ["dependencies", "devDependencies"]) {
      const section = json[field];
      if (!section) continue;
      for (const [name, rawVersion] of Object.entries(section)) {
        const version = String(rawVersion).replace(/^[\^~>=<\s]+/, "");
        if (/^\d/.test(version)) deps.push({ name, version, ecosystem: "npm" });
      }
    }
    return deps;
  } catch {
    return [];
  }
}

function parseRequirementsTxt(content: string): Dep[] {
  const deps: Dep[] = [];
  for (const line of content.split("\n")) {
    const match = line.trim().match(/^([A-Za-z0-9_.-]+)\s*==\s*([\w.]+)/);
    if (match) deps.push({ name: match[1], version: match[2], ecosystem: "PyPI" });
  }
  return deps;
}

export async function scanDependencies(repositoryId: string): Promise<Vulnerability[]> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT file_path, content FROM code_chunks WHERE repository_id = $1 AND file_path IN ('package.json', 'requirements.txt')`,
    [repositoryId]
  );

  let deps: Dep[] = [];
  for (const row of rows) {
    if (row.file_path === "package.json") deps = deps.concat(parsePackageJson(row.content));
    if (row.file_path === "requirements.txt") deps = deps.concat(parseRequirementsTxt(row.content));
  }
  deps = deps.slice(0, MAX_DEPS);
  if (deps.length === 0) return [];

  const batchRes = await fetch(`${OSV_API}/querybatch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      queries: deps.map((d) => ({ version: d.version, package: { name: d.name, ecosystem: d.ecosystem } })),
    }),
  });
  if (!batchRes.ok) throw new Error(`OSV batch query failed: ${batchRes.status}`);
  const batch = await batchRes.json();
  const results: { vulns?: { id: string }[] }[] = batch.results ?? [];

  const hits: { dep: Dep; vulnId: string }[] = [];
  results.forEach((r, i) => {
    for (const v of r.vulns ?? []) hits.push({ dep: deps[i], vulnId: v.id });
  });
  const uniqueIds = [...new Set(hits.map((h) => h.vulnId))].slice(0, MAX_VULN_DETAILS);

  const detailsById = new Map<string, any>();
  for (let i = 0; i < uniqueIds.length; i += DETAIL_CONCURRENCY) {
    const batch = uniqueIds.slice(i, i + DETAIL_CONCURRENCY);
    const fetched = await Promise.all(
      batch.map((id) => fetch(`${OSV_API}/vulns/${id}`).then((r) => (r.ok ? r.json() : null)).catch(() => null))
    );
    batch.forEach((id, idx) => detailsById.set(id, fetched[idx]));
  }

  return hits
    .filter((h) => detailsById.has(h.vulnId) && detailsById.get(h.vulnId))
    .map((h) => {
      const detail = detailsById.get(h.vulnId);
      const severity = detail.severity?.[0]?.score ?? detail.database_specific?.severity;
      return {
        packageName: h.dep.name,
        version: h.dep.version,
        ecosystem: h.dep.ecosystem,
        id: h.vulnId,
        summary: (detail.summary ?? detail.details ?? "No summary available").slice(0, 200),
        severity: severity ? String(severity) : undefined,
      };
    });
}
