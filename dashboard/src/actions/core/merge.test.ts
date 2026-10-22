import path from "node:path";
import { randomBytes } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/db/client";
import { runMigrations } from "@/db/migrate";
import * as schema from "@/db/schema";
import { BULK_MERGE_LIMIT, type MergeMethod, type MergeTarget } from "@/merge/types";
import {
  PlatformApiError,
  PlatformHeadChangedError,
  PlatformPermissionError,
  PlatformRejectedError,
  RateLimitPause,
  type ConnectionRef,
  type MergeReadiness,
  type MergeRequest,
  type RepositoryRef,
} from "@/platform";
import { listBulkMergeCandidates } from "@/queries/merge";
import {
  BULK_PAUSE_MS,
  bulkResultToState,
  type BulkMergeResult,
  mergeAllGreenCore,
  mergeOutcomeToState,
  mergePullRequestCore,
  type MergePlatform,
} from "./merge";

/**
 * Merge-Kern gegen eine echte Postgres (DATABASE_URL, ohne die Variable übersprungen) mit einer
 * Fake-Plattform: kein Netzaufruf.
 */
const adminUrl = process.env.DATABASE_URL;
const migrationsFolder = path.join(process.cwd(), "drizzle");

const SHA = "a".repeat(40);

type Live = Partial<MergeReadiness> & { readError?: Error; mergeError?: Error };

/** Fake-Plattform: `live` je "repo#nummer" überschreibt die Voraussetzungen; Merges werden notiert. */
function fakePlatform() {
  const live = new Map<string, Live>();
  const merges: { repo: string; number: number; request: MergeRequest }[] = [];
  const reads: string[] = [];
  const key = (repo: RepositoryRef, n: number) => `${repo.fullName}#${n}`;
  const platform: MergePlatform = {
    async getMergeReadiness(_c: ConnectionRef, repo: RepositoryRef, number: number): Promise<MergeReadiness> {
      reads.push(key(repo, number));
      const o = live.get(key(repo, number)) ?? {};
      if (o.readError) throw o.readError;
      return {
        state: "open",
        headSha: SHA,
        mergeable: true,
        ci: "success",
        methods: ["squash", "merge"],
        ...o,
      };
    },
    async mergeChangeRequest(_c: ConnectionRef, repo: RepositoryRef, number: number, request: MergeRequest) {
      const o = live.get(key(repo, number));
      if (o?.mergeError) throw o.mergeError;
      merges.push({ repo: repo.fullName, number, request });
    },
  };
  return { platform, live, merges, reads };
}

describe.skipIf(!adminUrl)("Merge-Kern (Postgres)", () => {
  const dbName = `dashboard_merge_${randomBytes(6).toString("hex")}`;
  let pool: Pool;
  let db: Db;
  let connectionId: string;
  let noInstallConnectionId: string;
  const repoIds: Record<string, string> = {};

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
    await pool.query("truncate audit_log, pull_requests, repositories, platform_connections, tenants cascade");
    const [tenant] = await db.insert(schema.tenants).values({ name: "T" }).returning();
    const [conn] = await db
      .insert(schema.platformConnections)
      .values({ tenantId: tenant!.id, platform: "github", ownerName: "o", installationId: 1 })
      .returning();
    connectionId = conn!.id;
    const [noInstall] = await db
      .insert(schema.platformConnections)
      .values({ tenantId: tenant!.id, platform: "github", ownerName: "x" })
      .returning();
    noInstallConnectionId = noInstall!.id;
    const make = (key: string, over: Partial<typeof schema.repositories.$inferInsert> = {}) => ({
      connectionId,
      externalId: key,
      fullName: `o/${key}`,
      defaultBranch: "main",
      mergeMethods: ["squash", "merge"],
      ...over,
    });
    const rows = await db
      .insert(schema.repositories)
      .values([
        make("a"),
        make("b"),
        make("archiviert", { archived: true }),
        make("entfernt", { removedAt: new Date() }),
        make("ohne-install", { connectionId: noInstallConnectionId }),
        make("keine-methode", { mergeMethods: [] }),
      ])
      .returning();
    for (const r of rows) repoIds[r.externalId] = r.id;
  });

  let counter = 0;
  async function addPr(
    repo: string,
    number: number,
    over: Partial<typeof schema.pullRequests.$inferInsert> = {},
  ): Promise<MergeTarget & { number: number }> {
    const [row] = await db
      .insert(schema.pullRequests)
      .values({
        repositoryId: repoIds[repo]!,
        number,
        title: `Update ${number}`,
        url: `https://example.test/o/${repo}/pull/${number}`,
        updateType: "patch",
        ciStatus: "success",
        headSha: SHA,
        createdAt: new Date(Date.UTC(2026, 9, 1, 0, 0, counter++)),
        updatedAt: new Date(),
        ...over,
      })
      .returning();
    return { pullRequestId: row!.id, expectedSha: SHA, expectedMethod: "squash", number };
  }

  const audit = async () =>
    (await db.select().from(schema.auditLog).orderBy(asc(schema.auditLog.createdAt), asc(schema.auditLog.id))).map(
      (a) => `${a.action}|${a.target}`,
    );
  const stored = async (id: string) =>
    (await db.select().from(schema.pullRequests).where(eq(schema.pullRequests.id, id)))[0]!;

  describe("mergePullRequestCore", () => {
    it("Grüner PR: mergt per Squash mit der Head-SHA, setzt merged und schreibt das AuditLog", async () => {
      const t = await addPr("a", 1);
      const fake = fakePlatform();
      const outcome = await mergePullRequestCore({ db, platform: fake.platform }, { ...t, actor: "sascha" });
      expect(outcome).toEqual({
        status: "merged",
        prUrl: "https://example.test/o/a/pull/1",
        prNumber: 1,
        repoFullName: "o/a",
      });
      expect(fake.merges).toEqual([{ repo: "o/a", number: 1, request: { sha: SHA, method: "squash" } }]);
      const row = await stored(t.pullRequestId);
      expect(row.state).toBe("merged");
      expect(row.mergedAt).not.toBeNull();
      expect(await audit()).toEqual(["pr.merge|o/a #1"]);
      const state = mergeOutcomeToState(outcome, "squash");
      expect(state).toMatchObject({ status: "done", tone: "erfolg", link: { external: true, href: "https://example.test/o/a/pull/1" } });
    });

    it("Neuer Commit seit dem Klick: kein Merge, Grund changed", async () => {
      const t = await addPr("a", 1);
      const fake = fakePlatform();
      fake.live.set("o/a#1", { headSha: "b".repeat(40) });
      const outcome = await mergePullRequestCore({ db, platform: fake.platform }, { ...t, actor: "s" });
      expect(outcome).toMatchObject({ status: "skipped", reason: "changed", prNumber: 1, repoFullName: "o/a" });
      expect(fake.merges).toEqual([]);
      expect((await stored(t.pullRequestId)).state).toBe("open");
      expect(await audit()).toEqual(["pr.merge.skipped|o/a #1 (changed)"]);
    });

    it("409 der Plattform beim Merge: ebenfalls changed", async () => {
      const t = await addPr("a", 1);
      const fake = fakePlatform();
      fake.live.set("o/a#1", { mergeError: new PlatformHeadChangedError() });
      const outcome = await mergePullRequestCore({ db, platform: fake.platform }, { ...t, actor: "s" });
      expect(outcome).toMatchObject({ status: "skipped", reason: "changed" });
      expect((await stored(t.pullRequestId)).state).toBe("open");
    });

    it.each([
      ["failure", "fehlgeschlagen"],
      ["pending", "läuft noch"],
      ["none", "keine CI"],
    ] as const)("CI %s: kein Merge, die Meldung nennt den Status", async (ci, text) => {
      const t = await addPr("a", 1);
      const fake = fakePlatform();
      fake.live.set("o/a#1", { ci });
      const outcome = await mergePullRequestCore({ db, platform: fake.platform }, { ...t, actor: "s" });
      expect(outcome).toMatchObject({ status: "skipped", reason: "ci" });
      expect((outcome as { message: string }).message).toContain(text);
      expect(fake.merges).toEqual([]);
    });

    it("Konflikt und noch offene Berechnung: kein Merge", async () => {
      const t = await addPr("a", 1);
      const u = await addPr("a", 2);
      const fake = fakePlatform();
      fake.live.set("o/a#1", { mergeable: false });
      fake.live.set("o/a#2", { mergeable: null });
      expect(await mergePullRequestCore({ db, platform: fake.platform }, { ...t, actor: "s" })).toMatchObject({
        status: "skipped",
        reason: "conflict",
      });
      const pending = await mergePullRequestCore({ db, platform: fake.platform }, { ...u, actor: "s" });
      expect(pending).toMatchObject({ status: "skipped", reason: "pending" });
      expect((pending as { message: string }).message).toContain("Bitte gleich erneut versuchen");
      expect(fake.merges).toEqual([]);
    });

    it("PR inzwischen gemergt oder geschlossen, oder in der DB nicht mehr offen: not_open", async () => {
      const t = await addPr("a", 1);
      const u = await addPr("a", 2, { state: "closed" });
      const fake = fakePlatform();
      fake.live.set("o/a#1", { state: "merged" });
      expect(await mergePullRequestCore({ db, platform: fake.platform }, { ...t, actor: "s" })).toMatchObject({ reason: "not_open" });
      expect(await mergePullRequestCore({ db, platform: fake.platform }, { ...u, actor: "s" })).toMatchObject({ reason: "not_open" });
      expect(fake.reads).toEqual(["o/a#1"]); // der zweite wurde schon vor der Live-Prüfung erkannt
    });

    it("Methode: Squash erlaubt -> Squash; nur Merge-Commit -> Merge-Commit", async () => {
      const t = await addPr("a", 1);
      const fake = fakePlatform();
      fake.live.set("o/a#1", { methods: ["merge", "rebase"] });
      const merge = { ...t, expectedMethod: "merge" as MergeMethod };
      expect(await mergePullRequestCore({ db, platform: fake.platform }, { ...merge, actor: "s" })).toMatchObject({ status: "merged" });
      expect(fake.merges[0]?.request.method).toBe("merge");
    });

    it("Methode seit der Anzeige geändert: kein Merge, die Meldung nennt die neue Methode", async () => {
      const t = await addPr("a", 1);
      const fake = fakePlatform();
      fake.live.set("o/a#1", { methods: ["merge"] });
      const outcome = await mergePullRequestCore({ db, platform: fake.platform }, { ...t, actor: "s" });
      expect(outcome).toMatchObject({ status: "skipped", reason: "method_changed" });
      expect((outcome as { message: string }).message).toContain("Merge-Commit statt Squash");
      expect(fake.merges).toEqual([]);
    });

    it("Keine erlaubte Methode: no_method", async () => {
      const t = await addPr("a", 1);
      const fake = fakePlatform();
      fake.live.set("o/a#1", { methods: [] });
      expect(await mergePullRequestCore({ db, platform: fake.platform }, { ...t, actor: "s" })).toMatchObject({ reason: "no_method" });
    });

    it("Plattform lehnt ab (Branch-Schutz): skipped rejected mit der festen Meldung", async () => {
      const t = await addPr("a", 1);
      const fake = fakePlatform();
      fake.live.set("o/a#1", { mergeError: new PlatformRejectedError("Die Plattform lehnt den Merge ab (Branch-Schutz).") });
      const outcome = await mergePullRequestCore({ db, platform: fake.platform }, { ...t, actor: "s" });
      expect(outcome).toMatchObject({ status: "skipped", reason: "rejected", message: "Die Plattform lehnt den Merge ab (Branch-Schutz)." });
      expect((await stored(t.pullRequestId)).state).toBe("open");
      expect(await audit()).toEqual(["pr.merge.skipped|o/a #1 (rejected)"]);
    });

    it("Fehler: failed mit fester Meldung und AuditLog, ohne Rohtext", async () => {
      const t = await addPr("a", 1);
      const fake = fakePlatform();
      fake.live.set("o/a#1", { mergeError: new PlatformPermissionError("Der GitHub App fehlen Schreibrechte.") });
      expect(await mergePullRequestCore({ db, platform: fake.platform }, { ...t, actor: "s" })).toMatchObject({
        status: "failed",
        message: "Der GitHub App fehlen Schreibrechte.",
      });
      fake.live.set("o/a#1", { readError: new PlatformApiError(502, "GET", "/repos/o/a/pulls/1") });
      expect(await mergePullRequestCore({ db, platform: fake.platform }, { ...t, actor: "s" })).toMatchObject({
        status: "failed",
        message: "Die Plattform hat die Anfrage abgelehnt (Status 502).",
      });
      fake.live.set("o/a#1", { readError: new RateLimitPause(1, 5000, null) });
      expect(await mergePullRequestCore({ db, platform: fake.platform }, { ...t, actor: "s" })).toMatchObject({
        status: "failed",
        message: "Das Kontingent der Plattform ist knapp. Bitte später erneut versuchen.",
      });
      fake.live.set("o/a#1", { readError: new Error("geheim ghs_token") });
      const unknown = await mergePullRequestCore({ db, platform: fake.platform }, { ...t, actor: "s" });
      expect(JSON.stringify(unknown)).not.toContain("ghs_token");
      expect((await audit()).every((a) => a === "pr.merge.failed|o/a #1")).toBe(true);
    });

    it("lehnt PRs entfernter, archivierter und nicht verbundener Repos sowie unbekannte ab", async () => {
      const removed = await addPr("entfernt", 1);
      const archived = await addPr("archiviert", 2);
      const noInstall = await addPr("ohne-install", 3);
      const fake = fakePlatform();
      for (const t of [removed, archived, noInstall]) {
        expect(await mergePullRequestCore({ db, platform: fake.platform }, { ...t, actor: "s" })).toMatchObject({ status: "failed" });
      }
      expect(
        await mergePullRequestCore(
          { db, platform: fake.platform },
          { pullRequestId: "00000000-0000-4000-8000-000000000000", expectedSha: SHA, expectedMethod: "squash", actor: "s" },
        ),
      ).toMatchObject({ status: "failed", message: "Unbekannter Pull Request.", prNumber: null });
      expect(fake.reads).toEqual([]);
      expect(fake.merges).toEqual([]);
      expect(await audit()).toHaveLength(3);
    });

    it("Paralleler Merge: Ablehnung nach dem PUT, PR inzwischen gemergt -> not_open mit eigener Meldung und state merged", async () => {
      const t = await addPr("a", 1);
      const fake = fakePlatform();
      let reads = 0;
      const platform: MergePlatform = {
        async getMergeReadiness(c, repo, n) {
          reads++;
          const base = await fake.platform.getMergeReadiness(c, repo, n);
          return reads >= 2 ? { ...base, state: "merged" } : base;
        },
        async mergeChangeRequest() {
          throw new PlatformRejectedError("Die Plattform lehnt den Merge ab.");
        },
      };
      const outcome = await mergePullRequestCore({ db, platform }, { ...t, actor: "s" });
      expect(outcome).toMatchObject({ status: "skipped", reason: "not_open", message: "Der PR ist bereits gemergt." });
      expect(reads).toBe(2);
      expect((await stored(t.pullRequestId)).state).toBe("merged");
      expect(await audit()).toEqual(["pr.merge.skipped|o/a #1 (not_open)"]);
    });

    it("Ablehnung nach dem PUT, PR weiter offen: bleibt bei rejected", async () => {
      const t = await addPr("a", 1);
      const fake = fakePlatform();
      fake.live.set("o/a#1", { mergeError: new PlatformRejectedError("Die Plattform lehnt den Merge ab.") });
      const outcome = await mergePullRequestCore({ db, platform: fake.platform }, { ...t, actor: "s" });
      expect(outcome).toMatchObject({ reason: "rejected" });
      expect(fake.reads).toHaveLength(2);
      expect((await stored(t.pullRequestId)).state).toBe("open");
    });

    it("blockedReason: Entwurf und Branch-Schutz werden vor dem PUT abgelehnt, behind nie", async () => {
      const t = await addPr("a", 1);
      const fake = fakePlatform();
      fake.live.set("o/a#1", { blockedReason: "protection" });
      expect(await mergePullRequestCore({ db, platform: fake.platform }, { ...t, actor: "s" })).toMatchObject({
        reason: "rejected",
        message: "Branch-Schutz oder fehlende Freigaben verhindern den Merge.",
      });
      fake.live.set("o/a#1", { blockedReason: "draft" });
      expect(await mergePullRequestCore({ db, platform: fake.platform }, { ...t, actor: "s" })).toMatchObject({
        reason: "rejected",
        message: "Der PR ist ein Entwurf.",
      });
      expect(fake.merges).toEqual([]);
      // Kein Hinweis (etwa "behind"): der Merge wird versucht.
      fake.live.set("o/a#1", { blockedReason: null });
      expect((await mergePullRequestCore({ db, platform: fake.platform }, { ...t, actor: "s" })).status).toBe("merged");
    });

    it("Methoden unbekannt (null): eigene Meldung statt 'keine Methode'", async () => {
      const t = await addPr("a", 1);
      const fake = fakePlatform();
      fake.live.set("o/a#1", { methods: null });
      const outcome = await mergePullRequestCore({ db, platform: fake.platform }, { ...t, actor: "s" });
      expect(outcome).toMatchObject({
        reason: "no_method",
        message: "Die erlaubten Merge-Methoden sind nicht lesbar (Rechte der App prüfen).",
      });
      expect(fake.merges).toEqual([]);
    });

    it("Kontingent-Pause beim Einzel-Merge: Meldung mit Uhrzeit (Europe/Berlin)", async () => {
      const t = await addPr("a", 1);
      const fake = fakePlatform();
      fake.live.set("o/a#1", { readError: new RateLimitPause(0, 5000, new Date("2026-10-22T12:30:00Z")) });
      expect(await mergePullRequestCore({ db, platform: fake.platform }, { ...t, actor: "s" })).toMatchObject({
        status: "failed",
        message: "Kontingent knapp, wieder möglich ab 14:30.",
      });
    });

    it("Fehlendes Workflow-Recht: Meldung zum Recht Workflows", async () => {
      const t = await addPr("a", 1);
      const fake = fakePlatform();
      fake.live.set("o/a#1", {
        mergeError: new PlatformPermissionError(
          "Der GitHub App fehlt in diesem Repo das Schreibrecht auf Workflows. Bitte in den App-Einstellungen ergänzen.",
        ),
      });
      expect(await mergePullRequestCore({ db, platform: fake.platform }, { ...t, actor: "s" })).toMatchObject({
        status: "failed",
        message: expect.stringContaining("Workflows"),
      });
    });

    it("gemergt, aber Speichern scheitert: trotzdem merged, ohne Werte im Log", async () => {
      const t = await addPr("a", 1);
      const fake = fakePlatform();
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const broken = {
          ...db,
          select: db.select.bind(db),
          transaction: async () => {
            throw new Error("db weg");
          },
          // Das AuditLog bleibt erreichbar: der Kern schreibt pr.merge dann separat.
          insert: db.insert.bind(db),
        } as unknown as Db;
        const outcome = await mergePullRequestCore({ db: broken, platform: fake.platform }, { ...t, actor: "s" });
        expect(outcome.status).toBe("merged");
        expect(await audit()).toEqual(["pr.merge|o/a #1"]);
        expect(log).toHaveBeenCalled();
        expect(JSON.stringify(log.mock.calls)).not.toContain("db weg");
      } finally {
        log.mockRestore();
      }
    });
  });

  describe("mergeAllGreenCore", () => {
    const sleeps: number[] = [];
    const deps = (platform: MergePlatform) => ({
      db,
      platform,
      sleep: async (ms: number) => {
        sleeps.push(ms);
      },
    });
    beforeEach(() => {
      sleeps.length = 0;
    });

    it("Gemischte Lage: zwei gemergt, einer mit Grund übersprungen; Audit vor dem Start", async () => {
      const t1 = await addPr("a", 1);
      const t2 = await addPr("a", 2);
      const t3 = await addPr("b", 3);
      const fake = fakePlatform();
      fake.live.set("o/a#2", { headSha: "c".repeat(40) });
      const result = await mergeAllGreenCore(deps(fake.platform), { targets: [t1, t2, t3], actor: "sascha" });
      expect(result.outcomes.map((o) => o.status)).toEqual(["merged", "skipped", "merged"]);
      expect(result.outcomes[1]).toMatchObject({ reason: "changed" });
      expect(fake.merges.map((m) => m.number)).toEqual([1, 3]);
      expect(await audit()).toEqual([
        "pr.merge_bulk|3 PRs in 2 Repos",
        "pr.merge|o/a #1",
        "pr.merge.skipped|o/a #2 (changed)",
        "pr.merge|o/b #3",
      ]);
      // 1 s Pause nur zwischen zwei Merges im selben Repo: nach #1 (a) kommt #2 (a, übersprungen),
      // vor #3 (b) keine.
      expect(sleeps).toEqual([BULK_PAUSE_MS]);
      const state = bulkResultToState(result);
      expect(state).toMatchObject({ status: "done", tone: "warnung" });
      const message = (state as { message: string }).message;
      expect(message).toContain("2 PRs gemergt, 1 übersprungen");
      expect(message).toContain("o/a #2: Der PR hat sich seit der Anzeige geändert");
    });

    it("Zeitgrenze: übrige Ziele werden nicht versucht, ohne Audit je Ziel, Meldung mit Zählung", async () => {
      const t1 = await addPr("a", 1);
      const t2 = await addPr("b", 2);
      const t3 = await addPr("b", 3);
      const fake = fakePlatform();
      let tick = 0;
      const result = await mergeAllGreenCore(
        { ...deps(fake.platform), timeLimitMs: 45_000, clockMs: () => (tick++ === 0 ? 0 : 50_000) },
        { targets: [t1, t2, t3], actor: "s" },
      );
      // Erste Prüfung (Start, 0 ms) und erste Schleife (0 ms nach Start) vergehen; danach 50 s.
      expect(result.stopped).toBe("time");
      expect(result.outcomes.map((o) => o.status)).toEqual([]);
      expect(result.notAttempted).toBe(3);
      expect(await audit()).toEqual(["pr.merge_bulk|3 PRs in 2 Repos"]);
      expect((bulkResultToState(result) as { message: string }).message).toContain(
        "3 PRs wurden nicht versucht (Zeitgrenze erreicht), bitte erneut auslösen.",
      );
    });

    it("Zeitgrenze mitten im Lauf: bereits gemergte bleiben, der Rest zählt als nicht versucht (Einzahl)", async () => {
      const t1 = await addPr("a", 1);
      const t2 = await addPr("b", 2);
      const fake = fakePlatform();
      const times = [0, 0, 60_000];
      const result = await mergeAllGreenCore(
        { ...deps(fake.platform), clockMs: () => times.shift() ?? 60_000 },
        { targets: [t1, t2], actor: "s" },
      );
      expect(result.outcomes.map((o) => o.status)).toEqual(["merged"]);
      expect(result.notAttempted).toBe(1);
      const message = (bulkResultToState(result) as { message: string }).message;
      expect(message).toContain("1 PR wurde nicht versucht (Zeitgrenze erreicht), bitte erneut auslösen.");
    });

    it("Kontingent-Pause beim zweiten Ziel: Rest nicht versucht, kein pr.merge.failed, Pause einmal mit Uhrzeit", async () => {
      const t1 = await addPr("a", 1);
      const t2 = await addPr("b", 2);
      const t3 = await addPr("b", 3);
      const fake = fakePlatform();
      fake.live.set("o/b#2", { readError: new RateLimitPause(0, 5000, new Date("2026-10-22T12:30:00Z")) });
      const result = await mergeAllGreenCore(deps(fake.platform), { targets: [t1, t2, t3], actor: "s" });
      expect(result.outcomes.map((o) => o.status)).toEqual(["merged"]);
      expect(result.stopped).toBe("pause");
      expect(result.notAttempted).toBe(2);
      expect(fake.reads).toEqual(["o/a#1", "o/b#2"]);
      expect(await audit()).toEqual(["pr.merge_bulk|3 PRs in 2 Repos", "pr.merge|o/a #1"]);
      const message = (bulkResultToState(result) as { message: string }).message;
      expect(message.match(/Kontingent knapp/g)).toHaveLength(1);
      expect(message).toContain("wieder möglich ab 14:30");
      expect(message).toContain("2 PRs wurden nicht versucht, bitte erneut auslösen.");
    });

    it("Zählsätze in der Einzahl: ein weiterer PR über der Obergrenze, kein Ziel versucht", () => {
      const merged = { status: "merged" as const, prUrl: "u", prNumber: 1, repoFullName: "o/a" };
      const base: BulkMergeResult = { outcomes: [merged], ignored: 0, notAttempted: 0, stopped: null, pauseResetAt: null };
      const one = (bulkResultToState({ ...base, ignored: 1 }) as { message: string }).message;
      expect(one).toContain("1 weiterer PR blieb wegen der Obergrenze");
      const pause = (
        bulkResultToState({ ...base, outcomes: [], ignored: 0, notAttempted: 1, stopped: "pause" }) as { message: string }
      ).message;
      expect(pause).toContain("1 PR wurde nicht versucht");
      expect(pause).not.toContain("Es gab keine PRs");
    });

    it("Pause zwischen zwei Merges im selben Repo", async () => {
      const t1 = await addPr("a", 1);
      const t2 = await addPr("a", 2);
      const t3 = await addPr("a", 3);
      const fake = fakePlatform();
      await mergeAllGreenCore(deps(fake.platform), { targets: [t1, t2, t3], actor: "s" });
      expect(fake.merges).toHaveLength(3);
      expect(sleeps).toEqual([BULK_PAUSE_MS, BULK_PAUSE_MS]);
    });

    it("Ausgenommene Typen: Sicherheits-, Major-, Digest- und Lockfile-PRs werden nie gemergt, auch wenn übergeben", async () => {
      const security = await addPr("a", 1, { updateType: "security" });
      const major = await addPr("a", 2, { updateType: "major" });
      const digest = await addPr("a", 3, { updateType: "digest" });
      const lock = await addPr("a", 4, { updateType: "lockfile" });
      const minor = await addPr("a", 5, { updateType: "minor" });
      const fake = fakePlatform();
      const result = await mergeAllGreenCore(deps(fake.platform), {
        targets: [security, major, digest, lock, minor],
        actor: "s",
      });
      expect(result.outcomes.map((o) => o.status)).toEqual(["skipped", "skipped", "skipped", "skipped", "merged"]);
      expect(fake.merges.map((m) => m.number)).toEqual([5]);
      expect(fake.reads).toEqual(["o/a#5"]);
    });

    it("Serverseitige Prüfung: nicht grüne CI und nicht offene PRs werden übersprungen, ohne Plattformabruf", async () => {
      const red = await addPr("a", 1, { ciStatus: "failure" });
      const closed = await addPr("a", 2, { state: "closed" });
      const fake = fakePlatform();
      const result = await mergeAllGreenCore(deps(fake.platform), { targets: [red, closed], actor: "s" });
      expect(result.outcomes).toMatchObject([{ reason: "ci" }, { reason: "not_open" }]);
      expect(fake.reads).toEqual([]);
    });

    it("Limit: höchstens 20 Ziele, der Rest bleibt unberührt und wird gemeldet; doppelte IDs zählen einmal", async () => {
      const targets: MergeTarget[] = [];
      for (let i = 1; i <= BULK_MERGE_LIMIT + 3; i++) targets.push(await addPr("a", i));
      const fake = fakePlatform();
      const result = await mergeAllGreenCore(deps(fake.platform), { targets: [...targets, targets[0]!], actor: "s" });
      expect(result.outcomes).toHaveLength(BULK_MERGE_LIMIT);
      expect(result.ignored).toBe(3);
      expect(fake.merges).toHaveLength(BULK_MERGE_LIMIT);
      expect((bulkResultToState(result) as { message: string }).message).toContain("3 weitere PRs blieben");
    });

    it("Leere Liste: nichts protokolliert, neutrale Meldung; nur Fehler: Fehlermeldung", async () => {
      const fake = fakePlatform();
      const empty = await mergeAllGreenCore(deps(fake.platform), { targets: [], actor: "s" });
      expect(empty.outcomes).toEqual([]);
      expect(await audit()).toEqual([]);
      expect(bulkResultToState(empty)).toMatchObject({ status: "done", tone: "neutral" });

      const t = await addPr("a", 1);
      fake.live.set("o/a#1", { readError: new PlatformApiError(0, "GET", "/x") });
      const failedAll = await mergeAllGreenCore(deps(fake.platform), { targets: [t], actor: "s" });
      expect(bulkResultToState(failedAll)).toMatchObject({ status: "error" });
    });

    it("Scheitert das Audit vor dem Start, wird nichts gemergt", async () => {
      const t = await addPr("a", 1);
      const fake = fakePlatform();
      const broken = {
        ...db,
        select: db.select.bind(db),
        insert: () => {
          throw new Error("audit weg");
        },
      } as unknown as Db;
      await expect(mergeAllGreenCore({ db: broken, platform: fake.platform }, { targets: [t], actor: "s" })).rejects.toThrow();
      expect(fake.merges).toEqual([]);
    });
  });

  describe("listBulkMergeCandidates", () => {
    it("liefert nur offene grüne Patch-/Minor-PRs mit Methode, sortiert nach Repo und Alter", async () => {
      await addPr("b", 1);
      await addPr("a", 2, { updateType: "minor" });
      await addPr("a", 3);
      await addPr("a", 4, { updateType: "major" });
      await addPr("a", 5, { updateType: "security" });
      await addPr("a", 6, { ciStatus: "pending" });
      await addPr("a", 7, { state: "merged" });
      await addPr("a", 8, { headSha: null });
      await addPr("archiviert", 9);
      await addPr("entfernt", 10);
      await addPr("ohne-install", 11);
      await addPr("keine-methode", 12);
      await pool.query("update repositories set merge_methods = '{rebase}' where external_id = 'b'");

      const { targets, repoCount, total } = await listBulkMergeCandidates(db);
      expect(targets).toHaveLength(3);
      expect(targets.map((t) => t.expectedMethod)).toEqual(["squash", "squash", "rebase"]);
      expect(repoCount).toBe(2);
      expect(total).toBe(3);
    });

    it("begrenzt auf BULK_MERGE_LIMIT und nennt die Gesamtzahl", async () => {
      for (let i = 1; i <= BULK_MERGE_LIMIT + 2; i++) await addPr("a", i);
      const { targets, total } = await listBulkMergeCandidates(db);
      expect(targets).toHaveLength(BULK_MERGE_LIMIT);
      expect(total).toBe(BULK_MERGE_LIMIT + 2);
    });
  });
});
