import path from "node:path";
import { randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CeApiError, type CeAddJobResult } from "@/ce";
import type { Db } from "@/db/client";
import { runMigrations } from "@/db/migrate";
import * as schema from "@/db/schema";
import { syncProblems } from "@/sync/problems-sync";
import type { RolloutOutcome, RolloutRequest } from "@/rollout/types";
import { setOwnCiCore } from "./repos";
import { setAutoOnboardingCore } from "./settings";
import { triggerAllRunsCore, triggerRepoRunCore } from "./jobs";
import { outcomeToState, runRolloutCore } from "./rollout";
import { ActionError } from "../result";

/**
 * Logik der Aktionen gegen eine echte Postgres (DATABASE_URL, ohne die Variable übersprungen) mit
 * einem Fake-CE-Client: kein Netzaufruf, die Server Actions selbst sind nur dünne Hüllen.
 */
const adminUrl = process.env.DATABASE_URL;
const migrationsFolder = path.join(process.cwd(), "drizzle");

/** Fake-CE: das erste addJob je Repo ist "inserted", jedes weitere "unchanged" (wie CE bei wartendem Job). */
function fakeCe(opts: { failFor?: string[]; status?: number } = {}) {
  const calls: string[] = [];
  const queued = new Set<string>();
  return {
    calls,
    async addJob(fullName: string): Promise<CeAddJobResult> {
      calls.push(fullName);
      if (opts.failFor?.includes(fullName) || opts.failFor?.includes("*")) {
        throw new CeApiError("x", "/system/v1/jobs/add", opts.status ?? null);
      }
      const change = queued.has(fullName) ? "unchanged" : "inserted";
      queued.add(fullName);
      return { jobId: `job-${calls.length}`, status: "pending", change };
    },
  };
}

describe.skipIf(!adminUrl)("Aktionen (Postgres)", () => {
  const dbName = `dashboard_actions_${randomBytes(6).toString("hex")}`;
  let pool: Pool;
  let db: Db;
  let connectionId: string;
  const ids: Record<string, string> = {};

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
    const url = new URL(adminUrl as string);
    url.pathname = `/${dbName}`;
    await runMigrations({ databaseUrl: url.toString(), migrationsFolder });
    pool = new Pool({ connectionString: url.toString(), max: 5 });
    db = drizzle(pool, { schema }) as Db;
  });

  afterAll(async () => {
    await pool?.end();
    await admin((c) => c.query(`drop database if exists "${dbName}" with (force)`));
  });

  beforeEach(async () => {
    await pool.query("truncate audit_log, problems, rollout_actions, repositories, platform_connections, tenants cascade");
    const [tenant] = await db.insert(schema.tenants).values({ name: "T" }).returning();
    const [conn] = await db
      .insert(schema.platformConnections)
      .values({ tenantId: tenant!.id, platform: "github", ownerName: "o", installationId: 1 })
      .returning();
    connectionId = conn!.id;
    const make = (key: string, over: Partial<typeof schema.repositories.$inferInsert>) => ({
      connectionId,
      externalId: key,
      fullName: `o/${key}`,
      defaultBranch: "main",
      onboardingStatus: "onboarded" as const,
      ...over,
    });
    const rows = await db
      .insert(schema.repositories)
      .values([
        make("a", {}),
        make("b", {}),
        make("neu", { onboardingStatus: "none" }),
        make("alt", { archived: true }),
        make("weg", { removedAt: new Date() }),
      ])
      .returning();
    for (const r of rows) ids[r.fullName.slice(2)] = r.id;
  });

  const audit = () => db.select().from(schema.auditLog);

  describe("Lauf für ein Repo", () => {
    it("reiht einen Lauf ein, meldet ihn mit Link auf die Job-Ansicht und schreibt den AuditLog", async () => {
      const ce = fakeCe();
      const state = await triggerRepoRunCore({ db, ce, actor: "sascha" }, ids.a!);
      expect(state).toEqual({
        status: "done",
        tone: "erfolg",
        message: "Lauf eingereiht.",
        link: { href: "/jobs?repo=o%2Fa", label: "Läufe des Repos ansehen", external: false },
      });
      expect(ce.calls).toEqual(["o/a"]);
      expect(await audit()).toMatchObject([{ actor: "sascha", action: "job.trigger", target: "o/a" }]);
    });

    it("meldet unchanged, wenn schon ein Lauf wartet, und reiht keinen zweiten ein", async () => {
      const ce = fakeCe();
      await triggerRepoRunCore({ db, ce, actor: "sascha" }, ids.a!);
      const second = await triggerRepoRunCore({ db, ce, actor: "sascha" }, ids.a!);
      expect(second).toMatchObject({
        status: "done",
        tone: "neutral",
        message: "Für dieses Repo wartet oder läuft bereits ein Lauf.",
      });
    });

    it("lehnt nicht onboardete, archivierte und entfernte Repos ab, ohne CE anzusprechen oder zu protokollieren", async () => {
      const ce = fakeCe();
      for (const key of ["neu", "alt", "weg"]) {
        await expect(triggerRepoRunCore({ db, ce, actor: "x" }, ids[key]!)).rejects.toBeInstanceOf(ActionError);
      }
      await expect(triggerRepoRunCore({ db, ce, actor: "x" }, "kein-uuid")).rejects.toBeInstanceOf(ActionError);
      expect(ce.calls).toEqual([]);
      expect(await audit()).toEqual([]);
    });

    it("meldet einen CE-Fehler ohne Rohantwort und schreibt keinen AuditLog", async () => {
      const ce = fakeCe({ failFor: ["o/a"], status: 401 });
      await expect(triggerRepoRunCore({ db, ce, actor: "x" }, ids.a!)).rejects.toThrow(
        "Renovate CE hat die Anfrage abgelehnt (Status 401).",
      );
      const down = fakeCe({ failFor: ["o/a"] });
      await expect(triggerRepoRunCore({ db, ce: down, actor: "x" }, ids.a!)).rejects.toThrow("Renovate CE ist nicht erreichbar.");
      expect(await audit()).toEqual([]);
    });
  });

  describe("Läufe für alle Repos", () => {
    it("reiht je onboardetem, nicht archiviertem, nicht entferntem Repo genau einen Lauf ein", async () => {
      const ce = fakeCe();
      const state = await triggerAllRunsCore({ db, ce, actor: "sascha" });
      expect([...ce.calls].sort()).toEqual(["o/a", "o/b"]);
      expect(state).toMatchObject({ status: "done", tone: "erfolg", message: "2 Läufe eingereiht.", link: { href: "/jobs" } });
      expect(await audit()).toMatchObject([{ actor: "sascha", action: "job.trigger_all", target: "2 Repos" }]);
    });

    it("zählt unveränderte und fehlgeschlagene Repos mit", async () => {
      const ce = fakeCe({ failFor: ["o/b"] });
      await triggerRepoRunCore({ db, ce, actor: "x" }, ids.a!);
      const state = await triggerAllRunsCore({ db, ce, actor: "x" });
      expect(state).toMatchObject({
        status: "done",
        tone: "warnung",
        message: "0 Läufe eingereiht, 1 unverändert (Lauf wartet oder läuft bereits), 1 Fehler bei der Anfrage.",
      });
    });

    it("meldet einen Fehler, wenn CE bei keinem Repo antwortet", async () => {
      const state = await triggerAllRunsCore({ db, ce: fakeCe({ failFor: ["*"] }), actor: "x" });
      expect(state.status).toBe("error");
    });

    it("tut nichts ohne passende Repos", async () => {
      await pool.query("update repositories set onboarding_status = 'none'");
      const ce = fakeCe();
      const state = await triggerAllRunsCore({ db, ce, actor: "x" });
      expect(state).toMatchObject({ status: "done", tone: "neutral" });
      expect(ce.calls).toEqual([]);
      expect(await audit()).toEqual([]);
    });
  });

  describe("eigene CI", () => {
    const openProblems = (repositoryId: string) =>
      db
        .select()
        .from(schema.problems)
        .where(and(eq(schema.problems.repositoryId, repositoryId), isNull(schema.problems.resolvedAt)));

    beforeEach(async () => {
      await pool.query("update repositories set build_check_status = 'missing'");
      await db.insert(schema.problems).values({
        repositoryId: ids.a!,
        kind: "missing_build_check",
        message: "Der Build-Check ist nicht eingerichtet.",
      });
    });

    it("löst missing_build_check sofort auf, setzt own_ci und schreibt den AuditLog", async () => {
      const state = await setOwnCiCore({ db, actor: "sascha" }, ids.a!, true);
      expect(state).toMatchObject({ status: "done", tone: "erfolg" });
      const [repo] = await db.select().from(schema.repositories).where(eq(schema.repositories.id, ids.a!));
      expect(repo).toMatchObject({ ownCi: true, buildCheckStatus: "own_ci" });
      expect(await openProblems(ids.a!)).toEqual([]);
      expect(await audit()).toMatchObject([{ actor: "sascha", action: "repo.own_ci", target: "o/a: eigene CI an" }]);
    });

    it("der Abgleich öffnet das Problem danach nicht wieder", async () => {
      await setOwnCiCore({ db, actor: "x" }, ids.a!, true);
      await syncProblems(db);
      expect((await openProblems(ids.a!)).filter((p) => p.kind === "missing_build_check")).toEqual([]);
    });

    it("beim Aufheben gilt der Build-Check wieder als fehlend und der Abgleich meldet es erneut", async () => {
      await setOwnCiCore({ db, actor: "x" }, ids.a!, true);
      await setOwnCiCore({ db, actor: "x" }, ids.a!, false);
      const [repo] = await db.select().from(schema.repositories).where(eq(schema.repositories.id, ids.a!));
      expect(repo).toMatchObject({ ownCi: false, buildCheckStatus: "missing" });
      await syncProblems(db);
      expect((await openProblems(ids.a!)).map((p) => p.kind)).toContain("missing_build_check");
    });

    it("lässt aktiven Build-Check und offenen Rollout-PR unberührt", async () => {
      await pool.query("update repositories set build_check_status = 'active' where id = $1", [ids.a]);
      await setOwnCiCore({ db, actor: "x" }, ids.a!, true);
      let [repo] = await db.select().from(schema.repositories).where(eq(schema.repositories.id, ids.a!));
      expect(repo!.buildCheckStatus).toBe("active");

      await db.insert(schema.rolloutActions).values({ repositoryId: ids.b!, kind: "build_check", triggeredBy: "x", status: "pr_open" });
      await pool.query("update repositories set build_check_status = 'pr_open' where id = $1", [ids.b]);
      await setOwnCiCore({ db, actor: "x" }, ids.b!, true);
      [repo] = await db.select().from(schema.repositories).where(eq(schema.repositories.id, ids.b!));
      expect(repo!.buildCheckStatus).toBe("pr_open");
    });

    it("ist idempotent: gleicher Wert erzeugt keinen zweiten Eintrag", async () => {
      await setOwnCiCore({ db, actor: "x" }, ids.a!, true);
      const again = await setOwnCiCore({ db, actor: "x" }, ids.a!, true);
      expect(again).toMatchObject({ tone: "neutral" });
      expect(await audit()).toHaveLength(1);
    });

    it("lehnt entfernte Repos ab", async () => {
      await expect(setOwnCiCore({ db, actor: "x" }, ids.weg!, true)).rejects.toBeInstanceOf(ActionError);
    });
  });

  describe("automatisches Onboarding", () => {
    const conn = async () =>
      (await db.select().from(schema.platformConnections).where(eq(schema.platformConnections.id, connectionId)))[0]!;

    it("setzt beim Einschalten den Zeitpunkt und lässt ihn beim Ausschalten stehen", async () => {
      expect(await conn()).toMatchObject({ autoOnboarding: false, autoOnboardingEnabledAt: null });
      const at = new Date("2026-10-21T10:00:00Z");
      await setAutoOnboardingCore({ db, actor: "sascha", now: at }, connectionId, true);
      expect(await conn()).toMatchObject({ autoOnboarding: true, autoOnboardingEnabledAt: at });
      await setAutoOnboardingCore({ db, actor: "sascha", now: new Date("2026-10-22T10:00:00Z") }, connectionId, false);
      expect(await conn()).toMatchObject({ autoOnboarding: false, autoOnboardingEnabledAt: at });
      expect(await audit()).toMatchObject([
        { action: "settings.auto_onboarding", target: "o: an" },
        { action: "settings.auto_onboarding", target: "o: aus" },
      ]);
    });

    it("erzeugt bei unverändertem Zustand keinen Eintrag und lehnt unbekannte Owner ab", async () => {
      expect(await setAutoOnboardingCore({ db, actor: "x" }, connectionId, false)).toMatchObject({ tone: "neutral" });
      expect(await audit()).toEqual([]);
      await expect(setAutoOnboardingCore({ db, actor: "x" }, "00000000-0000-4000-8000-000000000000", true)).rejects.toBeInstanceOf(
        ActionError,
      );
    });
  });
});

describe("Rollout-Meldungen", () => {
  const prUrl = "https://github.com/o/a/pull/7";
  const link = { href: prUrl, label: "PR #7 auf GitHub ansehen", external: true };

  it("bildet das Ergebnis der Rollout-Logik auf Meldungen ab", () => {
    expect(outcomeToState("onboarding", { status: "created", prUrl, prNumber: 7 })).toEqual({
      status: "done",
      tone: "erfolg",
      message: "Onboarding-PR #7 angelegt.",
      link,
    });
    expect(outcomeToState("build_check", { status: "existing", prUrl, prNumber: 7 })).toMatchObject({
      tone: "neutral",
      message: "Es gibt bereits einen offenen Build-Check-PR (#7). Es entsteht kein zweiter.",
      link,
    });
    expect(outcomeToState("onboarding", { status: "not_needed", reason: "config_present", message: "Konfiguration vorhanden." })).toEqual({
      status: "done",
      tone: "neutral",
      message: "Konfiguration vorhanden.",
    });
    expect(outcomeToState("onboarding", { status: "failed", message: "Keine Schreibrechte." })).toEqual({
      status: "error",
      message: "Keine Schreibrechte.",
    });
  });

  it("ruft den Service mit Repo, Art und Nutzer auf", async () => {
    const requests: RolloutRequest[] = [];
    const service = {
      async run(r: RolloutRequest): Promise<RolloutOutcome> {
        requests.push(r);
        return { status: "failed", message: "Noch nicht verfügbar." };
      },
    };
    const id = "00000000-0000-4000-8000-000000000001";
    const state = await runRolloutCore({ service, actor: "sascha" }, id, "build_check");
    expect(requests).toEqual([{ repositoryId: id, kind: "build_check", actor: "sascha" }]);
    expect(state).toEqual({ status: "error", message: "Noch nicht verfügbar." });
    await expect(runRolloutCore({ service, actor: "x" }, "kein-uuid", "onboarding")).rejects.toBeInstanceOf(ActionError);
    expect(requests).toHaveLength(1);
  });
});
