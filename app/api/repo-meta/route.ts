import { NextRequest, NextResponse } from "next/server";
import { parseGitHubUrl, fetchRepoMeta } from "@/lib/github";
import { decryptToken, GH_TOKEN_COOKIE } from "@/lib/session";

export const runtime = "nodejs";
export const maxDuration = 15;

export async function POST(req: NextRequest) {
  const { repoUrl } = await req.json();
  if (!repoUrl) {
    return NextResponse.json({ error: "repoUrl is required" }, { status: 400 });
  }

  const encrypted = req.cookies.get(GH_TOKEN_COOKIE)?.value;
  const accessToken = encrypted ? decryptToken(encrypted) ?? undefined : undefined;

  try {
    const ref = parseGitHubUrl(repoUrl);
    const meta = await fetchRepoMeta(ref, accessToken);
    return NextResponse.json({ meta });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Failed to fetch repo info" }, { status: 500 });
  }
}
