"use client";

import { useState } from "react";
import { GitPullRequest, Loader2, Sparkles } from "lucide-react";
import Markdown from "@/components/Markdown";
import { handleSpotlight } from "@/lib/uiEffects";

// Standalone PR/diff explainer — deliberately independent of any ingested repo (fetches the
// diff straight from GitHub given a PR URL), so it works even for a repo the user hasn't
// ingested at all.

export default function PrExplainer({ apiKey }: { apiKey: string }) {
  const [open, setOpen] = useState(false);
  const [prUrl, setPrUrl] = useState("");
  const [answer, setAnswer] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState("");

  async function explain() {
    if (!prUrl.trim() || !apiKey.trim() || streaming) return;
    setStreaming(true);
    setError("");
    setAnswer("");

    try {
      const res = await fetch("/api/pr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prUrl, apiKey }),
      });
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      if (!reader) return;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";

        for (const raw of events) {
          const lines = raw.split("\n");
          const eventLine = lines.find((l) => l.startsWith("event:"));
          const dataLine = lines.find((l) => l.startsWith("data:"));
          if (!eventLine || !dataLine) continue;
          const eventName = eventLine.replace("event:", "").trim();
          const data = JSON.parse(dataLine.replace("data:", "").trim());
          if (eventName === "token") setAnswer((prev) => prev + data);
          if (eventName === "error") setError(data.message);
        }
      }
    } finally {
      setStreaming(false);
    }
  }

  return (
    <div className="glass-panel spotlight-card rounded-2xl" onMouseMove={handleSpotlight}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-5 py-4 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-medium text-white/80">
          <GitPullRequest className="h-4 w-4 text-indigo-300" /> Explain a pull request
        </span>
      </button>

      {open && (
        <div className="space-y-3 border-t border-white/10 px-5 py-5">
          <p className="text-xs text-white/30">
            Paste any GitHub PR link — works even for a repo you haven't ingested.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="text"
              value={prUrl}
              onChange={(e) => setPrUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && explain()}
              placeholder="https://github.com/owner/repo/pull/123"
              className="glass-chip flex-1 rounded-xl px-3 py-2 text-sm text-white/90 placeholder:text-white/30 focus:outline-none"
            />
            <button
              type="button"
              onClick={explain}
              disabled={!prUrl.trim() || !apiKey.trim() || streaming}
              className="gradient-cta flex shrink-0 items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              {streaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {streaming ? "Explaining…" : "Explain"}
            </button>
          </div>
          {!apiKey.trim() && <p className="text-xs text-white/30">Add your LLM API key first.</p>}
          {error && <p className="text-xs text-red-300/90">{error}</p>}
          {(answer || streaming) && (
            <div className="fade-in rounded-lg border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/90">
              <Markdown text={answer} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
