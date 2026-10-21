import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client, Pool } from "pg";
import { runMigrations } from "../src/db/migrate";
import { seedFixtures, type SeedOptions } from "../src/db/fixtures";
import * as schema from "../src/db/schema";

/**
 * Wegwerf-Datenbank für den Smoke und die lokale Ansicht mit Fixtures. Admin-Zugang über
 * E2E_DATABASE_URL (lokale Docker-Postgres, kein Geheimnis); Standard passt zu .env.example.
 */
export const ADMIN_URL = process.env.E2E_DATABASE_URL ?? "postgresql://postgres:dev@localhost:55432/postgres";
/** Eigener Name je paralleler Arbeitskopie möglich (E2E_DB, muss auf "_e2e" enden). */
export const E2E_DB = process.env.E2E_DB ?? "dashboard_e2e";
if (!/^[a-z0-9_]+_e2e$/.test(E2E_DB)) throw new Error("E2E_DB muss aus a-z, 0-9, _ bestehen und auf _e2e enden.");

export function e2eDatabaseUrl(): string {
  const url = new URL(ADMIN_URL);
  url.pathname = `/${E2E_DB}`;
  return url.toString();
}

export async function recreateDatabase(): Promise<void> {
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  try {
    await admin.query(`drop database if exists ${E2E_DB} with (force)`);
    await admin.query(`create database ${E2E_DB}`);
  } finally {
    await admin.end();
  }
  await runMigrations({ databaseUrl: e2eDatabaseUrl(), migrationsFolder: path.join(__dirname, "..", "drizzle") });
}

export async function seed(options: SeedOptions = {}): Promise<void> {
  const pool = new Pool({ connectionString: e2eDatabaseUrl(), max: 1 });
  try {
    await seedFixtures(drizzle(pool, { schema }), options);
  } finally {
    await pool.end();
  }
}

/** Einzelne Abfrage gegen die Wegwerf-Datenbank (Prüfung von audit_log und Problemen in den Tests). */
export async function queryE2e<T extends Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const client = new Client({ connectionString: e2eDatabaseUrl() });
  await client.connect();
  try {
    return (await client.query(text, params)).rows as T[];
  } finally {
    await client.end();
  }
}
