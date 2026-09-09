"use client";

import { useEffect, useRef, useState } from "react";
import {
  Sparkles,
  Github,
  Loader2,
  KeyRound,
  Eye,
  EyeOff,
  Send,
  CheckCircle2,
  AlertCircle,
  FileCode2,
  MessageSquareText,
  Code2,
  GraduationCap,
  Lightbulb,
  RefreshCw,
  Bot,
  User,
  Network,
  ShieldCheck,
  Layers,
  HelpCircle,
  Compass,
  Package,
  Terminal,
  FlaskConical,
  ChevronDown,
  Copy,
  Check,
  RotateCcw,
  ArrowDown,
} from "lucide-react";
import Markdown, { CodeBlock } from "./Markdown";
import RepoProfilePanel from "./RepoProfilePanel";
import GitHubConnectButton from "./GitHubConnectButton";
import RepoPicker from "./RepoPicker";
import CountUp from "./CountUp";
import { INGEST_FACTS } from "@/lib/facts";
import { handleSpotlight, createRipple } from "@/lib/uiEffects";

const API_KEY_STORAGE_KEY = "repomind_llm_api_key";
const MODE_STORAGE_KEY = "repomind_explainer_mode";
const FACT_ROTATE_MS = 4500;

type ExplainerMode = "technical" | "beginner" | "analogy";

const MODES: { value: ExplainerMode; label: string; icon: typeof Code2; gradient: string; ring: string }[] = [
  { value: "technical", label: "Technical", icon: Code2, gradient: "from-indigo-500 to-blue-500", ring: "from-indigo-500/30 to-blue-500/30" },
  { value: "beginner", label: "Beginner", icon: GraduationCap, gradient: "from-emerald-500 to-teal-400", ring: "from-emerald-500/30 to-teal-400/30" },
  { value: "analogy", label: "Analogy", icon: Lightbulb, gradient: "from-fuchsia-500 to-pink-500", ring: "from-fuchsia-500/30 to-pink-500/30" },
];

const FAQS = [
  { icon: HelpCircle, question: "What does this repo do?", color: "text-indigo-300" },
  { icon: Compass, question: "Where is the entry point?", color: "text-fuchsia-300" },
  { icon: Layers, question: "How is the project structured?", color: "text-cyan-300" },
  { icon: Package, question: "What are the main dependencies?", color: "text-amber-300" },
  { icon: Terminal, question: "How do I run this locally?", color: "text-emerald-300" },
  { icon: FlaskConical, question: "Are there tests, and where?", color: "text-rose-300" },
];

const FEATURES = [
  { icon: Network, title: "Hybrid retrieval", desc: "Vector + keyword search, fused for precision", color: "text-indigo-300" },
  { icon: Layers, title: "Repo profile", desc: "Auto architecture diagram, onboarding & complexity", color: "text-cyan-300" },
  { icon: ShieldCheck, title: "Security scan", desc: "Flags leaked keys the moment you ingest", color: "text-emerald-300" },
  { icon: Github, title: "Private repos", desc: "Connect GitHub, chat with what only you can see", color: "text-fuchsia-300" },
];

interface Citation {
  filePath: string;
  startLine: number;
  endLine: number;
  language?: string;
  content?: string;
}

interface SecurityFinding {
  filePath: string;
  line: number;
  ruleId: string;
  description: string;
  snippet: string;
}

interface ChatTurn {
  question: string;
  answer: string;
  citations: Citation[];
  streaming: boolean;
  mode: ExplainerMode;
}

type IngestStatus = "idle" | "loading" | "ready" | "error";

function TypingDots() {
  return (
    <div className="flex items-center gap-1 py-1">
      <span className="typing-dot h-1.5 w-1.5 rounded-full bg-white/50" />
      <span className="typing-dot h-1.5 w-1.5 rounded-full bg-white/50" />
      <span className="typing-dot h-1.5 w-1.5 rounded-full bg-white/50" />
    </div>
  );
}

export default function RepoMindApp() {
  const [repoUrl, setRepoUrl] = useState("");
  const [repositoryId, setRepositoryId] = useState<string | null>(null);
  const [ingestStatus, setIngestStatus] = useState<IngestStatus>("idle");
  const [ingestMeta, setIngestMeta] = useState<{
    fileCount: number;
    chunkCount: number;
    sha: string;
    mode: "full" | "incremental" | "unchanged";
    filesChanged: number;
  } | null>(null);
  const [securityFindings, setSecurityFindings] = useState<SecurityFinding[]>([]);
  const [ingestError, setIngestError] = useState("");
  const [githubConnected, setGithubConnected] = useState(false);

  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);

  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [explainerMode, setExplainerMode] = useState<ExplainerMode>("technical");
  const [showFaq, setShowFaq] = useState(false);

  const [factIndex, setFactIndex] = useState(() => Math.floor(Math.random() * INGEST_FACTS.length));
  const [expandedCitations, setExpandedCitations] = useState<Set<string>>(new Set());
  const [copiedTurn, setCopiedTurn] = useState<number | null>(null);
  const [isNearBottom, setIsNearBottom] = useState(true);

  const scrollRef = useRef<HTMLDivElement>(null);
  const activeMode = MODES.find((m) => m.value === explainerMode)!;

  function toggleCitation(key: string) {
    setExpandedCitations((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function copyAnswer(turnIndex: number, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedTurn(turnIndex);
      window.setTimeout(() => setCopiedTurn(null), 1500);
    } catch {
      // clipboard API unavailable — non-fatal
    }
  }

  function scrollToBottom() {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }

  function handleChatScroll() {
    const el = scrollRef.current;
    if (!el) return;
    setIsNearBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
  }

  useEffect(() => {
    if (ingestStatus !== "loading") return;
    const id = window.setInterval(() => {
      setFactIndex((i) => (i + 1) % INGEST_FACTS.length);
    }, FACT_ROTATE_MS);
    return () => window.clearInterval(id);
  }, [ingestStatus]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(API_KEY_STORAGE_KEY);
      if (saved) setApiKey(saved);
      const savedMode = window.localStorage.getItem(MODE_STORAGE_KEY) as ExplainerMode | null;
      if (savedMode && MODES.some((m) => m.value === savedMode)) setExplainerMode(savedMode);
    } catch {
      // localStorage unavailable — non-fatal, preferences just won't persist
    }
  }, []);

  function handleModeChange(value: ExplainerMode) {
    setExplainerMode(value);
    try {
      window.localStorage.setItem(MODE_STORAGE_KEY, value);
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    if (isNearBottom) scrollToBottom();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turns]);

  function handleApiKeyChange(value: string) {
    setApiKey(value);
    try {
      window.localStorage.setItem(API_KEY_STORAGE_KEY, value);
    } catch {
      // ignore
    }
  }

  async function handleIngest(urlOverride?: string) {
    const url = urlOverride ?? repoUrl;
    if (!url.trim()) return;
    setRepoUrl(url);
    setIngestStatus("loading");
    setIngestError("");
    setRepositoryId(null);
    setTurns([]);

    try {
      const res = await fetch("/api/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoUrl: url }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Ingestion failed");
      setRepositoryId(data.repositoryId);
      setIngestMeta({
        fileCount: data.fileCount,
        chunkCount: data.chunkCount,
        sha: data.commitSha.slice(0, 7),
        mode: data.mode,
        filesChanged: data.filesChanged,
      });
      setSecurityFindings(data.securityFindings ?? []);
      setIngestStatus("ready");
    } catch (err: any) {
      setIngestError(err.message ?? "Something went wrong");
      setIngestStatus("error");
    }
  }

  async function handleAsk(questionOverride?: string) {
    const currentQuestion = questionOverride ?? question;
    if (!repositoryId || !currentQuestion.trim() || !apiKey.trim() || isStreaming) return;
    setQuestion("");
    setIsStreaming(true);

    setTurns((prev) => [...prev, { question: currentQuestion, answer: "", citations: [], streaming: true, mode: explainerMode }]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repositoryId, question: currentQuestion, apiKey, mode: explainerMode }),
      });

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      if (!reader) {
        setIsStreaming(false);
        return;
      }

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

          setTurns((prev) => {
            const last = prev[prev.length - 1];
            const updated: ChatTurn = { ...last };
            if (eventName === "token") updated.answer += data;
            if (eventName === "citations") updated.citations = data;
            if (eventName === "error") updated.answer += `\n\n⚠ ${data.message}`;
            return [...prev.slice(0, -1), updated];
          });
        }
      }
    } finally {
      setTurns((prev) => {
        const last = prev[prev.length - 1];
        if (!last) return prev;
        return [...prev.slice(0, -1), { ...last, streaming: false }];
      });
      setIsStreaming(false);
    }
  }

  function handleRegenerate(turnIndex: number) {
    const turn = turns[turnIndex];
    if (!turn || isStreaming) return;
    setTurns((prev) => prev.slice(0, turnIndex));
    handleAsk(turn.question);
  }

  const canAsk = !!repositoryId && !!apiKey.trim() && !isStreaming;

  return (
    <main className="mx-auto flex min-h-screen max-w-7xl flex-col gap-6 px-4 py-8 sm:px-6 lg:py-10">
      <header className="stagger-in flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="relative flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 via-fuchsia-500 to-cyan-400 shadow-lg shadow-fuchsia-500/30">
            <div className="absolute inset-0 animate-pulse rounded-2xl bg-gradient-to-br from-indigo-500 via-fuchsia-500 to-cyan-400 opacity-70 blur-md" />
            <Sparkles className="relative h-5 w-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="shimmer-text bg-gradient-to-r from-white via-fuchsia-200 to-white bg-clip-text text-lg font-semibold tracking-tight text-transparent">
                RepoMind
              </h1>
              <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white/40">
                Beta
              </span>
            </div>
            <p className="text-sm text-white/50">Chat with any GitHub repository</p>
          </div>
        </div>
        <GitHubConnectButton onStatusChange={setGithubConnected} />
      </header>

      <div className="grid flex-1 grid-cols-1 gap-6 lg:grid-cols-[400px_1fr]">
        {/* Sidebar */}
        <div className="flex flex-col gap-6">
          <section
            className="glow-border spotlight-card stagger-in relative overflow-hidden rounded-3xl border border-white/10 bg-[#0d0d14] p-5 shadow-xl"
            style={{ animationDelay: "0.05s" }}
            onMouseMove={handleSpotlight}
          >
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-fuchsia-400/50 to-transparent" />
            <div className="flex flex-col gap-3">
              <div className="relative">
                <Github className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
                <input
                  className="w-full rounded-xl border border-white/10 bg-black/20 py-2.5 pl-9 pr-3 text-sm text-white placeholder:text-white/30 outline-none transition focus:border-fuchsia-400/50 focus:ring-2 focus:ring-fuchsia-400/20"
                  placeholder="https://github.com/owner/repo"
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleIngest()}
                />
              </div>
              <button
                className="gradient-cta relative overflow-hidden flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 via-fuchsia-500 to-cyan-400 px-5 py-2.5 text-sm font-medium text-white shadow-lg shadow-fuchsia-500/20 disabled:cursor-not-allowed disabled:opacity-40"
                onClick={(e) => { createRipple(e); handleIngest(); }}
                disabled={!repoUrl.trim() || ingestStatus === "loading"}
              >
                {ingestStatus === "loading" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {ingestStatus === "loading" ? "Indexing…" : "Ingest repository"}
              </button>
            </div>

            {ingestStatus !== "idle" && (
              <div className="mt-3 text-sm">
                {ingestStatus === "loading" && (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-amber-300" />
                      <span className="text-white/50">Fetching files, chunking, and embedding…</span>
                    </div>
                    <div key={factIndex} className="fade-in flex items-start gap-2 rounded-lg bg-black/20 px-3 py-2 text-xs text-white/40">
                      <Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-fuchsia-300/70" />
                      <span>{INGEST_FACTS[factIndex]}</span>
                    </div>
                  </div>
                )}
                {ingestStatus === "ready" && ingestMeta && (
                  <div className="flex items-center gap-2">
                    <span key={`${ingestMeta.sha}-${ingestMeta.mode}`} className="pop-in shrink-0">
                      {ingestMeta.mode === "unchanged" ? (
                        <RefreshCw className="h-3.5 w-3.5 text-sky-400" />
                      ) : (
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                      )}
                    </span>
                    <span className="text-white/60">
                      {ingestMeta.mode === "unchanged" && (
                        <>Already up to date — <span className="font-medium text-white/90"><CountUp value={ingestMeta.fileCount} /></span> files /{" "}
                        <span className="font-medium text-white/90"><CountUp value={ingestMeta.chunkCount} /></span> chunks</>
                      )}
                      {ingestMeta.mode === "incremental" && (
                        <>Updated <span className="font-medium text-white/90"><CountUp value={ingestMeta.filesChanged} /></span> changed file
                        {ingestMeta.filesChanged === 1 ? "" : "s"} — <span className="font-medium text-white/90"><CountUp value={ingestMeta.fileCount} /></span> files /{" "}
                        <span className="font-medium text-white/90"><CountUp value={ingestMeta.chunkCount} /></span> chunks total</>
                      )}
                      {ingestMeta.mode === "full" && (
                        <>Indexed <span className="font-medium text-white/90"><CountUp value={ingestMeta.fileCount} /></span> files /{" "}
                        <span className="font-medium text-white/90"><CountUp value={ingestMeta.chunkCount} /></span> chunks</>
                      )}
                      <span className="text-white/30"> · {ingestMeta.sha}</span>
                    </span>
                  </div>
                )}
                {ingestStatus === "error" && (
                  <div className="flex items-center gap-2">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-400" />
                    <span className="text-red-300/90">{ingestError}</span>
                  </div>
                )}
              </div>
            )}
          </section>

          {githubConnected && <RepoPicker onSelect={(url) => handleIngest(url)} />}

          <section
            className="spotlight-card stagger-in rounded-3xl border border-white/10 bg-white/[0.03] p-5 shadow-xl backdrop-blur-sm"
            style={{ animationDelay: "0.12s" }}
            onMouseMove={handleSpotlight}
          >
            <div className="flex items-center gap-2 text-sm text-white/50">
              <KeyRound className="h-4 w-4" />
              <span>LLM API key</span>
            </div>
            <div className="mt-2 flex gap-2">
              <div className="relative flex-1">
                <input
                  type={showApiKey ? "text" : "password"}
                  className="w-full rounded-xl border border-white/10 bg-black/20 py-2 pl-3 pr-9 text-sm text-white placeholder:text-white/30 outline-none transition focus:border-fuchsia-400/50 focus:ring-2 focus:ring-fuchsia-400/20"
                  placeholder="Paste a free Groq API key"
                  value={apiKey}
                  onChange={(e) => handleApiKeyChange(e.target.value)}
                />
                <button
                  type="button"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60"
                  onClick={() => setShowApiKey((v) => !v)}
                  tabIndex={-1}
                >
                  {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <p className="mt-2 text-xs text-white/30">
              Stays only in this browser, sent only with your own chat requests. Get a free key at{" "}
              <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer" className="text-fuchsia-300/80 underline underline-offset-2 hover:text-fuchsia-300">
                console.groq.com/keys
              </a>
              .
            </p>

            <p className="mb-1.5 mt-4 text-xs font-medium uppercase tracking-wide text-white/30">Explain like I'm...</p>
            <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-black/20 p-1">
              {MODES.map(({ value, label, icon: Icon, gradient }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => handleModeChange(value)}
                  className={`flex flex-1 items-center justify-center gap-1 rounded-lg px-1.5 py-1.5 text-[11px] font-medium transition-all sm:gap-1.5 sm:px-3 sm:text-xs ${
                    explainerMode === value
                      ? `bg-gradient-to-r ${gradient} text-white shadow-sm scale-105`
                      : "text-white/40 hover:text-white/70"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{label}</span>
                </button>
              ))}
            </div>
          </section>

          {repositoryId && (
            <div className="stagger-in" style={{ animationDelay: "0.18s" }}>
              <RepoProfilePanel repositoryId={repositoryId} apiKey={apiKey} securityFindings={securityFindings} />
            </div>
          )}
        </div>

        {/* Main chat column */}
        <section
          className="glow-border stagger-in relative flex min-h-[70vh] flex-col overflow-hidden rounded-3xl border border-white/10 bg-[#0b0b12] shadow-2xl"
          style={{ animationDelay: "0.1s" }}
        >
          <div ref={scrollRef} onScroll={handleChatScroll} className="scrollbar-thin flex flex-1 flex-col gap-6 overflow-y-auto p-6">
            {turns.length === 0 && !repositoryId && (
              <div className="flex flex-1 flex-col items-center justify-center gap-8 py-6 text-center">
                <div className="space-y-2">
                  <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500/20 via-fuchsia-500/20 to-cyan-400/20">
                    <MessageSquareText className="h-8 w-8 text-fuchsia-300" />
                  </div>
                  <h2 className="shimmer-text bg-gradient-to-r from-white via-fuchsia-200 to-cyan-200 bg-clip-text text-2xl font-bold tracking-tight text-transparent">
                    Understand any codebase in minutes
                  </h2>
                  <p className="mx-auto max-w-sm text-sm text-white/40">
                    Paste a GitHub URL on the left to index it, then ask anything — with real
                    citations back to the source.
                  </p>
                </div>
                <div className="grid w-full max-w-lg grid-cols-1 gap-3 sm:grid-cols-2">
                  {FEATURES.map(({ icon: Icon, title, desc, color }, idx) => (
                    <div
                      key={title}
                      className="spotlight-card stagger-in flex items-start gap-3 rounded-2xl border border-white/10 bg-black/20 p-3.5 text-left transition hover:-translate-y-0.5 hover:border-white/20 hover:shadow-lg hover:shadow-fuchsia-500/10"
                      style={{ animationDelay: `${0.2 + idx * 0.08}s` }}
                      onMouseMove={handleSpotlight}
                    >
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/5">
                        <Icon className={`h-4 w-4 ${color}`} />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-white/80">{title}</p>
                        <p className="text-xs text-white/40">{desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {turns.length === 0 && repositoryId && (
              <div className="flex flex-1 flex-col items-center justify-center gap-6 py-10 text-center">
                <div className="space-y-1 text-white/30">
                  <MessageSquareText className="mx-auto h-8 w-8" />
                  <p className="text-sm">Ask something about this repository.</p>
                </div>
                {apiKey.trim() && (
                  <div className="w-full max-w-lg space-y-2">
                    <p className="text-xs font-medium uppercase tracking-wide text-white/30">Frequently asked</p>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {FAQS.map(({ icon: Icon, question, color }, idx) => (
                        <button
                          key={question}
                          type="button"
                          onClick={() => handleAsk(question)}
                          className="spotlight-card stagger-in flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2.5 text-left text-xs text-white/60 transition hover:-translate-y-0.5 hover:border-fuchsia-400/40 hover:bg-fuchsia-400/[0.06] hover:text-white/90"
                          style={{ animationDelay: `${idx * 0.05}s` }}
                          onMouseMove={handleSpotlight}
                        >
                          <Icon className={`h-3.5 w-3.5 shrink-0 ${color}`} />
                          {question}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {turns.map((turn, i) => {
              const turnMode = MODES.find((m) => m.value === turn.mode) ?? activeMode;
              const isLast = i === turns.length - 1;
              return (
                <div key={i} className="fade-in flex flex-col gap-3">
                  <div className="flex items-start justify-end gap-2.5">
                    <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-gradient-to-br from-indigo-500 to-fuchsia-500 px-4 py-2.5 text-sm text-white shadow-md">
                      {turn.question}
                    </div>
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/10">
                      <User className="h-3.5 w-3.5 text-white/70" />
                    </div>
                  </div>
                  <div className="group/msg flex items-start gap-2.5">
                    <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br ${turnMode.ring}`}>
                      <Bot className="h-3.5 w-3.5 text-white/90" />
                    </div>
                    <div className="max-w-[85%] rounded-2xl rounded-tl-sm border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/90">
                      {turn.streaming && turn.answer === "" ? (
                        <TypingDots />
                      ) : (
                        <div className={turn.streaming ? "streaming-cursor" : ""}>
                          <Markdown text={turn.answer} groupId={String(i)} citations={turn.citations} />
                        </div>
                      )}
                      {turn.citations.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {turn.citations.map((c, j) => {
                            const key = `${i}-${j}`;
                            const expanded = expandedCitations.has(key);
                            return (
                              <button
                                key={j}
                                id={`citation-${i}-${j + 1}`}
                                type="button"
                                onClick={() => toggleCitation(key)}
                                title={c.content ? "Click to preview" : undefined}
                                className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-[11px] transition-colors ${
                                  expanded
                                    ? "border-fuchsia-400/40 bg-fuchsia-400/10 text-fuchsia-200"
                                    : "border-white/10 bg-black/20 text-white/50 hover:border-fuchsia-400/30 hover:text-white/80"
                                }`}
                              >
                                <FileCode2 className="h-3 w-3" />
                                <span className="text-fuchsia-300/70">[{j + 1}]</span> {c.filePath}#L{c.startLine}-L{c.endLine}
                              </button>
                            );
                          })}
                        </div>
                      )}
                      {turn.citations.map((c, j) => {
                        const key = `${i}-${j}`;
                        if (!expandedCitations.has(key) || !c.content) return null;
                        return (
                          <div key={key} className="fade-in mt-2">
                            <CodeBlock code={c.content} lang={c.language} />
                          </div>
                        );
                      })}
                      {!turn.streaming && (
                        // Always visible (not hover-gated): opacity-0-until-hover has no
                        // equivalent on touch devices, which would make these unreachable on mobile.
                        <div className="mt-2 flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => copyAnswer(i, turn.answer)}
                            className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] text-white/30 transition hover:text-white/70"
                          >
                            {copiedTurn === i ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                            {copiedTurn === i ? "Copied" : "Copy"}
                          </button>
                          {isLast && (
                            <button
                              type="button"
                              onClick={() => handleRegenerate(i)}
                              disabled={isStreaming}
                              className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] text-white/30 transition hover:text-white/70 disabled:opacity-40"
                            >
                              <RotateCcw className="h-3 w-3" />
                              Regenerate
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {!isNearBottom && turns.length > 0 && (
            <button
              type="button"
              onClick={scrollToBottom}
              className="fade-in absolute bottom-24 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-white/10 bg-black/70 px-3 py-1.5 text-xs text-white/70 shadow-lg backdrop-blur-sm transition hover:bg-black/90"
            >
              <ArrowDown className="h-3.5 w-3.5" />
              Jump to latest
            </button>
          )}

          {repositoryId && turns.length > 0 && (
            <div className="border-t border-white/10 bg-black/10">
              <button
                type="button"
                onClick={() => setShowFaq((v) => !v)}
                className="flex w-full items-center justify-between px-4 py-2 text-xs text-white/40 transition hover:text-white/70"
              >
                <span className="flex items-center gap-1.5">
                  <HelpCircle className="h-3.5 w-3.5" /> Frequently asked
                </span>
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showFaq ? "rotate-180" : ""}`} />
              </button>
              {showFaq && (
                <div className="fade-in grid grid-cols-1 gap-2 px-4 pb-3 sm:grid-cols-2">
                  {FAQS.map(({ icon: Icon, question, color }) => (
                    <button
                      key={question}
                      type="button"
                      onClick={() => {
                        handleAsk(question);
                        setShowFaq(false);
                      }}
                      className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-left text-xs text-white/60 transition hover:border-fuchsia-400/40 hover:bg-fuchsia-400/[0.06] hover:text-white/90"
                    >
                      <Icon className={`h-3.5 w-3.5 shrink-0 ${color}`} />
                      {question}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="flex gap-2 border-t border-white/10 bg-black/10 p-4">
            <input
              className="flex-1 rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-white placeholder:text-white/30 outline-none transition focus:border-fuchsia-400/50 focus:ring-2 focus:ring-fuchsia-400/20 disabled:opacity-40"
              placeholder={
                !repositoryId ? "Ingest a repo first…" : !apiKey ? "Add your API key on the left…" : "Ask about this repo…"
              }
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAsk()}
              disabled={!canAsk}
            />
            <button
              className="gradient-cta relative overflow-hidden flex items-center justify-center rounded-xl bg-gradient-to-r from-indigo-500 via-fuchsia-500 to-cyan-400 px-4 py-2.5 text-white shadow-lg shadow-fuchsia-500/20 disabled:cursor-not-allowed disabled:opacity-40"
              onClick={(e) => { createRipple(e); handleAsk(); }}
              disabled={!canAsk || !question.trim()}
            >
              {isStreaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}
