"use client";

import { useEffect, useState } from "react";
import { Github, LogOut, Check, X } from "lucide-react";

interface Status {
  connected: boolean;
  login?: string;
  avatarUrl?: string;
}

export default function GitHubConnectButton({ onStatusChange }: { onStatusChange?: (connected: boolean) => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [confirming, setConfirming] = useState(false);

  async function refresh() {
    try {
      const res = await fetch("/api/auth/github/status");
      const data = await res.json();
      setStatus(data);
      onStatusChange?.(data.connected);
    } catch {
      setStatus({ connected: false });
      onStatusChange?.(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function disconnect() {
    setConfirming(false);
    await fetch("/api/auth/github/logout", { method: "POST" });
    refresh();
  }

  if (!status) return null;

  if (status.connected) {
    if (confirming) {
      return (
        <div className="fade-in flex items-center gap-2 rounded-xl border border-amber-400/30 bg-amber-400/[0.08] px-3 py-1.5 text-xs text-amber-200">
          <span>Disconnect GitHub?</span>
          <button
            type="button"
            onClick={disconnect}
            title="Yes, disconnect"
            className="flex items-center justify-center rounded-md bg-amber-400/20 p-1 text-amber-200 transition hover:bg-amber-400/30"
          >
            <Check className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            title="Cancel"
            className="flex items-center justify-center rounded-md p-1 text-white/40 transition hover:bg-white/10 hover:text-white/70"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      );
    }

    return (
      <div className="flex items-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-400/[0.06] px-3 py-1.5 text-xs text-white/70 shadow-sm shadow-emerald-500/10">
        {status.avatarUrl && <img src={status.avatarUrl} alt="" className="h-5 w-5 rounded-full ring-1 ring-emerald-400/40" />}
        <span className="max-w-[8rem] truncate text-emerald-200/90 sm:max-w-none">{status.login}</span>
        <button type="button" onClick={() => setConfirming(true)} title="Disconnect GitHub" className="text-white/30 hover:text-white/70">
          <LogOut className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <a
      href="/api/auth/github/login"
      className="group flex shrink-0 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-white/60 transition hover:border-fuchsia-400/40 hover:bg-fuchsia-400/[0.06] hover:text-white/90"
    >
      <Github className="h-3.5 w-3.5 shrink-0 transition group-hover:text-fuchsia-300" />
      <span className="hidden sm:inline">Connect GitHub for private repos</span>
      <span className="sm:hidden">Connect GitHub</span>
    </a>
  );
}
