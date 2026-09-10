"use client";

import { useEffect, useState } from "react";
import { Loader2, FlaskConical, ChevronDown } from "lucide-react";
import type { CoverageResult } from "@/lib/coverage";

// Deterministic test-coverage gap finder — no LLM call, same free/instant pattern as GraphView.
// Flags source files that no test file appears to reference by name (a heuristic, not real
// coverage instrumentation, but a useful first pass at "what's untested here").

export default function CoverageGaps({ repositoryId }: { repositoryId: string }) {
  const [coverage, setCoverage] = useState<CoverageResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setCoverage(null);
    setError("");
    setExpanded(false);
    setLoading(true);
    (async () => {
      try {
        const res = await fetch("/api/coverage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ repositoryId }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed to scan test coverage");
        if (!cancelled) setCoverage(data.coverage);
      } catch (err: any) {
        if (!cancelled) setError(err.message ?? "Something went wrong");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [repositoryId]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-white/40">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Scanning for test coverage gaps…
      </div>
    );
  }
  if (error || !coverage || coverage.totalSourceFiles === 0) return null;

  const pct = Math.round((coverage.testedFiles / coverage.totalSourceFiles) * 100);

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <h3 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-white/40">
          <FlaskConical className="h-3.5 w-3.5" /> Test coverage
        </h3>
        <div className="flex items-center gap-2">
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] ${
              pct >= 70 ? "bg-emerald-400/10 text-emerald-300" : pct >= 30 ? "bg-amber-400/10 text-amber-300" : "bg-red-400/10 text-red-300"
            }`}
          >
            {pct}% referenced by tests
          </span>
          <ChevronDown className={`h-3.5 w-3.5 text-white/40 transition-transform ${expanded ? "rotate-180" : ""}`} />
        </div>
      </button>
      {expanded && (
        <div className="mt-2">
          {coverage.untestedFiles.length === 0 ? (
            <p className="text-xs text-white/40">Every source file appears to be referenced by a test.</p>
          ) : (
            <>
              <p className="mb-1.5 text-[11px] text-white/30">
                {coverage.untestedFiles.length} file{coverage.untestedFiles.length === 1 ? "" : "s"} with no detected test reference:
              </p>
              <ul className="scrollbar-thin max-h-40 space-y-1 overflow-y-auto pr-1">
                {coverage.untestedFiles.map((f) => (
                  <li key={f} className="truncate rounded-md bg-white/[0.03] px-2 py-1 font-mono text-[11px] text-white/60">
                    {f}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
