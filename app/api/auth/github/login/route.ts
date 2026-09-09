import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { GH_STATE_COOKIE } from "@/lib/session";

export const runtime = "nodejs";

// "repo" scope is required to read private repos (GitHub has no read-only-private-code
// scope narrower than this). Public repos never need this flow at all.
export async function GET(req: NextRequest) {
  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json({ error: "GITHUB_OAUTH_CLIENT_ID is not set" }, { status: 500 });
  }

  const state = crypto.randomBytes(16).toString("hex");
  const redirectUri = `${req.nextUrl.origin}/api/auth/github/callback`;

  const authorizeUrl = new URL("https://github.com/login/oauth/authorize");
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("scope", "repo");
  authorizeUrl.searchParams.set("state", state);

  const res = NextResponse.redirect(authorizeUrl);
  res.cookies.set(GH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  return res;
}
