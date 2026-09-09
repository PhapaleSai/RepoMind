import { NextRequest, NextResponse } from "next/server";
import { decryptToken, GH_TOKEN_COOKIE } from "@/lib/session";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const encrypted = req.cookies.get(GH_TOKEN_COOKIE)?.value;
  const token = encrypted ? decryptToken(encrypted) : null;
  if (!token) {
    return NextResponse.json({ error: "Not connected to GitHub" }, { status: 401 });
  }

  const res = await fetch(
    "https://api.github.com/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member",
    { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" } }
  );
  if (!res.ok) {
    return NextResponse.json({ error: "Failed to list repositories" }, { status: 502 });
  }

  const repos = await res.json();
  return NextResponse.json({
    repos: repos.map((r: any) => ({
      fullName: r.full_name,
      htmlUrl: r.html_url,
      isPrivate: r.private,
      description: r.description,
      language: r.language,
      updatedAt: r.updated_at,
      stars: r.stargazers_count,
    })),
  });
}
