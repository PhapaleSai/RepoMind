import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const connectionString = process.env.INSFORGE_DATABASE_URL;

if (!connectionString) {
  console.error("INSFORGE_DATABASE_URL is not set");
  process.exit(1);
}

const migrationsDir = path.join(__dirname, "..", "migrations");
const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

const pool = new pg.Pool({ connectionString });
try {
  // Tracks which migration files have already run, so re-running this script (e.g. after
  // adding a new migration) doesn't replay old, non-idempotent ALTER statements against a
  // schema that's already moved past them.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ DEFAULT now()
    )
  `);

  const { rows } = await pool.query(`SELECT filename FROM schema_migrations`);
  const applied = new Set(rows.map((r) => r.filename));

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`Skipping ${file} (already applied)`);
      continue;
    }
    const sql = readFileSync(path.join(migrationsDir, file), "utf8");
    await pool.query(sql);
    await pool.query(`INSERT INTO schema_migrations (filename) VALUES ($1)`, [file]);
    console.log(`Applied ${file}`);
  }
} finally {
  await pool.end();
}
