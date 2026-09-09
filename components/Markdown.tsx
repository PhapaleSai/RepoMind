"use client";

import { useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";

// Deliberately not a full markdown library: the LLM only ever produces bold text,
// inline code, fenced code blocks, [n] citation markers, and (occasionally, despite
// being told not to) markdown tables in practice, so a tiny renderer covers exactly
// that without pulling in a dependency.

export interface CitationRef {
  filePath: string;
  startLine: number;
  endLine: number;
  language?: string;
  content?: string;
}

function jumpToCitation(groupId: string, n: number) {
  const el = document.getElementById(`citation-${groupId}-${n}`);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "nearest" });
  el.classList.add("citation-flash");
  window.setTimeout(() => el.classList.remove("citation-flash"), 900);
}

function renderInline(
  text: string,
  keyPrefix: string,
  groupId: string,
  citations: CitationRef[]
): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[\d+\])/g).filter(Boolean);
  return parts.map((part, i) => {
    const key = `${keyPrefix}-${i}`;
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={key}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code key={key} className="rounded bg-black/30 px-1.5 py-0.5 text-[0.85em]">
          {part.slice(1, -1)}
        </code>
      );
    }
    const citationMatch = part.match(/^\[(\d+)\]$/);
    if (citationMatch) {
      const n = Number(citationMatch[1]);
      const ref = citations[n - 1];
      return (
        <button
          key={key}
          type="button"
          title={ref ? `${ref.filePath}#L${ref.startLine}-L${ref.endLine}` : undefined}
          onClick={() => jumpToCitation(groupId, n)}
          className="mx-0.5 inline-flex h-4 min-w-4 -translate-y-0.5 items-center justify-center rounded bg-indigo-400/20 px-1 align-super text-[10px] font-medium text-indigo-300 transition hover:bg-indigo-400/40"
        >
          {n}
        </button>
      );
    }
    return <span key={key}>{part}</span>;
  });
}

const TABLE_SEPARATOR_RE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/;

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

// Renders a markdown table block (header + separator + body rows). Called only once a
// header/separator pair has been confirmed, so it always has a well-formed 2+ line block.
function renderTable(headerLine: string, bodyLines: string[], keyPrefix: string, groupId: string, citations: CitationRef[]) {
  const headers = splitTableRow(headerLine);
  const rows = bodyLines.map(splitTableRow);
  return (
    <div key={keyPrefix} className="my-2 overflow-x-auto rounded-lg border border-white/10">
      <table className="w-full border-collapse text-left text-[0.85em]">
        <thead>
          <tr className="border-b border-white/10 bg-white/[0.04]">
            {headers.map((h, i) => (
              <th key={i} className="px-2.5 py-1.5 font-medium text-white/70">
                {renderInline(h, `${keyPrefix}-h${i}`, groupId, citations)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r} className="border-b border-white/5 last:border-0">
              {row.map((cell, c) => (
                <td key={c} className="px-2.5 py-1.5 align-top text-white/80">
                  {renderInline(cell, `${keyPrefix}-r${r}c${c}`, groupId, citations)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard API unavailable — non-fatal, just don't show the "copied" state
    }
  }

  return (
    <div className="group/code relative my-2 overflow-hidden rounded-lg border border-white/10 bg-black/40">
      {lang && (
        <div className="flex items-center justify-between border-b border-white/10 bg-white/[0.03] px-3 py-1">
          <span className="text-[10px] uppercase tracking-wide text-white/30">{lang}</span>
        </div>
      )}
      <button
        type="button"
        onClick={copy}
        className={`absolute right-2 ${lang ? "top-9" : "top-2"} flex items-center gap-1 rounded-md border border-white/10 bg-black/50 px-2 py-1 text-[10px] text-white/50 opacity-0 transition group-hover/code:opacity-100 hover:text-white/90`}
      >
        {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
        {copied ? "Copied" : "Copy"}
      </button>
      <pre className="overflow-x-auto p-3 text-[0.85em] leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function renderProse(prose: string, keyPrefix: string, groupId: string, citations: CitationRef[]): ReactNode[] {
  const lines = prose.split("\n");
  const nodes: ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const next = lines[i + 1];

    if (line.includes("|") && next !== undefined && TABLE_SEPARATOR_RE.test(next)) {
      const bodyLines: string[] = [];
      let j = i + 2;
      while (j < lines.length && lines[j].includes("|") && lines[j].trim() !== "") {
        bodyLines.push(lines[j]);
        j++;
      }
      nodes.push(renderTable(line, bodyLines, `${keyPrefix}-table-${i}`, groupId, citations));
      i = j;
      continue;
    }

    nodes.push(<span key={`${keyPrefix}-${i}`}>{renderInline(line, `${keyPrefix}-${i}`, groupId, citations)}</span>);
    if (i < lines.length - 1) nodes.push(<br key={`${keyPrefix}-br-${i}`} />);
    i++;
  }

  return nodes;
}

export default function Markdown({
  text,
  groupId = "0",
  citations = [],
}: {
  text: string;
  groupId?: string;
  citations?: CitationRef[];
}) {
  const segments = text.split(/```(\w*)\n?([\s\S]*?)```/g);
  const nodes: ReactNode[] = [];

  for (let i = 0; i < segments.length; i += 3) {
    const prose = segments[i];
    const lang = segments[i + 1];
    const code = segments[i + 2];

    if (prose) {
      nodes.push(...renderProse(prose, `p-${i}`, groupId, citations));
    }
    if (code !== undefined) {
      nodes.push(<CodeBlock key={`code-${i}`} code={code.replace(/\n$/, "")} lang={lang || undefined} />);
    }
  }

  return <div className="whitespace-pre-wrap break-words">{nodes}</div>;
}
