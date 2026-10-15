import path from "node:path";
import { EnvError, getEnv } from "@/env";
import { runMigrations } from "./migrate";

/**
 * Einstiegspunkt für den Containerstart (wird zu migrate.js gebündelt):
 * `node migrate.js && exec node server.js`. Gibt nie Verbindungsdaten aus.
 */
async function main() {
  // Gesamtes Schema prüfen: Fehlt ein Pflichtwert, bricht der Start hier ab (Spec dashboard-app),
  // statt dass der Container gesund wird und erst später scheitert.
  const { DATABASE_URL } = getEnv();
  const result = await runMigrations({
    databaseUrl: DATABASE_URL,
    migrationsFolder: path.join(process.cwd(), "drizzle"),
  });
  console.log(
    `Migrationen angewendet: ${result.applied}. Tenant ${result.tenantCreated ? "angelegt" : "vorhanden"}.`,
  );
}

main().catch((error: unknown) => {
  if (error instanceof EnvError) {
    console.error(error.message);
  } else {
    const code = (error as { code?: string } | null)?.code;
    console.error(`Migration fehlgeschlagen${code ? ` (${code})` : ""}.`);
  }
  process.exit(1);
});
