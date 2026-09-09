# RepoMind

Chat with any GitHub repository — public or private — with hybrid search, cited answers, a
generated architecture diagram/onboarding checklist/complexity estimate, and a static secret scan.
See `plan.md` for the full vision and what's still deferred.

Live at: https://repomind-chat.vercel.app

## Stack

- Next.js 14 (App Router) — frontend + API routes, one deployable app, hosted on Vercel
- [Insforge](https://insforge.dev) — Postgres + pgvector, used directly via a Postgres connection
  string for vector similarity search and full-text keyword search
- GitHub REST API — repo fetch and diff (no local git clone)
- Cohere `embed-english-v3.0` — embeddings (server-side key, free trial tier, no credit card)
- Any OpenAI-compatible chat API (default: [Groq](https://console.groq.com/keys), free tier) —
  bring-your-own-key, entered in the browser, never stored server-side; also used for the
  on-demand repo profile (diagram/onboarding/complexity)
- `mermaid` — client-side rendering of the generated architecture diagram

## Setup

1. **Create an Insforge project** at [insforge.dev](https://insforge.dev) and grab its Postgres
   connection string (Project settings → Database).
2. Copy `.env.example` to `.env.local` and fill in:
   - `INSFORGE_DATABASE_URL` — the connection string from step 1
   - `COHERE_API_KEY` — used server-side for embeddings (get one free, no card, at dashboard.cohere.com/api-keys)
   - `GITHUB_TOKEN` — optional, raises GitHub API rate limits for public repos
   - `SESSION_SECRET` — any random 32+ byte hex string, used to encrypt the GitHub OAuth token
     cookie (generate one with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`)
   - `GITHUB_OAUTH_CLIENT_ID` / `GITHUB_OAUTH_CLIENT_SECRET` — only needed for private-repo
     support. Create a GitHub OAuth App at github.com/settings/developers with callback URL
     `<your-deployed-url>/api/auth/github/callback`
   - `CRON_SECRET` — any random string, authenticates the daily cleanup cron job (see
     `vercel.json`); Vercel sends it automatically as the cron request's Authorization header
     once set as a project env var
3. Install dependencies and run the migrations:
   ```bash
   npm install
   npm run migrate
   ```
4. Start the dev server:
   ```bash
   npm run dev
   ```
5. Open http://localhost:3000, paste a GitHub repo URL, click **Ingest**, then paste a free
   [Groq API key](https://console.groq.com/keys) and start asking questions.

## Features

- **Ingestion**: fetches a public repo's code/key files (guardrails: ≤200 files, ≤4MB total),
  chunks by ~120-line windows (not AST-aware — see plan.md), embeds via Cohere, stores in Postgres.
- **Incremental re-ingestion**: re-ingesting an already-indexed repo checks the latest commit
  first; unchanged repos are a no-op, changed repos only re-embed the files GitHub's compare
  API says actually changed.
- **Hybrid chat retrieval**: dense vector search + Postgres full-text keyword search, fused via
  reciprocal rank fusion, with clickable `[n]` citations linking to file:line chips.
- **Explainer modes**: Technical / Beginner / Analogy toggle — same citations, different framing.
- **Repo Overview panel**: on-demand (BYOK) generation of a Mermaid architecture diagram, an
  onboarding checklist, and a confidence-scored complexity estimate, cached per repo.
- **Static security scan**: regex-based detection of committed secrets (AWS keys, private key
  blocks, provider-specific tokens, generic hardcoded API-key assignments) shown in the Overview
  panel — runs automatically during ingestion, no LLM cost.
- **Private repos**: "Connect GitHub" runs a real OAuth flow (`repo` scope). The access token is
  encrypted and kept only in your browser's cookies, never in the database. Chat and profile
  requests re-check live GitHub access on every call for private repos, so a leaked repository ID
  alone can't be used to read someone else's private repo content.
- **Repo picker**: once connected, browse and filter your own repos (with language/star/updated-time
  metadata) right in the sidebar instead of pasting a URL.
- **Adaptive answer length**: narrow questions get short, direct answers; open-ended ones ("help me
  understand this code") get a fuller structured breakdown — the model uses judgment, not a fixed cap.
- **24h data retention**: a repository is removed 24h after it was *last used* (not just last
  ingested) — a daily cron job plus an opportunistic sweep on every ingest keep Postgres storage
  bounded on the free tier.

## Known limits / deferred (see plan.md for the full breakdown)

- No AST-aware (tree-sitter) chunking yet
- No graph-traversal retrieval signal (hybrid is vector + keyword only, not + graph)
- No interactive onboarding quiz (checklist shipped, quiz didn't)
- Security scan only catches leaked secrets, not "missing auth" patterns
- Deployed on Vercel rather than Insforge's own Sites hosting, due to a confirmed bug in
  Insforge's deploy CLI (filed as feedback with their team)
