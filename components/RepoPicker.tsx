"use client";

import { useEffect, useMemo, useState } from "react";
import { Lock, Globe, Search, Loader2, Star, FolderGit2 } from "lucide-react";
import { handleSpotlight } from "@/lib/uiEffects";

interface Repo {
  fullName: string;
  htmlUrl: string;
  isPrivate: boolean;
  description: string | null;
  language: string | null;
  updatedAt: string;
  stars: number;
}

function timeAgo(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days < 1) return "today";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

const LANGUAGE_COLORS: Record<string, string> = {
  TypeScript: "bg-blue-400",
  JavaScript: "bg-yellow-400",
  Python: "bg-emerald-400",
  Go: "bg-cyan-400",
  Rust: "bg-orange-500",
  Java: "bg-red-400",
  Ruby: "bg-rose-500",
};

export default function RepoPicker({ onSelect }: { onSelect: (url: string) => void }) {
  const [repos, setRepos] = useState<Repo[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError("");
      try {
        const res = await fetch("/api/auth/github/repos");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed to load repos");
        setRepos(data.repos);
      } catch (err: any) {
        setError(err.message ?? "Something went wrong");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filtered = useMemo(() => {
    if (!repos) return [];
    const q = query.trim().toLowerCase();
    if (!q) return repos;
    return repos.filter((r) => r.fullName.toLowerCase().includes(q));
  }, [repos, query]);

  return (
    <section className="stagger-in relative overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03] p-5 shadow-xl backdrop-blur-sm">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-400/50 to-transparent" />
      <div className="mb-3 flex items-center gap-2 text-sm text-white/50">
        <FolderGit2 className="h-4 w-4 shrink-0 text-cyan-300" />
        <span>Your repositories</span>
        {repos && <span className="text-xs text-white/30">({repos.length})</span>}
      </div>

      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/30" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter your repos…"
          className="w-full rounded-xl border border-white/10 bg-black/20 py-2 pl-8 pr-3 text-xs text-white placeholder:text-white/30 outline-none transition focus:border-cyan-400/50 focus:ring-2 focus:ring-cyan-400/20"
        />
      </div>

      {loading && (
        <div className="flex items-center justify-center gap-2 py-8 text-xs text-white/40">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading your repositories…
        </div>
      )}
      {error && <div className="py-2 text-xs text-red-300/90">{error}</div>}
      {!loading && !error && filtered.length === 0 && (
        <div className="py-8 text-center text-xs text-white/30">No repositories match.</div>
      )}

      {/* Single column — this panel lives inside a fixed-width sidebar, so a viewport-width
          breakpoint like sm:grid-cols-2 would (and did) trigger on any normal desktop screen
          regardless of the sidebar's actual (much narrower) width, cramming cards into two
          unreadable columns. A container-width media query would need a plugin; a single
          column is simpler and reads better in a narrow sidebar anyway. */}
      {!loading && filtered.length > 0 && (
        <div className="scrollbar-thin flex max-h-80 flex-col gap-2 overflow-y-auto pr-1">
          {filtered.map((repo, idx) => (
            <button
              key={repo.fullName}
              type="button"
              onClick={() => onSelect(repo.htmlUrl)}
              className="spotlight-card group flex w-full min-w-0 flex-col items-start gap-1 rounded-2xl border border-white/10 bg-black/20 p-3 text-left transition hover:-translate-y-0.5 hover:border-cyan-400/40 hover:bg-cyan-400/[0.06] hover:shadow-lg hover:shadow-cyan-500/10"
              style={{ animationDelay: `${Math.min(idx, 12) * 0.03}s` }}
              onMouseMove={handleSpotlight}
            >
              <div className="flex w-full min-w-0 items-center gap-1.5">
                {repo.isPrivate ? (
                  <Lock className="h-3 w-3 shrink-0 text-amber-300/70" />
                ) : (
                  <Globe className="h-3 w-3 shrink-0 text-white/30" />
                )}
                <p className="min-w-0 flex-1 truncate text-xs font-medium text-white/85 group-hover:text-white">
                  <span className="text-white/40">{repo.fullName.split("/")[0]}/</span>
                  {repo.fullName.split("/")[1]}
                </p>
              </div>
              {repo.description && (
                <p className="line-clamp-2 w-full text-[11px] leading-snug text-white/40">{repo.description}</p>
              )}
              <div className="mt-1 flex w-full min-w-0 items-center gap-2 text-[10px] text-white/30">
                {repo.language && (
                  <span className="flex shrink-0 items-center gap-1">
                    <span className={`h-1.5 w-1.5 rounded-full ${LANGUAGE_COLORS[repo.language] ?? "bg-white/30"}`} />
                    {repo.language}
                  </span>
                )}
                {repo.stars > 0 && (
                  <span className="flex shrink-0 items-center gap-0.5">
                    <Star className="h-2.5 w-2.5" />
                    {repo.stars}
                  </span>
                )}
                <span className="ml-auto shrink-0">{timeAgo(repo.updatedAt)}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
