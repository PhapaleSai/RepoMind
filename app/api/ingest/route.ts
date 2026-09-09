import { NextRequest, NextResponse } from "next/server";
import { ingestRepository } from "@/lib/ingest";
import { decryptToken, GH_TOKEN_COOKIE } from "@/lib/session";

export const runtime = "nodejs";
// Vercel Hobby plan caps serverless functions at 300s; our own MAX_FILES/MAX_TOTAL_BYTES
// guardrails in lib/github.ts keep real ingestion runs well under that anyway.
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const { repoUrl } = await req.json();
  if (!repoUrl || typeof repoUrl !== "string") {
    return NextResponse.json({ error: "repoUrl is required" }, { status: 400 });
  }

  const encrypted = req.cookies.get(GH_TOKEN_COOKIE)?.value;
  const accessToken = encrypted ? decryptToken(encrypted) ?? undefined : undefined;

  try {
    const result = await ingestRepository(repoUrl, accessToken);
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Ingestion failed" }, { status: 500 });
  }
}
