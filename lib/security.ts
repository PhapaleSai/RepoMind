// Static secret-scanning (plan.md Phase 5: "detecting leaked keys, missing auth").
// Pattern-based only, no LLM call — runs during ingestion so it's free and instant.
// Deliberately conservative pattern set: broad heuristics (e.g. "any 40-char base64
// string") produce too many false positives to be useful, so this only flags patterns
// specific enough to a real provider's key format.

export interface SecurityFinding {
  filePath: string;
  line: number;
  ruleId: string;
  description: string;
  snippet: string;
}

const PATTERNS: { id: string; description: string; regex: RegExp }[] = [
  { id: "aws-access-key", description: "AWS Access Key ID", regex: /AKIA[0-9A-Z]{16}/ },
  { id: "private-key-block", description: "Private key block committed to source", regex: /-----BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/ },
  { id: "generic-secret-assignment", description: "Hardcoded API key/secret/token assignment", regex: /\b(api[_-]?key|secret|token|password)\b\s*[:=]\s*["'][A-Za-z0-9_\-]{16,}["']/i },
  { id: "slack-token", description: "Slack token", regex: /xox[baprs]-[A-Za-z0-9-]{10,}/ },
  { id: "stripe-key", description: "Stripe API key", regex: /sk_(live|test)_[A-Za-z0-9]{16,}/ },
  { id: "github-token", description: "GitHub personal access / app token", regex: /gh[pousr]_[A-Za-z0-9]{20,}/ },
  { id: "openai-key", description: "OpenAI-style API key", regex: /sk-[A-Za-z0-9]{20,}/ },
];

export function scanFileForSecrets(filePath: string, content: string): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  const lines = content.split("\n");
  lines.forEach((line, i) => {
    for (const pattern of PATTERNS) {
      if (pattern.regex.test(line)) {
        findings.push({
          filePath,
          line: i + 1,
          ruleId: pattern.id,
          description: pattern.description,
          snippet: line.trim().slice(0, 160),
        });
      }
    }
  });
  return findings;
}

export function scanFilesForSecrets(files: { path: string; content: string }[]): Record<string, SecurityFinding[]> {
  const byPath: Record<string, SecurityFinding[]> = {};
  for (const file of files) {
    const findings = scanFileForSecrets(file.path, file.content);
    if (findings.length > 0) byPath[file.path] = findings;
  }
  return byPath;
}

export function mergeSecurityFindings(
  existing: Record<string, SecurityFinding[]> | null,
  touchedFindings: Record<string, SecurityFinding[]>,
  touchedPaths: string[],
  removedPaths: string[]
): Record<string, SecurityFinding[]> {
  const merged: Record<string, SecurityFinding[]> = { ...(existing ?? {}) };
  for (const path of [...touchedPaths, ...removedPaths]) {
    delete merged[path];
  }
  for (const [path, findings] of Object.entries(touchedFindings)) {
    merged[path] = findings;
  }
  return merged;
}
