import { NextRequest, NextResponse } from "next/server";
import { getOrBuildRepoProfile } from "@/lib/profile";
import { assertRepoAccess, AccessDeniedError } from "@/lib/access";
import { decryptToken, GH_TOKEN_COOKIE } from "@/lib/session";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const { repositoryId, apiKey, baseUrl, model, force } = await req.json();
  if (!repositoryId || !apiKey) {
    return NextResponse.json({ error: "repositoryId and apiKey are required" }, { status: 400 });
  }

  const encrypted = req.cookies.get(GH_TOKEN_COOKIE)?.value;
  const accessToken = encrypted ? decryptToken(encrypted) ?? undefined : undefined;

  try {
    await assertRepoAccess(repositoryId, accessToken);
    const profile = await getOrBuildRepoProfile(repositoryId, { apiKey, baseUrl, model }, !!force);
    return NextResponse.json({ profile });
  } catch (err: any) {
    const status = err instanceof AccessDeniedError ? 403 : 500;
    return NextResponse.json({ error: err.message ?? "Profile generation failed" }, { status });
  }
}
