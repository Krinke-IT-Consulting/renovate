import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { getEnvFor } from "@/env";
import * as schema from "./schema";

/** `$client` ist der Pool (für Advisory-Locks auf einer dedizierten Verbindung). */
export type Db = NodePgDatabase<typeof schema> & { $client: Pool };

let pool: Pool | undefined;
let db: Db | undefined;

/** Gemeinsamer Pool des Serverprozesses; wird erst beim ersten Zugriff angelegt (nie beim Build). */
export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: getEnvFor("DATABASE_URL").DATABASE_URL,
      // Drei Abgleich-Sperren (github, ce, problems) halten je eine Verbindung für die Laufzeit.
      max: 10,
      connectionTimeoutMillis: 5000,
    });
    // Ohne Handler beendet ein Fehler auf einer Leerlauf-Verbindung (etwa DB-Neustart) den
    // Prozess. Der Pool verwirft die Verbindung selbst; geloggt wird nur die Kategorie, nie Werte.
    pool.on("error", () => {
      console.error("Datenbank: Leerlauf-Verbindung im Pool verloren (wird neu aufgebaut).");
    });
  }
  return pool;
}

export function getDb(): Db {
  db ??= drizzle(getPool(), { schema });
  return db;
}

/** Für Tests: Pool schließen und den Singleton zurücksetzen. */
export async function closeDb(): Promise<void> {
  const p = pool;
  pool = undefined;
  db = undefined;
  await p?.end();
}
