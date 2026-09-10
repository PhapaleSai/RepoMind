import { NextRequest, NextResponse } from "next/server";
import { scanDependencies } from "@/lib/vulnerabilities";
import { assertRepoAccess, AccessDeniedError } from "@/lib/access";
import { decryptToken, GH_TOKEN_COOKIE } from "@/lib/session";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const { repositoryId } = await req.json();
  if (!repositoryId) {
    return NextResponse.json({ error: "repositoryId is required" }, { status: 400 });
  }

  const encrypted = req.cookies.get(GH_TOKEN_COOKIE)?.value;
  const accessToken = encrypted ? decryptToken(encrypted) ?? undefined : undefined;

  try {
    await assertRepoAccess(repositoryId, accessToken);
    const vulnerabilities = await scanDependencies(repositoryId);
    return NextResponse.json({ vulnerabilities });
  } catch (err: any) {
    const status = err instanceof AccessDeniedError ? 403 : 500;
    return NextResponse.json({ error: err.message ?? "Dependency scan failed" }, { status });
  }
}
