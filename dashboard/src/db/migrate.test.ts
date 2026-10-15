import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_TENANT_NAME, runMigrations } from "./migrate";

/**
 * Integrationstest gegen eine echte Postgres (DATABASE_URL). Ohne die Variable wird übersprungen.
 * Jeder Lauf legt eine eigene Wegwerf-Datenbank an (braucht das Recht CREATEDB) und löscht sie wieder.
 */
const adminUrl = process.env.DATABASE_URL;
const migrationsFolder = path.join(process.cwd(), "drizzle");
const journal = JSON.parse(
  fs.readFileSync(path.join(migrationsFolder, "meta", "_journal.json"), "utf8"),
) as { entries: unknown[] };

describe.skipIf(!adminUrl)("runMigrations (Postgres)", () => {
  const dbName = `dashboard_test_${randomBytes(6).toString("hex")}`;
  let testUrl = "";

  function withDatabase(name: string): string {
    const url = new URL(adminUrl as string);
    url.pathname = `/${name}`;
    return url.toString();
  }

  async function admin<T>(fn: (c: Client) => Promise<T>): Promise<T> {
    const client = new Client({ connectionString: adminUrl });
    await client.connect();
    try {
      return await fn(client);
    } finally {
      await client.end();
    }
  }

  beforeAll(async () => {
    await admin((c) => c.query(`create database "${dbName}"`));
    testUrl = withDatabase(dbName);
  });

  afterAll(async () => {
    await admin((c) => c.query(`drop database if exists "${dbName}" with (force)`));
  });

  it("wendet bei zwei gleichzeitigen Läufen jede Migration genau einmal an", async () => {
    const results = await Promise.all([
      runMigrations({ databaseUrl: testUrl, migrationsFolder }),
      runMigrations({ databaseUrl: testUrl, migrationsFolder }),
    ]);

    // Ein Lauf wendet alles an, der andere nichts mehr.
    expect(results.map((r) => r.applied).sort((a, b) => a - b)).toEqual([0, journal.entries.length]);

    const client = new Client({ connectionString: testUrl });
    await client.connect();
    try {
      const rows = await client.query("select hash from drizzle.__drizzle_migrations");
      expect(rows.rowCount).toBe(journal.entries.length);
      expect(new Set(rows.rows.map((r: { hash: string }) => r.hash)).size).toBe(journal.entries.length);
    } finally {
      await client.end();
    }
  });

  it("legt den Tenant genau einmal an, auch bei Wiederholung", async () => {
    const again = await runMigrations({ databaseUrl: testUrl, migrationsFolder });
    expect(again).toEqual({ applied: 0, tenantCreated: false });

    const client = new Client({ connectionString: testUrl });
    await client.connect();
    try {
      const res = await client.query("select name from tenants");
      expect(res.rows).toEqual([{ name: DEFAULT_TENANT_NAME }]);
    } finally {
      await client.end();
    }
  });

  it("legt alle Tabellen aus dem Datenmodell an", async () => {
    const client = new Client({ connectionString: testUrl });
    await client.connect();
    try {
      const res = await client.query<{ table_name: string }>(
        "select table_name from information_schema.tables where table_schema = 'public' order by 1",
      );
      expect(res.rows.map((r) => r.table_name)).toEqual([
        "audit_log",
        "http_cache",
        "platform_connections",
        "problems",
        "pull_requests",
        "renovate_jobs",
        "repositories",
        "rollout_actions",
        "sync_state",
        "tenants",
      ]);
    } finally {
      await client.end();
    }
  });

  async function withClient<T>(fn: (c: Client) => Promise<T>): Promise<T> {
    const client = new Client({ connectionString: testUrl });
    await client.connect();
    try {
      return await fn(client);
    } finally {
      await client.end();
    }
  }

  it("legt den Tenant nach einer Umbenennung nicht erneut an", async () => {
    await withClient((c) => c.query("update tenants set name = 'Umbenannt'"));
    const again = await runMigrations({ databaseUrl: testUrl, migrationsFolder });
    expect(again.tenantCreated).toBe(false);
    const res = await withClient((c) => c.query("select name from tenants"));
    expect(res.rows).toEqual([{ name: "Umbenannt" }]);
  });

  async function seedRepository(c: Client): Promise<string> {
    const tenant = await c.query<{ id: string }>("select id from tenants limit 1");
    const conn = await c.query<{ id: string }>(
      "insert into platform_connections (tenant_id, platform, owner_name) values ($1, 'github', 'owner') returning id",
      [tenant.rows[0]?.id],
    );
    const repo = await c.query<{ id: string }>(
      "insert into repositories (connection_id, external_id, full_name, default_branch) values ($1, '1', 'owner/repo', 'main') returning id",
      [conn.rows[0]?.id],
    );
    return repo.rows[0]?.id as string;
  }

  it("lässt je Repo und Art nur einen offenen Rollout zu", async () => {
    await withClient(async (c) => {
      const repoId = await seedRepository(c);
      const insert = (status: string) =>
        c.query(
          "insert into rollout_actions (repository_id, kind, triggered_by, status) values ($1, 'onboarding', 'auto', $2)",
          [repoId, status],
        );
      await insert("pr_open");
      await expect(insert("pending")).rejects.toMatchObject({ code: "23505" });
      // Abgeschlossene Rollouts und andere Arten bleiben unbeschränkt.
      await insert("merged");
      await insert("closed");
      await c.query(
        "insert into rollout_actions (repository_id, kind, triggered_by) values ($1, 'build_check', 'auto')",
        [repoId],
      );
    });
  });

  it("erlaubt ein neues Problem gleichen Schlüssels, sobald das alte behoben ist", async () => {
    await withClient(async (c) => {
      const repo = await c.query<{ id: string }>("select id from repositories limit 1");
      const repoId = repo.rows[0]?.id;
      const insert = () =>
        c.query(
          "insert into problems (repository_id, kind, message, dedupe_key) values ($1, 'stale_pr', 'm', '42')",
          [repoId],
        );
      await insert();
      await expect(insert()).rejects.toMatchObject({ code: "23505" });
      await c.query("update problems set resolved_at = now() where dedupe_key = '42'");
      await insert();
      const open = await c.query("select 1 from problems where resolved_at is null");
      expect(open.rowCount).toBe(1);
    });
  });
});
