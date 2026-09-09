import { NextRequest, NextResponse } from "next/server";
import { decryptToken, GH_TOKEN_COOKIE } from "@/lib/session";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const encrypted = req.cookies.get(GH_TOKEN_COOKIE)?.value;
  if (!encrypted) return NextResponse.json({ connected: false });

  const token = decryptToken(encrypted);
  if (!token) return NextResponse.json({ connected: false });

  const res = await fetch("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
  });
  if (!res.ok) return NextResponse.json({ connected: false });

  const user = await res.json();
  return NextResponse.json({ connected: true, login: user.login, avatarUrl: user.avatar_url });
}
