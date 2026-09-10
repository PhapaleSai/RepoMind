import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT id, repo_full_name, question, answer, citations, mode, created_at FROM shared_answers WHERE id = $1`,
    [params.id]
  );
  const row = rows[0];
  if (!row) {
    return NextResponse.json({ error: "This shared answer doesn't exist or was removed" }, { status: 404 });
  }

  return NextResponse.json({
    id: row.id,
    repoFullName: row.repo_full_name,
    question: row.question,
    answer: row.answer,
    citations: row.citations,
    mode: row.mode,
    createdAt: row.created_at,
  });
}
