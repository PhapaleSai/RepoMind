import { NextResponse } from "next/server";
import { GH_TOKEN_COOKIE } from "@/lib/session";

export const runtime = "nodejs";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(GH_TOKEN_COOKIE);
  return res;
}
