# 🚀 RepoMind — Ultimate AI-Powered GitHub Repository Analyst & Tutor
> **Transform any GitHub repository into an interactive, visual, and intelligent codebase tutor.**

---

## 🧭 Status: Phase 1 MVP in progress (deploying on Insforge)

The full vision below (6 architectural pillars, 5 phases) is the long-term target, but it's
too large to build in one pass. We're building a trimmed **Phase 1 MVP** first, deployed on
[Insforge](https://insforge.dev) (a Supabase-style agent-native BaaS — Postgres+pgvector, auth,
S3-compatible storage, edge functions, site hosting), and will layer Phases 2-5 on top once it works.

**What changed from the original plan, and why:**
* **No Celery/Redis.** Insforge's free tier (500MB DB, 1GB storage, $1 AI credit, pauses after
  1 week idle) is meant for lightweight apps, not a self-hosted worker fleet. MVP ingestion runs
  synchronously with hard caps on repo size (≤200 files, ≤4MB total) instead.
* **No FastAPI/Python backend.** Insforge's compute (edge functions) runs on Deno (JS/TS), so the
  whole app — frontend + API routes — is a single Next.js 14 app. Tree-sitter (Phase 2) has WASM
  builds that work fine from JS/TS, so this doesn't block the AST work later.
* **Naive line-window chunking, not AST-aware chunking.** Chunks are ~120-line windows with
  overlap, keeping real file:line ranges for citations. Tree-sitter boundary-aligned chunking
  (the original Enhancement #1) is deferred to Phase 2.
* **Pure dense vector search, not hybrid** — *superseded, see "Shipped" below: hybrid dense+keyword
  search has since shipped.* Graph traversal is still deferred.
* **Chat is bring-your-own-key.** Users paste their own LLM API key in the browser (never sent
  anywhere but their own chat request, stored only in localStorage) — the suggested default is a
  free [Groq](https://console.groq.com/keys) key, since Groq has a genuine free tier and an
  OpenAI-compatible chat API. This keeps RepoMind itself free to run. Embeddings are the one
  piece that isn't BYOK — they use a server-side `COHERE_API_KEY` (Cohere `embed-english-v3.0`,
  1024 dims, free trial tier, no credit card) since embeddings never go through the user-facing
  chat path. Two earlier providers were tried and dropped: Groq (no embedding models at all,
  despite an early web search suggesting otherwise) and Gemini's `gemini-embedding-001` (works
  in principle, but hit a Google Cloud project-level "denied access" 403 unrelated to API keys
  or code — a real account-gating issue in some regions/new accounts).
* **No AST-aware chunking yet** (Enhancement #1). Tree-sitter's WASM grammars are real to bundle
  reliably inside a Vercel serverless function; rather than ship something fragile, this stays
  on naive line-window chunking (still with accurate file:line citations) until it's worth the
  bundling risk.

**Shipped since the initial MVP:**
* **Deployed on Vercel, not Insforge Sites.** Insforge's own `deployments deploy` CLI path has a
  confirmed platform-side bug (upload stalls after 1-3 files, every attempt — filed as Insforge
  feedback `38fa7525`/`1cd7fa23`/`16ddd9d4`). The database (Postgres+pgvector) stays on Insforge;
  only frontend/API hosting moved to plain Vercel as a stopgap. Revisit once Insforge fixes it.
* **Incremental SHA-based re-ingestion** (Phase 5 Enhancement #4): re-ingesting an already-indexed
  repo first does a cheap latest-commit check; if unchanged, it's a no-op; if changed, GitHub's
  compare API (`/compare/{base}...{head}`) gets only the files that actually changed, and only
  those get re-chunked/re-embedded — see `lib/github.ts` (`fetchRepoDiff`) and `lib/ingest.ts`.
* **Multi-persona explainer modes** (Phase 3 Enhancement #5): Technical / Beginner / Analogy
  toggle in the UI, same retrieved context and citation rules, different system prompt framing —
  see `lib/llm.ts` (`ExplainerMode`).
* **Hybrid search** (Phase 2 Enhancement #2): dense vector search (pgvector cosine) fused with
  Postgres full-text keyword search via reciprocal rank fusion — see `lib/retrieval.ts`. Graph
  traversal (the third leg of the original plan) is still not implemented.
* **Repo profile: architecture diagram, onboarding checklist, complexity estimate**
  (Phase 3 Enhancement #3 + Phase 5 Enhancement #6, minus the interactive quiz): one BYOK LLM
  call generates a Mermaid architecture diagram, a short onboarding checklist, and a
  confidence-scored complexity estimate, cached on the repository row — see `lib/profile.ts`,
  `app/api/profile/route.ts`, `components/RepoProfilePanel.tsx`.
* **Static security audit** (Phase 5 Enhancement, "detecting leaked keys"): regex-based secret
  scanning (AWS keys, private key blocks, generic API-key assignments, provider-specific token
  formats) runs during ingestion, no LLM cost — see `lib/security.ts`. Only the "leaked keys"
  half of the original bullet; "missing auth" detection is not implemented.
* Suggested-question chips and a rotating facts/jokes strip during ingestion, for a more
  interactive feel while waiting.
* **OAuth / private repos** (Phase 4): "Connect GitHub" in the header runs a real GitHub OAuth
  flow (`repo` scope); the access token is encrypted (AES-256-GCM) and kept only in an HttpOnly
  browser cookie — never written to Postgres — since this app has no user-account/session table
  to store it against. Private-repo ingestion uses the Contents API instead of
  raw.githubusercontent.com (which doesn't reliably serve private blobs). Chat and profile
  generation re-verify live GitHub access on every request for private repos (`lib/access.ts`),
  since a bare `repositoryId` alone proves nothing about who's allowed to see it — see
  `lib/session.ts`, `lib/github.ts`, `app/api/auth/github/*`.
* **UI redesign**: sidebar + main-chat layout, a feature-grid landing state before any repo is
  ingested, gradient branding, message avatars, and micro-animations — see `components/RepoMindApp.tsx`.
* **Repo picker**: a "Browse your repositories" card in the sidebar (once GitHub is connected)
  listing your public/private repos with language/star/updated-time metadata — click one to ingest
  it directly, no need to know or paste the URL — see `components/RepoPicker.tsx`,
  `app/api/auth/github/repos/route.ts`.
* **Chat interactivity**: expandable inline code previews (click a `[n]` citation to see the actual
  snippet in the conversation, not just scroll to it), copy buttons on messages and code blocks,
  a Regenerate action on the latest answer, and a "jump to latest" control when scrolled up mid-read
  — see `components/Markdown.tsx`, `components/RepoMindApp.tsx`.
* **Adaptive answer length**: replaced a flat "always 5-6 sentences" rule with judgment — narrow
  questions get short answers, open-ended ones ("help me understand this code", "give me an
  overview") get a fuller structured breakdown by component — see `lib/llm.ts` (`BREVITY_RULE`).
* **24h data retention**: repositories (and their embeddings) are removed 24h after they were last
  actually used — ingested, chatted with, or profiled — not just 24h after ingestion, so an
  actively-used repo doesn't vanish mid-session. Enforced by a daily Vercel Cron job
  (`app/api/cron/cleanup`) plus an opportunistic sweep on every ingest as a fallback, so storage
  stays within Insforge's free-tier cap even if the cron misfires — see `lib/cleanup.ts`.

**Not implemented, and not silently faked:**
* Tree-sitter AST-aware chunking (WASM bundling risk on Vercel serverless)
* Graph traversal as a third retrieval signal alongside vector + keyword
* Interactive comprehension quiz (onboarding checklist shipped; the quiz part didn't)
* "Missing auth" detection in the security audit (only leaked-secret detection shipped)

See `README.md` for setup instructions.

---

## 🎯 Executive Summary & Enhanced Vision

**RepoMind** is an enterprise-grade AI Repository Analyst and Onboarding Assistant. It enables developers, tech leads, code reviewers, and beginners to instantly understand, query, visualize, and analyze any public or private GitHub repository.

While traditional tools perform naive text search or dump raw files into an LLM, **RepoMind** builds a **Hierarchical Code Knowledge Graph**, utilizes **AST-aware semantic code chunking**, generates **dynamic interactive visual architecture diagrams**, provides **line-level code evidence citations**, and delivers **tailored explanation modes** (Technical, Beginner, Real-World Analogy).

---

## 💡 Key Architectural Enhancements (Upgrading to 10/10)

To make this project stand out as a top 1% engineering portfolio piece, we introduce 6 critical architectural innovations:

### 1. 🧬 AST-Aware Code Chunking (Tree-sitter Integration)
* **Problem with standard RAG:** Naive chunking (e.g. fixed 500 characters) cuts functions, classes, and logic in half, destroying context.
* **RepoMind Solution:** Use `tree-sitter` to parse code into its Abstract Syntax Tree (AST). Chunks are boundary-aligned to classes, functions, route handlers, and type definitions, preserving intact function signatures and docstrings.

### 2. 🕸️ Hierarchical Repository Knowledge Graph + Hybrid Search
* **Level 1 (Repo Architecture Skeleton):** Graph mapping routes, services, imports, and database models (`Route -> Service -> DB Model`).
* **Level 2 (Directory & File Summaries):** High-level summary of every folder and module generated during clone.
* **Level 3 (AST Code Chunks):** Vector embeddings of individual AST nodes.
* **Hybrid Retrieval:** Dense vector search (`pgvector`) combined with BM25 sparse keyword search and graph traversal for 95%+ precision on complex queries ("Where is auth middleware applied?").

### 3. 🎨 Interactive Visual Architecture & Sequence Diagram Generator
* Automatically synthesizes dynamic **Mermaid.js** diagrams:
  * **System Architecture** (Frontend, Backend, DB, Worker, External APIs)
  * **Data Flow / Sequence Diagrams** (e.g., User Login request path)
  * **Entity Relationship Diagram (ERD)** for database schemas
* Clicking any node in the UI highlights corresponding files and scopes AI context to that specific component.

### 4. ⚡ Incremental Commit-Hash SHA Caching
* Repositories are cached by commit `SHA`.
* Re-analyzing an updated repo only parses modified files (`git diff`), eliminating wasteful vector re-embedding and LLM processing costs.

### 5. 🎯 Multi-Persona Explainer Engine & Code Evidence Citations
* **Explanation Modes:**
  * **Technical Mode:** Deep architectural terms, design patterns, exact route names.
  * **Beginner Mode:** Simplified breakdown, straightforward language.
  * **Real-World Analogy Mode:** Restaurant, Airport, City Planning, or Traffic Control analogies.
* **Line-Level Citations:** Every answer cites direct GitHub permalinks (e.g., `src/auth/jwt.py#L24-L58`) with expandable inline code previews.

### 6. 🎓 Onboarding Developer Guide & Complexity Estimator
* Generates a step-by-step **New Developer Onboarding Checklist**:
  1. *Start reading here:* Entry point (`src/main.py`)
  2. *Core concepts to learn:* Pydantic models, FastAPI DI, Redis queues
  3. *Interactive Comprehension Quiz:* Test understanding of the repository.
* **Confidence-Scored Complexity & Effort Matrix:** Estimates developer-weeks required with breakdown of frontend/backend/DevOps effort and explicit confidence ratings.

---

## 📐 System Architecture Diagram

```text
                               ┌────────────────────────────────┐
                               │           Web Client           │
                               │  Next.js 14 + Tailwind + TS    │
                               │  Mermaid.js + Streaming SSE    │
                               └───────────────┬────────────────┘
                                               │ HTTP / SSE / WS
                                               ▼
                               ┌────────────────────────────────┐
                               │      FastAPI Backend Gateway   │
                               │   Auth, Rate-Limit, REST API   │
                               └───────────────┬────────────────┘
                                               │
                                               ▼
                              ┌──────────────────────────────────┐
                              │    Async Task Queue (Celery)     │
                              └────────────────┬─────────────────┘
                                               │
               ┌───────────────────────────────┴───────────────────────────────┐
               ▼                                                               ▼
 ┌───────────────────────────┐                                   ┌───────────────────────────┐
 │   Repository Fetcher      │                                   │    Repository Analyzer    │
 │                           │                                   │                           │
 │ • GitHub REST / GraphQL   │                                   │ • Language/Framework Sync │
 │ • Selective Sparse Clone  │                                   │ • Tree-sitter AST Parsing │
 │ • Metadata & File Audit   │                                   │ • Graph Structure Builder │
 └─────────────┬─────────────┘                                   └─────────────┬─────────────┘
               │                                                               │
               └───────────────────────────────┬───────────────────────────────┘
                                               │
                                               ▼
                               ┌────────────────────────────────┐
                               │      Embedding & Indexing      │
                               │ • Text-Embedding-3 / BGE       │
                               │ • PostgreSQL + pgvector        │
                               └───────────────┬────────────────┘
                                               │
                                               ▼
                               ┌────────────────────────────────┐
                               │     RAG & AI Reasoning Agent   │
                               │ • Hybrid Graph + Vector Search  │
                               │ • Multi-Provider (Grok/OpenAI) │
                               │ • Prompt Budgeting & Citation  │
                               └────────────────────────────────┘
```

---

## 🛠️ Recommended Technology Stack

| Layer | Technology Choice | Key Rationale |
|---|---|---|
| **Frontend** | **Next.js 14 (App Router), TypeScript, Tailwind CSS, Shadcn UI** | High performance, server components, sleek developer dashboard experience |
| **Visualizations** | **Mermaid.js, React Flow** | Dynamic rendering of interactive architecture graphs and sequence flow diagrams |
| **Backend API** | **FastAPI (Python 3.11+)** | High-concurrency async Python framework, seamless integration with AI/ML tools |
| **Task Worker** | **Celery / Redis** | Asynchronous job execution for cloning, AST parsing, and vector embedding |
| **Code Parser** | **Tree-sitter (Python bindings)** | Accurate AST parsing for Python, TypeScript, JavaScript, Go, Rust, Java, C++ |
| **Database & Vectors**| **PostgreSQL 16 + pgvector** | Unified relational metadata storage and high-speed vector similarity search |
| **AI Layer** | **LangChain / LlamaIndex core + Custom Providers** | Support Grok (xAI), OpenAI, Anthropic, Ollama local fallback |
| **Authentication** | **NextAuth.js / GitHub OAuth** | Secure authentication with encrypted OAuth token vault for private repos |

---

## 🗺️ Step-by-Step Development Roadmap

### Phase 1: MVP Foundations (Public Repo Ingestion & Direct Context Chat)
* [ ] Setup Next.js 14 frontend and FastAPI backend structure.
* [ ] Build GitHub Repository Fetcher for public repos (GitHub API + sparse fetch).
* [ ] Implement key file extractor (`README.md`, `package.json`, `requirements.txt`, `Dockerfile`, `.env.example`).
* [ ] Build initial Repo Profile summary prompt & basic SSE streaming chatbot.

### Phase 2: Intelligence & AST-Aware RAG Engine
* [ ] Integrate `pgvector` extension in PostgreSQL.
* [ ] Implement `tree-sitter` AST code chunking pipeline for JS/TS/Python.
* [ ] Create hybrid retrieval engine (Dense vector search + BM25 keyword matching).
* [ ] Add citation tracking (mapping LLM text snippets to target file line numbers).

### Phase 3: Visual Analytics & Explainer Modes
* [ ] Implement dynamic Mermaid.js architecture diagram generation backend & UI viewer.
* [ ] Build Explainer Mode toggles: Technical, Beginner, Real-World Analogy.
* [ ] Implement Development Effort & Complexity Estimator with confidence scoring.

### Phase 4: GitHub OAuth & Private Repositories
* [ ] Setup NextAuth GitHub OAuth login flow.
* [ ] Implement AES-256 encrypted access token storage in PostgreSQL.
* [ ] Add private repo selector and access permissions management.

### Phase 5: Developer Onboarding & Advanced Features
* [ ] Auto-generate "New Developer Onboarding Checklist" and interactive code quiz.
* [ ] Implement incremental git SHA indexing to avoid re-embedding unchanged files.
* [ ] Add automated Static Security Audit layer (detecting leaked keys, missing auth).

---

## 🗄️ Core Database Schema (PostgreSQL + pgvector)

```sql
-- Repositories Table
CREATE TABLE repositories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    github_id BIGINT UNIQUE NOT NULL,
    full_name VARCHAR(255) NOT NULL, -- e.g. "owner/repo"
    is_private BOOLEAN DEFAULT FALSE,
    default_branch VARCHAR(100) DEFAULT 'main',
    commit_sha VARCHAR(40) NOT NULL,
    metadata JSONB, -- stars, forks, languages, license
    profile_summary JSONB, -- tech stack, complexity, architecture overview
    status VARCHAR(50) DEFAULT 'pending', -- pending, indexing, ready, error
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Code Chunks & Embeddings Table
CREATE TABLE code_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    repository_id UUID REFERENCES repositories(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    language VARCHAR(50),
    chunk_type VARCHAR(50), -- function, class, route, config, summary
    symbol_name VARCHAR(255),
    start_line INT NOT NULL,
    end_line INT NOT NULL,
    content TEXT NOT NULL,
    embedding vector(1536), -- Vector embedding (OpenAI / BGE size)
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX code_chunks_embedding_idx ON code_chunks 
USING hnsw (embedding vector_cosine_ops);
```

---

## 📌 Summary of Enhancements

By evolving the project from a simple chat interface into **RepoMind**, you demonstrate mastery over:
1. **Advanced AI & RAG:** AST parsing, hybrid search, citation tracking, token budgeting.
2. **Systems Architecture:** Asynchronous queues, background processing, vector databases, incremental sync.
3. **Full-Stack Craftsmanship:** Next.js 14, FastAPI, interactive graphs, sleek responsive UI/UX.
4. **Product Thinking:** Developer onboarding, multi-persona explanations, security audits, confidence-scored metrics.
