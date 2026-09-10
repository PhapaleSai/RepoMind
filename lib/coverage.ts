import { getPool } from "./db";

// Test coverage gap finder: deterministic, no LLM call — cross-references the repo's source
// files against its test files (by path convention) and flags source files that no test file
// appears to reference by name. It's a heuristic (a text-reference check, not real coverage
// instrumentation) but free, instant, and good enough to point at obviously-untested files.

export interface CoverageResult {
  totalSourceFiles: number;
  testedFiles: number;
  untestedFiles: string[];
}

const TEST_PATH_RE = /(^|\/)(__tests__|tests?|spec)(\/|$)|\.(test|spec)\.[jt]sx?$|_test\.py$|test_[^/]+\.py$/i;

// Config/build/type-only files rarely have or need direct tests — excluding them keeps the
// "untested" list meaningful instead of full of noise.
const SKIP_RE = /\.(json|md|mdx|yml|yaml|lock|css|scss|svg|png|jpg|d\.ts)$|(^|\/)(dist|build|node_modules|migrations)\//i;

function basenameNoExt(filePath: string): string {
  const base = filePath.split("/").pop() ?? filePath;
  return base.replace(/\.[^.]+$/, "");
}

export async function findCoverageGaps(repositoryId: string): Promise<CoverageResult> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT file_path, content FROM code_chunks WHERE repository_id = $1`,
    [repositoryId]
  );

  const contentByFile = new Map<string, string>();
  for (const row of rows) {
    contentByFile.set(row.file_path, (contentByFile.get(row.file_path) ?? "") + "\n" + row.content);
  }

  const allFiles = [...contentByFile.keys()];
  const testFiles = allFiles.filter((f) => TEST_PATH_RE.test(f));
  const sourceFiles = allFiles.filter((f) => !TEST_PATH_RE.test(f) && !SKIP_RE.test(f));

  const testContent = testFiles.map((f) => contentByFile.get(f) ?? "").join("\n");

  const untestedFiles = sourceFiles.filter((f) => {
    const name = basenameNoExt(f);
    if (name.length < 2) return false;
    const wordRe = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
    return !wordRe.test(testContent);
  });

  return {
    totalSourceFiles: sourceFiles.length,
    testedFiles: sourceFiles.length - untestedFiles.length,
    untestedFiles: untestedFiles.sort(),
  };
}
