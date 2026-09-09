import crypto from "node:crypto";

// GitHub access tokens are kept out of Postgres entirely: they're encrypted (AES-256-GCM)
// and stored only in an HttpOnly, Secure session cookie in the user's own browser. This
// sidesteps building a full user-account/session-table system (this app has none) while
// still giving "AES-256 encrypted token storage" in spirit — the token just lives
// client-side rather than server-side, which also means we never have to think about
// revocation/cleanup for accounts that never existed.
const ALGO = "aes-256-gcm";

function getKey(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set");
  return crypto.createHash("sha256").update(secret).digest();
}

export function encryptToken(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString("base64url");
}

export function decryptToken(payload: string): string | null {
  try {
    const buf = Buffer.from(payload, "base64url");
    const iv = buf.subarray(0, 12);
    const authTag = buf.subarray(12, 28);
    const encrypted = buf.subarray(28);
    const decipher = crypto.createDecipheriv(ALGO, getKey(), iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export const GH_TOKEN_COOKIE = "repomind_gh_token";
export const GH_STATE_COOKIE = "repomind_gh_oauth_state";
