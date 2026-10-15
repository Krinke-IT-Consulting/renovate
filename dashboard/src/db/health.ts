import fs from "node:fs";
import path from "node:path";
import { Pool } from "pg";
import { getEnvFor } from "@/env";

let pool: Pool | undefined;

function getPool(): Pool {
  pool ??= new Pool({
    connectionString: getEnvFor("DATABASE_URL").DATABASE_URL,
    max: 2,
    connectionTimeoutMillis: 3000,
    query_timeout: 3000,
  });
  return pool;
}

type Journal = { entries: { when: number }[] };

function readJournal(): { count: number; latest: number } {
  const file = path.join(process.cwd(), "drizzle", "meta", "_journal.json");
  const journal = JSON.parse(fs.readFileSync(file, "utf8")) as Journal;
  return {
    count: journal.entries.length,
    latest: Math.max(0, ...journal.entries.map((e) => e.when)),
  };
}

/**
 * Gesund heißt: Datenbank erreichbar und alle Migrationen des Journals sind angewendet.
 * GitHub und Renovate CE gehen bewusst nicht ein (Spec "Gesundheitszustand").
 */
export async function isHealthy(): Promise<boolean> {
  try {
    const journal = readJournal();
    const res = await getPool().query<{ n: string; latest: string | null }>(
      "select count(*) as n, max(created_at) as latest from drizzle.__drizzle_migrations",
    );
    const row = res.rows[0];
    return Number(row?.n) === journal.count && Number(row?.latest) === journal.latest;
  } catch {
    return false;
  }
}
