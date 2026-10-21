import path from "node:path";
import { randomBytes } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CeApiError, type CeClient, type CeJobReport, type CeQueue, type CeRepo } from "@/ce";
import type { Db } from "@/db/client";
import { runMigrations } from "@/db/migrate";
import * as schema from "@/db/schema";
import {
  PlatformApiError,
  RateLimitPause,
  type ChangeRequestRef,
  type ChangeRequestState,
  type ChangeStatus,
  type NewChangeRequest,
  type TemplateName,
  type PlatformAdapter,
  type PlatformConnection,
  type PlatformRepository,
  type UpdateChangeRequest,
} from "@/platform";
import { createRolloutService, setAutoOnboarding } from "@/rollout";
import { runCeSync } from "./ce-sync";
import { runGithubSync } from "./github-sync";
import { SYNC_LOCK_KEYS, withAdvisoryLock } from "./lock";
import { syncProblems } from "./problems-sync";
import { startSyncLoops } from "./scheduler";

/**
 * Integrationstests gegen eine echte Postgres (DATABASE_URL), ohne die Variable übersprungen.
 * Jeder Lauf nutzt eine eigene Wegwerf-Datenbank. Plattform und CE sind Fakes (kein Netzaufruf).
 */
const adminUrl = process.env.DATABASE_URL;
const migrationsFolder = path.join(process.cwd(), "drizzle");

type FakeRepo = PlatformRepository & {
  /** null = leeres Repo. */
  head: string | null;
  prs: UpdateChangeRequest[];
  config: string | null;
  caller: boolean;
  /** Fehler, den jeder Abruf zu diesem Repo wirft. */
  failWith?: Error;
  /** Fehler nur beim Lesen der PRs bzw. der Dependency-Dashboard-Suche. */
  prsFail?: Error;
  dashboardFail?: Error;
  /** Wird in getHeadSha aufgerufen (Repo-Zeile ist dann bereits geladen). */
  onHead?: () => Promise<void>;
};

function makeRepo(id: number, fullName: string, over: Partial<FakeRepo> = {}): FakeRepo {
  return {
    externalId: String(id),
    fullName,
    defaultBranch: "main",
    archived: false,
    private: true,
    head: `sha-${id}-1`,
    prs: [],
    config: "renovate.json",
    caller: true,
    ...over,
  };
}

function makePr(number: number, headSha: string, packageNames: string[] = []): UpdateChangeRequest {
  const day = 86_400_000;
  return {
    number,
    title: `Update ${number}`,
    url: `https://example.test/pr/${number}`,
    labels: ["update:minor"],
    headSha,
    createdAt: new Date(Date.now() - day).toISOString(),
    updatedAt: new Date(Date.now() - day).toISOString(),
    automerge: false,
    packageNames,
  };
}

class FakeAdapter implements PlatformAdapter {
  connections: PlatformConnection[] = [];
  repos = new Map<string, FakeRepo[]>();
  checks = new Map<string, ChangeStatus>();
  prStates = new Map<number, ChangeRequestState>();
  calls = { getRepositoryState: 0, getChangeStatus: 0 };
  /** Reihenfolge der Repo-Abgleiche (getHeadSha). */
  headCalls: string[] = [];
  /** Fehler, den listConnections wirft. */
  connectionsFail: Error | null = null;
  /** Optional: Abruf blockiert, bis das Tor geöffnet wird. */
  gate: Promise<void> | null = null;
  /** Wird aufgerufen, sobald der erste Abruf das Tor erreicht (der Durchlauf hält dann den Lock). */
  onListConnections: (() => void) | null = null;

  addOwner(owner: string, installationId: number, repos: FakeRepo[]) {
    this.connections.push({
      externalConnectionId: String(installationId),
      ownerName: owner,
      ownerType: "organization",
    });
    this.repos.set(String(installationId), repos);
  }

  private find(conn: PlatformConnection, fullName: string): FakeRepo {
    const repo = this.repos.get(conn.externalConnectionId)?.find((r) => r.fullName === fullName);
    if (!repo) throw new PlatformApiError(404, "GET", `/repos/${fullName}`);
    if (repo.failWith) throw repo.failWith;
    return repo;
  }

  async listConnections() {
    this.onListConnections?.();
    await this.gate;
    if (this.connectionsFail) throw this.connectionsFail;
    return this.connections;
  }
  async listRepositories(conn: PlatformConnection) {
    return this.repos.get(conn.externalConnectionId) ?? [];
  }
  async getHeadSha(conn: PlatformConnection, ref: { fullName: string }) {
    const r = this.find(conn, ref.fullName);
    this.headCalls.push(ref.fullName);
    await r.onHead?.();
    return r.head;
  }
  async getRepositoryState(conn: PlatformConnection, ref: { fullName: string }) {
    this.calls.getRepositoryState++;
    const r = this.find(conn, ref.fullName);
    return { configPath: r.config, hasBuildCheck: r.caller };
  }
  async listUpdatePullRequests(conn: PlatformConnection, ref: { fullName: string }) {
    const r = this.find(conn, ref.fullName);
    if (r.prsFail) throw r.prsFail;
    return r.prs;
  }
  async getPullRequestState(_c: PlatformConnection, _r: unknown, number: number) {
    return this.prStates.get(number) ?? { state: "open" as const, mergedAt: null };
  }
  async getChangeStatus(_c: PlatformConnection, _r: unknown, sha: string) {
    this.calls.getChangeStatus++;
    return this.checks.get(sha) ?? { ci: "none" as const };
  }
  async findDependencyDashboard(conn: PlatformConnection, ref: { fullName: string }) {
    const dashboardFail = this.find(conn, ref.fullName).dashboardFail;
    if (dashboardFail) throw dashboardFail;
    return `https://example.test/${ref.fullName}/issues/1`;
  }

  /** Rollout: angelegte PRs und offene PRs je "repo|branch". */
  changeRequests: { repo: string; request: NewChangeRequest; number: number }[] = [];
  openChangeRequests = new Map<string, ChangeRequestRef>();
  async readTemplate(name: TemplateName) {
    return name === "renovate-config"
      ? { path: "renovate.json", content: "{}" }
      : { path: ".github/workflows/build-check.yml", content: "name: x" };
  }
  async findOpenChangeRequest(_c: unknown, ref: { fullName: string }, branch: string) {
    return this.openChangeRequests.get(`${ref.fullName}|${branch}`) ?? null;
  }
  async createChangeRequest(_c: unknown, ref: { fullName: string }, request: NewChangeRequest) {
    const number = 100 + this.changeRequests.length;
    this.changeRequests.push({ repo: ref.fullName, request, number });
    const pr = { number, url: `https://example.test/${ref.fullName}/pull/${number}` };
    this.openChangeRequests.set(`${ref.fullName}|${request.branch}`, pr);
    return pr;
  }
  async deleteBranch() {}
}

const failing: ChangeStatus = { ci: "failure" };
const passing: ChangeStatus = { ci: "success" };
const pending: ChangeStatus = { ci: "pending" };

describe.skipIf(!adminUrl)("Abgleich (Postgres)", () => {
  const dbName = `dashboard_sync_${randomBytes(6).toString("hex")}`;
  let testUrl = "";
  let pool: Pool;
  let db: Db;

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
    testUrl = url.toString();
    await runMigrations({ databaseUrl: testUrl, migrationsFolder });
    pool = new Pool({ connectionString: testUrl, max: 5 });
    db = drizzle(pool, { schema });
  });

  afterAll(async () => {
    await pool?.end();
    await admin((c) => c.query(`drop database if exists "${dbName}" with (force)`));
  });

  beforeEach(async () => {
    await pool.query("truncate platform_connections, sync_state, http_cache, audit_log cascade");
  });

  const githubState = async () =>
    (await db.select().from(schema.syncState).where(eq(schema.syncState.source, "github")))[0];

  describe("Sperre", () => {
    it("startet einen zweiten Durchlauf nicht parallel", async () => {
      let release!: () => void;
      const held = new Promise<void>((r) => (release = r));
      let entered!: () => void;
      const inside = new Promise<void>((r) => (entered = r));

      const first = withAdvisoryLock(pool, SYNC_LOCK_KEYS.github, async () => {
        entered();
        await held;
        return "erster";
      });
      await inside;

      const second = await withAdvisoryLock(pool, SYNC_LOCK_KEYS.github, async () => "zweiter");
      expect(second).toEqual({ ran: false });
      // Eine andere Quelle hat einen eigenen Schlüssel.
      const other = await withAdvisoryLock(pool, SYNC_LOCK_KEYS.ce, async () => "ce");
      expect(other).toEqual({ ran: true, value: "ce" });

      release();
      expect(await first).toEqual({ ran: true, value: "erster" });
      // Nach dem Ende ist der Lock wieder frei.
      expect(await withAdvisoryLock(pool, SYNC_LOCK_KEYS.github, async () => 1)).toEqual({ ran: true, value: 1 });
    });

    it("verwirft die Lock-Verbindung bei einem Verbindungsfehler, ohne den Prozess zu beenden", async () => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const result = await withAdvisoryLock(pool, SYNC_LOCK_KEYS.github, async () => {
          // Wie ein DB-Neustart: das Backend der Lock-Verbindung wird beendet.
          await pool.query(
            `select pg_terminate_backend(pid) from pg_locks
              where locktype = 'advisory' and granted and pid <> pg_backend_pid()
                and database = (select oid from pg_database where datname = current_database())`,
          );
          await new Promise((r) => setTimeout(r, 200)); // der Fehler kommt als Event an
          return "fertig";
        });
        expect(result).toEqual({ ran: true, value: "fertig" });
        expect(log).toHaveBeenCalledWith(expect.stringContaining("Sperre"));
        // Der Lock endete mit der Sitzung, der Pool ist weiter nutzbar.
        expect(await withAdvisoryLock(pool, SYNC_LOCK_KEYS.github, async () => 1)).toEqual({ ran: true, value: 1 });
      } finally {
        log.mockRestore();
      }
    });

    it("bewertet Probleme unter eigenem Lock: belegt -> übersprungen, danach wieder normal", async () => {
      const adapter = new FakeAdapter();
      adapter.addOwner("acme", 11, [makeRepo(1, "acme/a", { prs: [makePr(5, "pr-1")] })]);
      adapter.checks.set("pr-1", failing);

      let release!: () => void;
      const held = new Promise<void>((r) => (release = r));
      let entered!: () => void;
      const inside = new Promise<void>((r) => (entered = r));
      const holder = withAdvisoryLock(pool, SYNC_LOCK_KEYS.problems, async () => {
        entered();
        await held;
      });
      await inside;

      await runGithubSync({ db, adapter }); // bewertet intern: übersprungen
      expect(await db.select().from(schema.problems)).toHaveLength(0);
      expect(await syncProblems(db)).toMatchObject({ skipped: true, inserted: 0 });

      release();
      await holder;
      const result = await syncProblems(db);
      expect(result.skipped).toBeUndefined();
      expect(result.inserted).toBe(1);
      expect((await db.select().from(schema.problems))[0]).toMatchObject({ kind: "ci_red", dedupeKey: "5" });
    });

    it("überlappt im Scheduler weder im Prozess noch über den Lock", async () => {
      const adapter = new FakeAdapter();
      adapter.addOwner("acme", 1, [makeRepo(1, "acme/a")]);
      let open!: () => void;
      adapter.gate = new Promise<void>((r) => (open = r));
      let started!: () => void;
      const running = new Promise<void>((r) => (started = r));
      adapter.onListConnections = () => started();
      const ceClient = {} as never;
      const loops = startSyncLoops({
        db,
        pool,
        adapter,
        ceClient,
        intervals: { githubMs: 3_600_000, ceMs: 3_600_000 },
        firstRunDelayMs: 3_600_000,
      });
      try {
        const first = loops.run("github");
        await running; // der erste Durchlauf läuft und hält den Lock
        // Zweiter Aufruf im selben Prozess: durch das Flag übersprungen.
        expect(await loops.run("github")).toBe(false);
        // Zweite "Instanz" (eigene Schleifen, gleiche DB): durch den Lock übersprungen.
        const other = startSyncLoops({
          db,
          pool,
          adapter,
          ceClient,
          intervals: { githubMs: 3_600_000, ceMs: 3_600_000 },
          firstRunDelayMs: 3_600_000,
        });
        try {
          expect(await other.run("github")).toBe(false);
        } finally {
          other.stop();
        }
        open();
        expect(await first).toBe(true);
      } finally {
        loops.stop();
      }
    });
  });

  describe("GitHub-Abgleich", () => {
    it("legt für eine neue Installation eine PlatformConnection an", async () => {
      const adapter = new FakeAdapter();
      adapter.addOwner("acme", 11, [makeRepo(1, "acme/a")]);
      await runGithubSync({ db, adapter });
      let conns = await db.select().from(schema.platformConnections);
      expect(conns.map((c) => [c.ownerName, c.installationId, c.platform])).toEqual([
        ["acme", 11, "github"],
      ]);

      adapter.addOwner("beta", 12, [makeRepo(2, "beta/b")]);
      await runGithubSync({ db, adapter });
      conns = await db.select().from(schema.platformConnections).orderBy(asc(schema.platformConnections.installationId));
      expect(conns.map((c) => c.ownerName)).toEqual(["acme", "beta"]);
      const repos = await db.select().from(schema.repositories);
      expect(repos.map((r) => r.fullName).sort()).toEqual(["acme/a", "beta/b"]);
    });

    it("lässt ein fehlerhaftes Repo den Rest nicht abbrechen (Teilfehler in sync_state)", async () => {
      const adapter = new FakeAdapter();
      adapter.addOwner("acme", 11, [
        makeRepo(1, "acme/kaputt", { failWith: new PlatformApiError(500, "GET", "/geheim/pfad") }),
        makeRepo(2, "acme/gut", { prs: [makePr(7, "pr-sha")] }),
      ]);
      const summary = await runGithubSync({ db, adapter });
      expect(summary.partialErrors).toEqual([
        { repository: "acme/kaputt", message: "Plattform-Fehler (Status 500)" },
      ]);
      const state = await githubState();
      expect(state?.lastSuccessAt).not.toBeNull();
      expect(state?.partialErrors).toEqual(summary.partialErrors);
      // Keine Rohfehler im Vermerk.
      expect(JSON.stringify(state)).not.toContain("geheim");

      const good = (await db.select().from(schema.repositories).where(eq(schema.repositories.fullName, "acme/gut")))[0]!;
      expect(good.headSha).toBe("sha-2-1");
      expect(good.syncedAt).not.toBeNull();
      expect(good.dependencyDashboardUrl).toBe("https://example.test/acme/gut/issues/1");
      const prs = await db.select().from(schema.pullRequests).where(eq(schema.pullRequests.repositoryId, good.id));
      expect(prs).toHaveLength(1);
      expect(prs[0]).toMatchObject({ number: 7, updateType: "minor", state: "open", headSha: "pr-sha" });
    });

    it("bewertet ein behobenes Problem neu und setzt resolved_at (ci_red -> success)", async () => {
      const adapter = new FakeAdapter();
      adapter.addOwner("acme", 11, [makeRepo(1, "acme/a", { prs: [makePr(5, "pr-1")] })]);
      adapter.checks.set("pr-1", failing);
      await runGithubSync({ db, adapter });
      await runGithubSync({ db, adapter }); // idempotent: weiter ein offenes Problem

      let rows = await db.select().from(schema.problems);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ kind: "ci_red", dedupeKey: "5", resolvedAt: null });
      // Gleicher PR-Head-SHA, aber der Stand ist nicht "success": CI wird erneut gelesen.
      expect(adapter.calls.getChangeStatus).toBe(2);

      adapter.repos.get("11")![0]!.prs = [makePr(5, "pr-2")];
      adapter.checks.set("pr-2", passing);
      await runGithubSync({ db, adapter });

      rows = await db.select().from(schema.problems);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.resolvedAt).not.toBeNull();
      const [pr] = await db.select().from(schema.pullRequests);
      expect(pr?.ciStatus).toBe("success");
    });

    it("hält ein umbenanntes Repo in derselben Zeile und markiert entfernte mit removed_at", async () => {
      const adapter = new FakeAdapter();
      adapter.addOwner("acme", 11, [makeRepo(1, "acme/alt"), makeRepo(2, "acme/bleibt")]);
      await runGithubSync({ db, adapter });
      const before = (await db.select().from(schema.repositories).where(eq(schema.repositories.externalId, "1")))[0]!;

      // Umbenennung und Entfernung des zweiten Repos.
      adapter.repos.set("11", [makeRepo(1, "acme/neu")]);
      await runGithubSync({ db, adapter });

      const rows = await db.select().from(schema.repositories).orderBy(asc(schema.repositories.externalId));
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({ id: before.id, fullName: "acme/neu", removedAt: null });
      expect(rows[0]?.firstSeenAt).toEqual(before.firstSeenAt);
      expect(rows[1]?.externalId).toBe("2");
      expect(rows[1]?.removedAt).not.toBeNull();

      // Wiederauftauchen setzt removed_at zurück, first_seen_at bleibt.
      const second = rows[1]!;
      adapter.repos.set("11", [makeRepo(1, "acme/neu"), makeRepo(2, "acme/bleibt")]);
      await runGithubSync({ db, adapter });
      const again = (await db.select().from(schema.repositories).where(eq(schema.repositories.externalId, "2")))[0]!;
      expect(again).toMatchObject({ id: second.id, removedAt: null });
      expect(again.firstSeenAt).toEqual(second.firstSeenAt);
    });

    it("liest Inhalte nur bei neuem Head-SHA und leitet Onboarding und Build-Check ab", async () => {
      const adapter = new FakeAdapter();
      adapter.addOwner("acme", 11, [makeRepo(1, "acme/a", { config: null, caller: false })]);
      await runGithubSync({ db, adapter });
      await runGithubSync({ db, adapter });
      expect(adapter.calls.getRepositoryState).toBe(1);
      let [repo] = await db.select().from(schema.repositories);
      expect(repo).toMatchObject({ onboardingStatus: "none", buildCheckStatus: "missing", configPath: null });

      const r = adapter.repos.get("11")![0]!;
      r.head = "sha-1-2";
      r.config = "renovate.json";
      r.caller = true;
      await runGithubSync({ db, adapter });
      expect(adapter.calls.getRepositoryState).toBe(2);
      [repo] = await db.select().from(schema.repositories);
      expect(repo).toMatchObject({ onboardingStatus: "onboarded", buildCheckStatus: "active", configPath: "renovate.json" });
    });

    it("setzt nicht mehr gelistete PRs auf ihren Endzustand", async () => {
      const adapter = new FakeAdapter();
      adapter.addOwner("acme", 11, [makeRepo(1, "acme/a", { prs: [makePr(3, "x")] })]);
      await runGithubSync({ db, adapter });
      adapter.repos.get("11")![0]!.prs = [];
      adapter.prStates.set(3, { state: "merged", mergedAt: "2026-10-14T10:00:00Z" });
      await runGithubSync({ db, adapter });
      const [pr] = await db.select().from(schema.pullRequests);
      expect(pr?.state).toBe("merged");
      expect(pr?.mergedAt?.toISOString()).toBe("2026-10-14T10:00:00.000Z");
    });

    it("vermerkt RateLimitPause und endet ohne Exception", async () => {
      const adapter = new FakeAdapter();
      adapter.addOwner("acme", 11, [makeRepo(1, "acme/a"), makeRepo(2, "acme/b")]);
      const resetAt = new Date(Date.now() + 600_000);
      const repos = adapter.repos.get("11")!;
      repos[0]!.failWith = new RateLimitPause(100, 5000, resetAt);

      const summary = await runGithubSync({ db, adapter });
      expect(summary.pause?.until).toEqual(resetAt);
      const state = await githubState();
      expect(state?.pauseNote).toContain("Kontingent knapp");
      expect(state?.pausedUntil).toEqual(resetAt);
      expect(state?.lastSuccessAt).toBeNull();
      // Der Durchlauf endete früh: das zweite Repo wurde nicht mehr angefasst.
      const b = (await db.select().from(schema.repositories).where(eq(schema.repositories.fullName, "acme/b")))[0]!;
      expect(b.syncedAt).toBeNull();

      // Der nächste Durchlauf ohne Pause löscht den Vermerk.
      repos[0]!.failWith = undefined;
      await runGithubSync({ db, adapter });
      const after = await githubState();
      expect(after?.pauseNote).toBeNull();
      expect(after?.lastSuccessAt).not.toBeNull();
    });

    it("liest den CI-Status bei gleichem SHA neu, solange er nicht success ist (pending -> success)", async () => {
      const adapter = new FakeAdapter();
      adapter.addOwner("acme", 11, [makeRepo(1, "acme/a", { prs: [makePr(5, "pr-1")] })]);
      adapter.checks.set("pr-1", pending);
      await runGithubSync({ db, adapter });
      let [pr] = await db.select().from(schema.pullRequests);
      expect(pr?.ciStatus).toBe("pending");

      adapter.checks.set("pr-1", passing); // gleicher Head-SHA, Checks sind durchgelaufen
      await runGithubSync({ db, adapter });
      [pr] = await db.select().from(schema.pullRequests);
      expect(pr?.ciStatus).toBe("success");
      expect(adapter.calls.getChangeStatus).toBe(2);

      // success bleibt bei gleichem SHA ungelesen.
      await runGithubSync({ db, adapter });
      expect(adapter.calls.getChangeStatus).toBe(2);
    });

    it("behebt ci_red, wenn der Rerun bei gleichem SHA grün wird, und liest auch none neu", async () => {
      const adapter = new FakeAdapter();
      adapter.addOwner("acme", 11, [makeRepo(1, "acme/a", { prs: [makePr(5, "pr-1"), makePr(6, "pr-6")] })]);
      adapter.checks.set("pr-1", failing);
      await runGithubSync({ db, adapter });
      let rows = await db.select().from(schema.problems);
      expect(rows.filter((r) => r.kind === "ci_red" && r.resolvedAt === null)).toHaveLength(1);

      adapter.checks.set("pr-1", passing);
      adapter.checks.set("pr-6", passing); // war none, Checks erscheinen erst später
      await runGithubSync({ db, adapter });
      rows = await db.select().from(schema.problems);
      expect(rows.filter((r) => r.kind === "ci_red" && r.resolvedAt === null)).toHaveLength(0);
      const prs = await db.select().from(schema.pullRequests).orderBy(asc(schema.pullRequests.number));
      expect(prs.map((p) => p.ciStatus)).toEqual(["success", "success"]);
    });

    it("schreibt die Paketnamen aus der Listen-Antwort nach pull_requests.package_names", async () => {
      const adapter = new FakeAdapter();
      adapter.addOwner("acme", 11, [
        makeRepo(1, "acme/a", { prs: [makePr(5, "x", ["lodash", "@types/node"]), makePr(6, "y")] }),
      ]);
      await runGithubSync({ db, adapter });
      const prs = await db.select().from(schema.pullRequests).orderBy(asc(schema.pullRequests.number));
      expect(prs.map((p) => p.packageNames)).toEqual([["lodash", "@types/node"], []]);
      adapter.repos.get("11")![0]!.prs = [makePr(5, "x", ["lodash"])];
      await runGithubSync({ db, adapter });
      const [first] = await db.select().from(schema.pullRequests).where(eq(schema.pullRequests.number, 5));
      expect(first?.packageNames).toEqual(["lodash"]);
    });

    it("markiert die Repos einer entfernten Installation mit removed_at, aber nicht bei Fehler oder Pause", async () => {
      const adapter = new FakeAdapter();
      adapter.addOwner("acme", 11, [makeRepo(1, "acme/a")]);
      adapter.addOwner("beta", 12, [makeRepo(2, "beta/b"), makeRepo(3, "beta/c")]);
      await runGithubSync({ db, adapter });
      const removedAt = async (name: string) =>
        (await db.select().from(schema.repositories).where(eq(schema.repositories.fullName, name)))[0]!.removedAt;

      // listConnections schlägt fehl bzw. pausiert: nichts wird markiert.
      adapter.connectionsFail = new PlatformApiError(500, "GET", "/app/installations");
      await expect(runGithubSync({ db, adapter })).rejects.toBeInstanceOf(PlatformApiError);
      adapter.connectionsFail = new RateLimitPause(10, 5000, null);
      await runGithubSync({ db, adapter });
      expect(await removedAt("beta/b")).toBeNull();

      // Erfolgreicher Abruf ohne beta: dessen Repos sind entfernt, die von acme nicht.
      adapter.connectionsFail = null;
      adapter.connections = adapter.connections.filter((c) => c.ownerName === "acme");
      await runGithubSync({ db, adapter });
      expect(await removedAt("beta/b")).not.toBeNull();
      expect(await removedAt("beta/c")).not.toBeNull();
      expect(await removedAt("acme/a")).toBeNull();

      // Installation kommt wieder: die Repos sind wieder da.
      adapter.addOwner("beta", 12, adapter.repos.get("12")!);
      adapter.connections = adapter.connections.filter((c, i, all) => all.findIndex((x) => x.externalConnectionId === c.externalConnectionId) === i);
      await runGithubSync({ db, adapter });
      expect(await removedAt("beta/b")).toBeNull();
    });

    it("meldet einen Fehler beim Anlegen einer Connection als Teilfehler, die nächste läuft weiter", async () => {
      const [tenant] = await db.select().from(schema.tenants).limit(1);
      // Gleicher Owner unter anderer Installations-ID: verletzt (tenant, platform, owner) -> 23505.
      await db
        .insert(schema.platformConnections)
        .values({ tenantId: tenant!.id, platform: "github", ownerName: "acme", installationId: 99 });
      const adapter = new FakeAdapter();
      adapter.addOwner("acme", 11, [makeRepo(1, "acme/a")]);
      adapter.addOwner("beta", 12, [makeRepo(2, "beta/b")]);
      const summary = await runGithubSync({ db, adapter });
      expect(summary.partialErrors).toEqual([
        { repository: "acme", message: "Datenbankfehler (Eindeutigkeitskonflikt)" },
      ]);
      const repos = await db.select().from(schema.repositories);
      expect(repos.map((r) => r.fullName)).toEqual(["beta/b"]);
      expect(summary.connections).toBe(1);
    });

    it("ordnet neue Connections dem ältesten Tenant zu", async () => {
      const [first] = await db.select().from(schema.tenants).orderBy(asc(schema.tenants.createdAt)).limit(1);
      const [later] = await db
        .insert(schema.tenants)
        .values({ name: `Später ${randomBytes(3).toString("hex")}`, createdAt: new Date(Date.now() + 86_400_000) })
        .returning();
      try {
        const adapter = new FakeAdapter();
        adapter.addOwner("acme", 11, [makeRepo(1, "acme/a")]);
        await runGithubSync({ db, adapter });
        const [conn] = await db.select().from(schema.platformConnections);
        expect(conn?.tenantId).toBe(first!.id);
      } finally {
        await pool.query("truncate platform_connections cascade");
        await db.delete(schema.tenants).where(eq(schema.tenants.id, later!.id));
      }
    });

    it("speichert Head-SHA und Inhalt sofort; ein Fehler im PR-Teil ist ein Teilfehler", async () => {
      const adapter = new FakeAdapter();
      adapter.addOwner("acme", 11, [makeRepo(1, "acme/a", { config: null, caller: false })]);
      await runGithubSync({ db, adapter });

      const r = adapter.repos.get("11")![0]!;
      r.head = "sha-1-2";
      r.config = "renovate.json";
      r.caller = true;
      r.prsFail = new PlatformApiError(502, "GET", "/pulls");
      const summary = await runGithubSync({ db, adapter });

      expect(summary.partialErrors).toEqual([
        { repository: "acme/a", message: "Pull Requests: Plattform-Fehler (Status 502)" },
      ]);
      const [repo] = await db.select().from(schema.repositories);
      expect(repo).toMatchObject({
        headSha: "sha-1-2",
        configPath: "renovate.json",
        onboardingStatus: "onboarded",
        buildCheckStatus: "active",
      });
      expect(repo?.syncedAt).not.toBeNull();
      expect(repo?.dependencyDashboardUrl).toBe("https://example.test/acme/a/issues/1");
      // Der Inhalt wird nicht noch einmal gelesen.
      await runGithubSync({ db, adapter });
      expect(adapter.calls.getRepositoryState).toBe(2);
    });

    it("behält den alten Dependency-Dashboard-Link, wenn die Suche fehlschlägt", async () => {
      const adapter = new FakeAdapter();
      adapter.addOwner("acme", 11, [makeRepo(1, "acme/a", { prs: [makePr(3, "p")] })]);
      await runGithubSync({ db, adapter });
      adapter.repos.get("11")![0]!.dashboardFail = new PlatformApiError(500, "GET", "/issues");
      const summary = await runGithubSync({ db, adapter });
      expect(summary.partialErrors).toEqual([
        { repository: "acme/a", message: "Dependency Dashboard: Plattform-Fehler (Status 500)" },
      ]);
      const [repo] = await db.select().from(schema.repositories);
      expect(repo?.dependencyDashboardUrl).toBe("https://example.test/acme/a/issues/1");
      // Die PRs wurden trotzdem abgeglichen.
      expect(await db.select().from(schema.pullRequests)).toHaveLength(1);
    });

    it("behandelt ein leeres Repo als ohne Inhalt, PRs und Dashboard laufen trotzdem", async () => {
      const adapter = new FakeAdapter();
      adapter.addOwner("acme", 11, [makeRepo(1, "acme/leer", { head: null, config: "renovate.json", caller: true, prs: [makePr(2, "p")] })]);
      const summary = await runGithubSync({ db, adapter });
      expect(summary.partialErrors).toEqual([]);
      const [repo] = await db.select().from(schema.repositories);
      expect(repo).toMatchObject({
        headSha: null,
        configPath: null,
        onboardingStatus: "none",
        buildCheckStatus: "missing",
        dependencyDashboardUrl: "https://example.test/acme/leer/issues/1",
      });
      expect(repo?.syncedAt).not.toBeNull();
      expect(adapter.calls.getRepositoryState).toBe(0);
      expect(await db.select().from(schema.pullRequests)).toHaveLength(1);
    });

    it("überschreibt einen parallel gesetzten ce_status nicht (frisch gelesen)", async () => {
      const adapter = new FakeAdapter();
      adapter.addOwner("acme", 11, [makeRepo(1, "acme/a")]);
      await runGithubSync({ db, adapter });
      // Neuer Head-SHA; während des Abgleichs (Zeile ist schon geladen) setzt CE "disabled".
      const r = adapter.repos.get("11")![0]!;
      r.head = "sha-1-2";
      r.onHead = async () => {
        await pool.query("update repositories set ce_status = 'disabled'");
      };
      await runGithubSync({ db, adapter });
      const [repo] = await db.select().from(schema.repositories);
      expect(repo).toMatchObject({ ceStatus: "disabled", onboardingStatus: "disabled" });
    });

    it("gleicht die ältesten Abgleiche zuerst ab (synced_at aufsteigend, NULL zuerst)", async () => {
      const adapter = new FakeAdapter();
      adapter.addOwner("acme", 11, [makeRepo(1, "acme/a"), makeRepo(2, "acme/b"), makeRepo(3, "acme/c")]);
      await runGithubSync({ db, adapter });
      await pool.query(
        `update repositories set synced_at = case full_name
           when 'acme/a' then now() when 'acme/c' then now() - interval '1 hour' else null end`,
      );
      adapter.headCalls = [];
      await runGithubSync({ db, adapter });
      expect(adapter.headCalls).toEqual(["acme/b", "acme/c", "acme/a"]);
    });

    it("löscht ETag-Einträge, die älter als 7 Tage sind, am Ende des Durchlaufs", async () => {
      await pool.query(
        `insert into http_cache (key, etag, body, updated_at) values
           ('alt', 'e', '{}', now() - interval '8 days'),
           ('neu', 'e', '{}', now() - interval '6 days')`,
      );
      const adapter = new FakeAdapter();
      adapter.addOwner("acme", 11, [makeRepo(1, "acme/a")]);
      await runGithubSync({ db, adapter });
      const keys = (await db.select().from(schema.httpCache)).map((c) => c.key);
      expect(keys).toEqual(["neu"]);
    });
  });

  describe("Automatisches Onboarding", () => {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const bare = (id: number, name: string) => makeRepo(id, name, { config: null, caller: false });
    const connId = async (owner: string) =>
      (await db.select().from(schema.platformConnections).where(eq(schema.platformConnections.ownerName, owner)))[0]!.id;
    const sync = (adapter: FakeAdapter) =>
      runGithubSync({ db, adapter, rollout: createRolloutService({ db, adapter }) });
    const repoOf = async (fullName: string) =>
      (await db.select().from(schema.repositories).where(eq(schema.repositories.fullName, fullName)))[0]!;

    it("Neues Repo bei eingeschaltetem Schalter: PR beim nächsten Abgleich, Repos davor nicht", async () => {
      const adapter = new FakeAdapter();
      adapter.addOwner("acme", 11, [bare(1, "acme/alt")]);
      await sync(adapter);
      await sleep(10);
      await setAutoOnboarding(db, await connId("acme"), true, "tester", new Date());
      await sleep(10);

      adapter.repos.get("11")!.push(bare(2, "acme/neu"));
      const summary = await sync(adapter);

      expect(summary.partialErrors).toEqual([]);
      expect(adapter.changeRequests.map((c) => c.repo)).toEqual(["acme/neu"]);
      expect(adapter.changeRequests[0]!.request.branch).toBe("renovate-platform/onboarding");
      expect((await repoOf("acme/neu")).onboardingStatus).toBe("pr_open");
      expect((await repoOf("acme/alt")).onboardingStatus).toBe("none");
      const actions = await db.select().from(schema.rolloutActions);
      expect(actions).toHaveLength(1);
      expect(actions[0]).toMatchObject({ kind: "onboarding", triggeredBy: "auto", status: "pr_open" });
      const audit = await db.select().from(schema.auditLog);
      expect(audit.map((a) => [a.actor, a.action])).toEqual(
        expect.arrayContaining([["auto", "rollout.onboarding"], ["tester", "settings.auto_onboarding"]]),
      );
    });

    it("Geschlossener Onboarding-PR: kein neuer automatischer PR", async () => {
      const adapter = new FakeAdapter();
      adapter.addOwner("acme", 11, []);
      await sync(adapter);
      await setAutoOnboarding(db, await connId("acme"), true, "tester", new Date());
      await sleep(10);
      adapter.repos.get("11")!.push(bare(1, "acme/neu"));
      await sync(adapter);
      expect(adapter.changeRequests).toHaveLength(1);

      // Betreiber schließt den PR ungemergt.
      const number = adapter.changeRequests[0]!.number;
      adapter.prStates.set(number, { state: "closed", mergedAt: null });
      adapter.openChangeRequests.clear();
      await sync(adapter);
      await sync(adapter);

      expect(adapter.changeRequests).toHaveLength(1);
      const [action] = await db.select().from(schema.rolloutActions);
      expect(action?.status).toBe("closed");
      expect((await repoOf("acme/neu")).onboardingStatus).toBe("none");
    });

    it("ist standardmäßig aus und legt bei ausgeschaltetem Schalter nichts an", async () => {
      const adapter = new FakeAdapter();
      adapter.addOwner("acme", 11, []);
      await sync(adapter);
      adapter.repos.get("11")!.push(bare(1, "acme/neu"));
      await sync(adapter);
      expect(adapter.changeRequests).toHaveLength(0);
      const [conn] = await db.select().from(schema.platformConnections);
      expect(conn).toMatchObject({ autoOnboarding: false, autoOnboardingEnabledAt: null });
    });

    it("legt höchstens 5 PRs je Durchlauf an und holt den Rest im nächsten", async () => {
      const adapter = new FakeAdapter();
      adapter.addOwner("acme", 11, []);
      await sync(adapter);
      await setAutoOnboarding(db, await connId("acme"), true, "tester", new Date());
      await sleep(10);
      adapter.repos.get("11")!.push(...[1, 2, 3, 4, 5, 6, 7].map((i) => bare(i, `acme/r${i}`)));

      await sync(adapter);
      expect(adapter.changeRequests).toHaveLength(5);
      await sync(adapter);
      expect(adapter.changeRequests).toHaveLength(7);
      expect(new Set(adapter.changeRequests.map((c) => c.repo)).size).toBe(7);
    });

    it("Fehlschläge vor pending verhungern nicht: failed-Aktion (einmal), Limit je Connection", async () => {
      const adapter = new FakeAdapter();
      adapter.addOwner("acme", 11, []);
      adapter.addOwner("beta", 12, []);
      await sync(adapter);
      await setAutoOnboarding(db, await connId("acme"), true, "tester", new Date());
      await setAutoOnboarding(db, await connId("beta"), true, "tester", new Date());
      await sleep(10);
      adapter.repos.get("11")!.push(...[1, 2, 3, 4, 5].map((i) => bare(i, `acme/kaputt${i}`)), bare(6, "acme/gut"));
      adapter.repos.get("12")!.push(bare(7, "beta/gut"));
      // Die Vorabfrage scheitert für fünf Repos von acme: es entsteht nie ein pending-Eintrag.
      const find = adapter.findOpenChangeRequest.bind(adapter);
      let lookups: string[] = [];
      adapter.findOpenChangeRequest = async (c, ref, branch) => {
        lookups.push(ref.fullName);
        if (ref.fullName.startsWith("acme/kaputt")) throw new PlatformApiError(502, "GET", "/geheim");
        return find(c, ref, branch);
      };

      const first = await sync(adapter);
      expect(first.partialErrors.map((e) => e.repository).sort()).toEqual([1, 2, 3, 4, 5].map((i) => `acme/kaputt${i}`));
      // beta kommt trotz der fünf Fehler bei acme dran (Limit je Connection).
      expect(adapter.changeRequests.map((c) => c.repo)).toEqual(["beta/gut"]);
      const failed = await db.select().from(schema.rolloutActions).where(eq(schema.rolloutActions.status, "failed"));
      expect(failed).toHaveLength(5);
      expect(failed[0]).toMatchObject({ kind: "onboarding", triggeredBy: "auto", error: "Die Plattform hat die Anfrage abgelehnt (Status 502)." });
      const audit = await db.select().from(schema.auditLog);
      expect(audit.filter((a) => a.action === "rollout.onboarding.failed")).toHaveLength(5);

      // Nächster Durchlauf: die fünf werden nicht wiederholt (manueller Klick nötig), acme/gut kommt dran.
      lookups = [];
      const second = await sync(adapter);
      expect(lookups.filter((n) => n.startsWith("acme/kaputt"))).toEqual([]);
      expect(second.partialErrors).toEqual([]);
      expect(adapter.changeRequests.map((c) => c.repo).sort()).toEqual(["acme/gut", "beta/gut"]);
      expect(JSON.stringify(first.partialErrors)).not.toContain("geheim");
    });

    it("Kontingent-Pause vor pending bleibt ohne Spur: das Repo kommt später dran", async () => {
      const adapter = new FakeAdapter();
      adapter.addOwner("acme", 11, []);
      await sync(adapter);
      await setAutoOnboarding(db, await connId("acme"), true, "tester", new Date());
      await sleep(10);
      adapter.repos.get("11")!.push(bare(1, "acme/spaeter"));
      const find = adapter.findOpenChangeRequest.bind(adapter);
      let paused = true;
      adapter.findOpenChangeRequest = async (c, ref, branch) => {
        if (paused) throw new RateLimitPause(0, 5000, new Date(Date.now() + 60_000));
        return find(c, ref, branch);
      };
      await sync(adapter);
      expect(await db.select().from(schema.rolloutActions)).toHaveLength(0);
      expect((await db.select().from(schema.auditLog)).filter((a) => a.action.startsWith("rollout."))).toHaveLength(0);

      paused = false;
      await sync(adapter);
      expect(adapter.changeRequests.map((c) => c.repo)).toEqual(["acme/spaeter"]);
    });

    it("überspringt archivierte Repos und solche mit Konfiguration; Fehler je Repo sind Teilfehler", async () => {
      const adapter = new FakeAdapter();
      adapter.addOwner("acme", 11, []);
      await sync(adapter);
      await setAutoOnboarding(db, await connId("acme"), true, "tester", new Date());
      await sleep(10);
      adapter.repos.get("11")!.push(
        { ...bare(1, "acme/archiv"), archived: true },
        makeRepo(2, "acme/mit-config"),
        bare(3, "acme/kaputt"),
        bare(4, "acme/gut"),
      );
      const create = adapter.createChangeRequest.bind(adapter);
      adapter.createChangeRequest = async (c, ref, req) => {
        if (ref.fullName === "acme/kaputt") throw new PlatformApiError(500, "POST", "/geheim");
        return create(c, ref, req);
      };
      const summary = await sync(adapter);
      expect(adapter.changeRequests.map((c) => c.repo)).toEqual(["acme/gut"]);
      expect(summary.partialErrors).toEqual([
        {
          repository: "acme/kaputt",
          message: "Automatisches Onboarding: Die Plattform hat die Anfrage abgelehnt (Status 500).",
        },
      ]);
      expect(JSON.stringify(summary.partialErrors)).not.toContain("geheim");
    });

    it("setAutoOnboarding: Zeitpunkt beim Einschalten, bleibt beim Ausschalten; wiederholtes Einschalten ändert nichts", async () => {
      const adapter = new FakeAdapter();
      adapter.addOwner("acme", 11, []);
      await sync(adapter);
      const id = await connId("acme");
      const t1 = new Date("2026-05-01T10:00:00Z");
      expect(await setAutoOnboarding(db, id, true, "tester", t1)).toBe(true);
      expect(await setAutoOnboarding(db, id, true, "tester", new Date("2026-06-01T10:00:00Z"))).toBe(false);
      expect(await setAutoOnboarding(db, id, false, "tester", new Date("2026-07-01T10:00:00Z"))).toBe(true);
      const [conn] = await db.select().from(schema.platformConnections);
      expect(conn).toMatchObject({ autoOnboarding: false, autoOnboardingEnabledAt: t1 });
      const audit = await db.select().from(schema.auditLog);
      expect(audit.map((a) => [a.action, a.target])).toEqual([
        ["settings.auto_onboarding", "acme: an"],
        ["settings.auto_onboarding", "acme: aus"],
      ]);
      await expect(setAutoOnboarding(db, "00000000-0000-0000-0000-000000000000", true, "t")).rejects.toThrow();
    });
  });

  describe("CE-Abgleich", () => {
    function fakeCe(over: {
      history?: CeJobReport[];
      queue?: CeQueue;
      repos?: CeRepo[];
      log?: () => Promise<string>;
    }) {
      const getJobLog = vi.fn(
        over.log ??
          (async () =>
            [
              JSON.stringify({ time: "2026-10-15T07:00:00Z", level: 50, msg: "boom", token: "geheim" }),
              JSON.stringify({ level: 30, msg: "info" }),
            ].join("\n")),
      );
      const client = {
        getQueue: async () => over.queue ?? { running: [], pending: [] },
        listOrgs: async () => [{ name: "acme" }],
        listOrgRepos: async () => over.repos ?? [],
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        listRepoJobs: async (_fullName: string) => over.history ?? [],
        getJobLog,
      } satisfies Pick<CeClient, "getQueue" | "listOrgs" | "listOrgRepos" | "listRepoJobs" | "getJobLog">;
      return { client, getJobLog };
    }

    async function seedGithub() {
      const adapter = new FakeAdapter();
      adapter.addOwner("acme", 11, [makeRepo(1, "acme/a")]);
      await runGithubSync({ db, adapter });
    }

    it("schreibt Jobs idempotent und holt den Log-Auszug nur einmal", async () => {
      await seedGithub();
      const history: CeJobReport[] = [
        { jobId: "j-ok", reason: "schedule-all", status: "success", startedAt: "2026-10-15T06:00:00Z", completedAt: "2026-10-15T06:01:00Z" },
        {
          jobId: "j-fail",
          reason: "api-request",
          status: "cli-error",
          startedAt: "2026-10-15T07:00:00Z",
          completedAt: "2026-10-15T07:01:00Z",
          error: { name: "ConfigError", message: "config validation failed" },
        },
      ];
      const { client, getJobLog } = fakeCe({ history, repos: [{ name: "a", fullName: "acme/a", status: "onboarded" }] });

      await runCeSync({ db, client });
      await runCeSync({ db, client });

      const jobs = await db.select().from(schema.renovateJobs).orderBy(asc(schema.renovateJobs.ceJobId));
      expect(jobs).toHaveLength(2);
      const fail = jobs.find((j) => j.ceJobId === "j-fail")!;
      expect(fail).toMatchObject({
        status: "failed",
        statusRaw: "cli-error",
        trigger: "manual",
        reason: "api-request",
        errorMessage: "ConfigError: config validation failed",
      });
      expect(fail.logExcerpt).toContain("boom");
      expect(fail.logExcerpt).not.toContain("geheim");
      expect(jobs.find((j) => j.ceJobId === "j-ok")).toMatchObject({ status: "success", trigger: "schedule", logExcerpt: null });
      expect(getJobLog).toHaveBeenCalledTimes(1);
      expect(getJobLog).toHaveBeenCalledWith("j-fail");

      const [repo] = await db.select().from(schema.repositories);
      expect(repo).toMatchObject({ ceStatus: "onboarded", lastJobResult: "failed" });
      expect(repo?.lastJobAt?.toISOString()).toBe("2026-10-15T07:01:00.000Z");

      // Konfigurationsfehler im letzten Job -> Problem config_error, einmalig.
      const open = await db.select().from(schema.problems);
      expect(open.filter((p) => p.resolvedAt === null).map((p) => p.kind)).toContain("config_error");
      expect(open.filter((p) => p.kind === "config_error")).toHaveLength(1);

      const state = (await db.select().from(schema.syncState).where(eq(schema.syncState.source, "ce")))[0];
      expect(state?.lastSuccessAt).not.toBeNull();
      expect(state?.partialErrors).toEqual([]);
    });

    it("übernimmt laufende und wartende Jobs aus der Queue und setzt beendete nicht zurück", async () => {
      await seedGithub();
      const queue: CeQueue = {
        running: [{ jobId: "q-run", reason: "main-commit", repository: "acme/a", startedAt: "2026-10-15T08:00:00Z" }],
        pending: [
          { jobId: "q-wait", reason: "hourly", repository: "acme/a" },
          { jobId: "q-fremd", reason: "hourly", repository: "fremd/unbekannt" },
        ],
      };
      await runCeSync({ db, client: fakeCe({ queue }).client });
      let jobs = await db.select().from(schema.renovateJobs).orderBy(asc(schema.renovateJobs.ceJobId));
      expect(jobs.map((j) => [j.ceJobId, j.status, j.trigger])).toEqual([
        ["q-run", "running", "webhook"],
        ["q-wait", "queued", "schedule"],
      ]);

      // Der Job endet in der Historie; steht er noch in der Queue, bleibt er beendet.
      const history: CeJobReport[] = [
        { jobId: "q-run", reason: "main-commit", status: "success", startedAt: "2026-10-15T08:00:00Z", completedAt: "2026-10-15T08:02:00Z" },
      ];
      await runCeSync({ db, client: fakeCe({ queue, history }).client });
      jobs = await db.select().from(schema.renovateJobs).orderBy(asc(schema.renovateJobs.ceJobId));
      expect(jobs.find((j) => j.ceJobId === "q-run")?.status).toBe("success");
    });

    it("vermerkt einen Repo-Fehler als Teilfehler und macht mit dem Rest weiter", async () => {
      const adapter = new FakeAdapter();
      adapter.addOwner("acme", 11, [makeRepo(1, "acme/a"), makeRepo(2, "acme/b")]);
      await runGithubSync({ db, adapter });
      const { client } = fakeCe({});
      client.listRepoJobs = async (fullName: string) => {
        if (fullName === "acme/a") throw new CeApiError("roh geheim", "/x", 500);
        return [{ jobId: "b-1", reason: "hourly", status: "success", startedAt: "2026-10-15T06:00:00Z", completedAt: "2026-10-15T06:01:00Z" }];
      };
      const summary = await runCeSync({ db, client });
      expect(summary.partialErrors).toEqual([{ repository: "acme/a", message: "CE-Fehler (Status 500)" }]);
      const jobs = await db.select().from(schema.renovateJobs);
      expect(jobs.map((j) => j.ceJobId)).toEqual(["b-1"]);
    });

    function jobsOf(name: string) {
      return db.select().from(schema.renovateJobs).where(eq(schema.renovateJobs.ceJobId, name));
    }

    it("überschreibt vorhandene Start- und Endzeiten nicht mit null", async () => {
      await seedGithub();
      const full: CeJobReport = { jobId: "j1", reason: "hourly", status: "success", startedAt: "2026-10-15T06:00:00Z", completedAt: "2026-10-15T06:01:00Z" };
      await runCeSync({ db, client: fakeCe({ history: [full] }).client });
      await runCeSync({ db, client: fakeCe({ history: [{ jobId: "j1", reason: "hourly", status: "success" }] }).client });
      const [job] = await jobsOf("j1");
      expect(job?.startedAt?.toISOString()).toBe("2026-10-15T06:00:00.000Z");
      expect(job?.finishedAt?.toISOString()).toBe("2026-10-15T06:01:00.000Z");

      // Auch der Queue-Eintrag ohne Startzeit lässt eine vorhandene stehen.
      const queue: CeQueue = { running: [{ jobId: "q1", reason: "hourly", repository: "acme/a", startedAt: "2026-10-15T08:00:00Z" }], pending: [] };
      await runCeSync({ db, client: fakeCe({ queue }).client });
      await runCeSync({ db, client: fakeCe({ queue: { running: [{ jobId: "q1", reason: "hourly", repository: "acme/a" }], pending: [] } }).client });
      const [q] = await jobsOf("q1");
      expect(q?.startedAt?.toISOString()).toBe("2026-10-15T08:00:00.000Z");
    });

    it("wirft bei einem Log-Fehler (außer 404/410) nicht, vermerkt ihn und versucht es erneut", async () => {
      await seedGithub();
      const history: CeJobReport[] = [
        { jobId: "ok", reason: "hourly", status: "success", startedAt: "2026-10-15T05:00:00Z", completedAt: "2026-10-15T05:01:00Z" },
        { jobId: "bad", reason: "hourly", status: "cli-error", startedAt: "2026-10-15T07:00:00Z", completedAt: "2026-10-15T07:01:00Z", error: { name: "Error", message: "x" } },
      ];
      let broken = true;
      const log = async () => {
        if (broken) throw new CeApiError("roh geheim", "/logs", 500);
        return JSON.stringify({ level: 50, msg: "boom" });
      };
      const first = await runCeSync({ db, client: fakeCe({ history, log }).client });
      expect(first.partialErrors).toEqual([{ repository: "acme/a", message: "Log: CE-Fehler (Status 500)" }]);
      let [repo] = await db.select().from(schema.repositories);
      // last_job wird trotzdem aktualisiert, das Problem job_failed entsteht.
      expect(repo).toMatchObject({ lastJobResult: "failed" });
      expect(repo?.lastJobAt?.toISOString()).toBe("2026-10-15T07:01:00.000Z");
      expect((await jobsOf("bad"))[0]?.logExcerpt).toBeNull();
      expect(JSON.stringify(first)).not.toContain("geheim");

      broken = false;
      const second = await runCeSync({ db, client: fakeCe({ history, log }).client });
      expect(second.partialErrors).toEqual([]);
      expect((await jobsOf("bad"))[0]?.logExcerpt).toContain("boom");
      [repo] = await db.select().from(schema.repositories);
      expect(repo?.lastJobResult).toBe("failed");
    });

    it("ignoriert purged-Jobs: kein job_failed, kein Log-Abruf, letzter Job ist der davor", async () => {
      await seedGithub();
      const history: CeJobReport[] = [
        { jobId: "alt", reason: "hourly", status: "success", startedAt: "2026-10-15T05:00:00Z", completedAt: "2026-10-15T05:01:00Z" },
        { jobId: "weg", reason: "hourly", status: "purged", startedAt: "2026-10-15T07:00:00Z", completedAt: "2026-10-15T07:01:00Z" },
      ];
      const { client, getJobLog } = fakeCe({ history });
      await runCeSync({ db, client });
      expect(getJobLog).not.toHaveBeenCalled();
      expect((await jobsOf("weg"))[0]).toMatchObject({ status: "failed", statusRaw: "purged" });
      expect((await db.select().from(schema.problems)).filter((p) => p.kind === "job_failed")).toHaveLength(0);
      const [repo] = await db.select().from(schema.repositories);
      expect(repo?.lastJobResult).toBe("success");
      expect(repo?.lastJobAt?.toISOString()).toBe("2026-10-15T05:01:00.000Z");
    });

    it("meldet gleichnamige Repos in mehreren Connections als Kollision und ordnet nichts zu", async () => {
      const adapter = new FakeAdapter();
      adapter.addOwner("acme", 11, [makeRepo(1, "acme/a")]);
      adapter.addOwner("neu", 12, [makeRepo(2, "acme/a")]); // gleicher Name, andere Connection
      await runGithubSync({ db, adapter });
      const listRepoJobs = vi.fn(async () => [
        { jobId: "k1", reason: "hourly", status: "success", startedAt: "2026-10-15T06:00:00Z", completedAt: "2026-10-15T06:01:00Z" } as CeJobReport,
      ]);
      const { client } = fakeCe({ repos: [{ name: "a", fullName: "acme/a", status: "failed" }] });
      client.listRepoJobs = listRepoJobs;
      const summary = await runCeSync({ db, client });
      expect(summary.partialErrors).toEqual([
        { repository: "acme/a", message: "Mehrdeutige Zuordnung (mehrere Repos mit gleichem Namen)" },
      ]);
      expect(listRepoJobs).not.toHaveBeenCalled();
      expect(await db.select().from(schema.renovateJobs)).toHaveLength(0);
      const repos = await db.select().from(schema.repositories);
      expect(repos.map((r) => r.ceStatus)).toEqual([null, null]);
    });

    it("liest config_path vor dem Onboarding-Status frisch (kein Überschreiben durch den GitHub-Abgleich)", async () => {
      const adapter = new FakeAdapter();
      adapter.addOwner("acme", 11, [makeRepo(1, "acme/a", { config: null, caller: false })]);
      await runGithubSync({ db, adapter });
      const { client } = fakeCe({});
      client.listOrgRepos = async () => {
        // Der GitHub-Abgleich hat parallel eine Konfiguration gefunden.
        await pool.query("update repositories set config_path = 'renovate.json', onboarding_status = 'onboarded'");
        return [{ name: "a", fullName: "acme/a", status: "onboarded" }];
      };
      await runCeSync({ db, client });
      const [repo] = await db.select().from(schema.repositories);
      expect(repo).toMatchObject({ ceStatus: "onboarded", onboardingStatus: "onboarded" });
    });

    describe("verschwundene Jobs", () => {
      async function seedJobs() {
        const adapter = new FakeAdapter();
        adapter.addOwner("acme", 11, [makeRepo(1, "acme/a"), makeRepo(2, "acme/archiv")]);
        await runGithubSync({ db, adapter });
        const rows = await db.select().from(schema.repositories);
        const a = rows.find((r) => r.fullName === "acme/a")!;
        const arch = rows.find((r) => r.fullName === "acme/archiv")!;
        await db.insert(schema.renovateJobs).values([
          { repositoryId: a.id, ceJobId: "alt-queued", trigger: "schedule", status: "queued", statusRaw: "queued" },
          { repositoryId: a.id, ceJobId: "alt-running", trigger: "schedule", status: "running", statusRaw: "running", startedAt: new Date(Date.now() - 7 * 3_600_000) },
          { repositoryId: a.id, ceJobId: "jung", trigger: "schedule", status: "queued", statusRaw: "queued" },
          { repositoryId: a.id, ceJobId: "in-queue", trigger: "schedule", status: "queued", statusRaw: "queued" },
          { repositoryId: arch.id, ceJobId: "archiv-jung", trigger: "schedule", status: "running", statusRaw: "running" },
        ]);
        await pool.query(
          `update renovate_jobs set created_at = now() - interval '7 hours' where ce_job_id in ('alt-queued', 'in-queue')`,
        );
        await pool.query("update repositories set archived = true where full_name = 'acme/archiv'");
        return a;
      }

      it("setzt alte, nirgends mehr gelistete Jobs (und die archivierter Repos) auf failed/verschwunden", async () => {
        await seedJobs();
        const queue: CeQueue = { running: [], pending: [{ jobId: "in-queue", reason: "hourly", repository: "acme/a" }] };
        await runCeSync({ db, client: fakeCe({ queue }).client });
        const status = async (id: string) => (await jobsOf(id))[0]!;
        expect(await status("alt-queued")).toMatchObject({ status: "failed", statusRaw: "verschwunden" });
        expect(await status("alt-running")).toMatchObject({ status: "failed", statusRaw: "verschwunden" });
        expect(await status("archiv-jung")).toMatchObject({ status: "failed", statusRaw: "verschwunden" });
        // Jung oder noch in der Queue: bleibt.
        expect(await status("jung")).toMatchObject({ status: "queued" });
        expect(await status("in-queue")).toMatchObject({ status: "queued" });
      });

      it("fasst nichts an, wenn die Queue nicht gelesen werden konnte oder die Historie fehlt", async () => {
        await seedJobs();
        const { client } = fakeCe({});
        client.getQueue = async () => {
          throw new CeApiError("x", "/queue", 503);
        };
        client.listRepoJobs = async () => {
          throw new CeApiError("x", "/jobs", 503);
        };
        await runCeSync({ db, client });
        const rows = await db.select().from(schema.renovateJobs);
        expect(rows.filter((r) => r.statusRaw === "verschwunden")).toHaveLength(0);

        // Queue gelesen, aber die Historie von acme/a nicht: nur das Archiv-Repo wird bereinigt.
        const { client: c2 } = fakeCe({});
        c2.listRepoJobs = async () => {
          throw new CeApiError("x", "/jobs", 503);
        };
        await runCeSync({ db, client: c2 });
        const after = await db.select().from(schema.renovateJobs);
        expect(after.filter((r) => r.statusRaw === "verschwunden").map((r) => r.ceJobId)).toEqual(["archiv-jung"]);
      });
    });
  });
});
