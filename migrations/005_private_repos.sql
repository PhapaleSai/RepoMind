-- OAuth / private repos (plan.md Phase 4). Private repo tokens are never stored here —
-- see lib/session.ts for why (encrypted, browser-side cookie only). This column is only
-- used to decide whether chat/profile requests need a live GitHub access check
-- (see lib/access.ts) — a plain repository visibility flag, not a secret.
ALTER TABLE repositories
  ADD COLUMN IF NOT EXISTS is_private BOOLEAN NOT NULL DEFAULT false;
