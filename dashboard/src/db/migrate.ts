import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";

/** Beliebige, feste Schlüsselnummer für pg_advisory_lock; nur dieser Code nutzt sie. */
export const MIGRATION_LOCK_KEY = 7_260_011_001;
export const DEFAULT_TENANT_NAME = "Krinke IT";

export type MigrationResult = {
  /** Anzahl der in diesem Lauf neu angewendeten Migrationen. */
  applied: number;
  /** true, wenn der Tenant in diesem Lauf angelegt wurde. */
  tenantCreated: boolean;
};

async function migrationCount(client: Client): Promise<number> {
  const exists = await client.query<{ t: string | null }>(
    "select to_regclass('drizzle.__drizzle_migrations') as t",
  );
  if (!exists.rows[0]?.t) return 0;
  const res = await client.query<{ n: string }>(
    "select count(*) as n from drizzle.__drizzle_migrations",
  );
  return Number(res.rows[0]?.n ?? 0);
}

/**
 * Wendet alle Migrationen an und legt den Standard-Tenant an, falls es noch keinen Tenant gibt.
 * Der gesamte Ablauf läuft unter pg_advisory_lock: Starten zwei Instanzen gleichzeitig, wartet die
 * zweite, bis die erste fertig ist, und findet dann nichts mehr zu tun.
 */
export async function runMigrations(options: {
  databaseUrl: string;
  migrationsFolder: string;
}): Promise<MigrationResult> {
  const client = new Client({ connectionString: options.databaseUrl });
  await client.connect();
  try {
    await client.query("select pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    try {
      const before = await migrationCount(client);
      const db = drizzle(client);
      await migrate(db, { migrationsFolder: options.migrationsFolder });
      const after = await migrationCount(client);

      // Nur anlegen, wenn die Tabelle leer ist: ein umbenannter Tenant bleibt unangetastet.
      const inserted = await client.query(
        "insert into tenants (name) select $1::text where not exists (select 1 from tenants)",
        [DEFAULT_TENANT_NAME],
      );

      return { applied: after - before, tenantCreated: (inserted.rowCount ?? 0) > 0 };
    } finally {
      await client.query("select pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]);
    }
  } finally {
    await client.end();
  }
}
