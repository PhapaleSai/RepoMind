"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, CornerDownLeft } from "lucide-react";

// A quiet, macOS-Spotlight-style command palette — Cmd/Ctrl+K opens it, arrow keys move the
// selection, Enter runs the highlighted action, Escape closes. Deliberately restrained:
// centered glass card, soft backdrop dim, no color noise — the kind of chrome Apple's own
// system UI uses when it needs to get out of the way immediately after you're done with it.

export interface PaletteAction {
  id: string;
  label: string;
  hint?: string;
  icon: React.ComponentType<{ className?: string }>;
  disabled?: boolean;
  run: () => void;
}

export default function CommandPalette({
  open,
  onClose,
  actions,
}: {
  open: boolean;
  onClose: () => void;
  actions: PaletteAction[];
}) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const enabled = actions.filter((a) => !a.disabled);
    if (!q) return enabled;
    return enabled.filter((a) => a.label.toLowerCase().includes(q));
  }, [actions, query]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      // Wait a frame so the element is mounted before focusing.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const action = filtered[activeIndex];
        if (action) {
          onClose();
          action.run();
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, filtered, activeIndex, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-black/50 px-4 pt-[14vh] backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="glass-panel fade-in w-full max-w-lg overflow-hidden rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 border-b border-white/10 px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-white/40" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type a command…"
            className="flex-1 bg-transparent text-sm text-white placeholder:text-white/30 outline-none"
          />
          <kbd className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] text-white/30">esc</kbd>
        </div>
        <div className="max-h-80 overflow-y-auto p-2">
          {filtered.length === 0 && <p className="px-3 py-6 text-center text-xs text-white/30">No matching commands</p>}
          {filtered.map((action, i) => (
            <button
              key={action.id}
              type="button"
              onMouseEnter={() => setActiveIndex(i)}
              onClick={() => {
                onClose();
                action.run();
              }}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition ${
                i === activeIndex ? "bg-white/10 text-white" : "text-white/60"
              }`}
            >
              <action.icon className="h-4 w-4 shrink-0 text-white/50" />
              <span className="flex-1 truncate">{action.label}</span>
              {action.hint && <span className="shrink-0 text-[11px] text-white/30">{action.hint}</span>}
              {i === activeIndex && <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-white/30" />}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
