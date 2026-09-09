import { NextRequest, NextResponse } from "next/server";
import { encryptToken, GH_STATE_COOKIE, GH_TOKEN_COOKIE } from "@/lib/session";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const expectedState = req.cookies.get(GH_STATE_COOKIE)?.value;

  if (!code || !state || !expectedState || state !== expectedState) {
    return NextResponse.redirect(new URL("/?auth_error=state_mismatch", req.url));
  }

  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.redirect(new URL("/?auth_error=not_configured", req.url));
  }

  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: `${req.nextUrl.origin}/api/auth/github/callback`,
    }),
  });

  const tokenJson = await tokenRes.json();
  if (!tokenJson.access_token) {
    return NextResponse.redirect(new URL("/?auth_error=token_exchange_failed", req.url));
  }

  const res = NextResponse.redirect(new URL("/", req.url));
  res.cookies.set(GH_TOKEN_COOKIE, encryptToken(tokenJson.access_token), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  });
  res.cookies.delete(GH_STATE_COOKIE);
  return res;
}
