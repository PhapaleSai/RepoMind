"use client";

import { useEffect, useState } from "react";
import { Star, GitFork, CircleDot, Clock } from "lucide-react";

// A quiet "at a glance" stats strip — stars, forks, open issues, primary language, last push —
// fetched with a single cheap GitHub API call the moment a repo URL is entered, no ingestion
// needed. Deliberately understated: small icons, muted text, one line, no cards-within-cards.

interface RepoMeta {
  description: string | null;
  stars: number;
  forks: number;
  openIssues: number;
  language: string | null;
  license: string | null;
  pushedAt: string;
}

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

function formatCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
}

export default function RepoStatsCard({ repoUrl }: { repoUrl: string }) {
  const [meta, setMeta] = useState<RepoMeta | null>(null);

  useEffect(() => {
    let cancelled = false;
    setMeta(null);
    if (!repoUrl.trim()) return;
    (async () => {
      try {
        const res = await fetch("/api/repo-meta", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ repoUrl }),
        });
        const data = await res.json();
        if (!cancelled && res.ok) setMeta(data.meta);
      } catch {
        // non-fatal — the strip just doesn't render
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [repoUrl]);

  if (!meta) return null;

  return (
    <div className="fade-in flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-white/40">
      <span className="flex items-center gap-1">
        <Star className="h-3 w-3" /> {formatCount(meta.stars)}
      </span>
      <span className="flex items-center gap-1">
        <GitFork className="h-3 w-3" /> {formatCount(meta.forks)}
      </span>
      {meta.openIssues > 0 && (
        <span className="flex items-center gap-1">
          <CircleDot className="h-3 w-3" /> {formatCount(meta.openIssues)}
        </span>
      )}
      {meta.language && <span className="rounded-full bg-white/5 px-1.5 py-0.5">{meta.language}</span>}
      <span className="flex items-center gap-1">
        <Clock className="h-3 w-3" /> {timeAgo(meta.pushedAt)}
      </span>
    </div>
  );
}
