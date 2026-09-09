import { NextRequest, NextResponse } from "next/server";
import { cleanupStaleRepositories } from "@/lib/cleanup";

export const runtime = "nodejs";
export const maxDuration = 30;

// Triggered daily by Vercel Cron (see vercel.json). Vercel doesn't sign cron requests
// itself on Hobby projects, so this checks a shared secret the cron config sends as a
// bearer token — without it, anyone who found this URL could hammer the DB for free.
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const removed = await cleanupStaleRepositories();
  return NextResponse.json({ removed });
}
