import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 15;

export async function POST(req: NextRequest) {
  const { repoFullName, question, answer, citations, mode } = await req.json();
  if (!repoFullName || !question || !answer) {
    return NextResponse.json({ error: "repoFullName, question, and answer are required" }, { status: 400 });
  }

  const id = crypto.randomBytes(6).toString("base64url");
  const pool = getPool();
  await pool.query(
    `INSERT INTO shared_answers (id, repo_full_name, question, answer, citations, mode) VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, repoFullName, question, answer, JSON.stringify(citations ?? []), mode ?? "technical"]
  );

  return NextResponse.json({ id });
}
