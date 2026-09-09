import { Pool } from "pg";

// Insforge exposes a standard Postgres connection string alongside its REST API.
// We use it directly here for pgvector similarity search (ORDER BY embedding <=>),
// which is awkward to express through the PostgREST-style SDK query builder.
let pool: Pool | undefined;

export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.INSFORGE_DATABASE_URL;
    if (!connectionString) {
      throw new Error("INSFORGE_DATABASE_URL is not set");
    }
    pool = new Pool({ connectionString, max: 5 });
  }
  return pool;
}
