"use client";

import { useEffect, useState } from "react";
import { Github, LogOut } from "lucide-react";

interface Status {
  connected: boolean;
  login?: string;
  avatarUrl?: string;
}

export default function GitHubConnectButton({ onStatusChange }: { onStatusChange?: (connected: boolean) => void }) {
  const [status, setStatus] = useState<Status | null>(null);

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
    await fetch("/api/auth/github/logout", { method: "POST" });
    refresh();
  }

  if (!status) return null;

  if (status.connected) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-400/[0.06] px-3 py-1.5 text-xs text-white/70 shadow-sm shadow-emerald-500/10">
        {status.avatarUrl && <img src={status.avatarUrl} alt="" className="h-5 w-5 rounded-full ring-1 ring-emerald-400/40" />}
        <span className="text-emerald-200/90">{status.login}</span>
        <button type="button" onClick={disconnect} title="Disconnect GitHub" className="text-white/30 hover:text-white/70">
          <LogOut className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <a
      href="/api/auth/github/login"
      className="group flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-white/60 transition hover:border-fuchsia-400/40 hover:bg-fuchsia-400/[0.06] hover:text-white/90"
    >
      <Github className="h-3.5 w-3.5 transition group-hover:text-fuchsia-300" />
      Connect GitHub for private repos
    </a>
  );
}
