import { generateKeyPairSync, randomBytes } from "node:crypto";
import path from "node:path";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { Client, Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { runMigrations } from "@/db/migrate";
import * as schema from "@/db/schema";
import { API, fileBody, installations } from "@/platform/__fixtures__/github";
import { MemoryHttpCache } from "@/platform/http-cache";
import { GitHubAdapter } from "@/platform/github";
import { PENDING_TIMEOUT_MS, createRolloutService } from "./service";
import type { RolloutService } from "./types";

/**
 * Integrationstests gegen Postgres (DATABASE_URL, sonst übersprungen) mit dem echten GitHubAdapter
 * gegen msw. Alle Werte (Token, Schlüssel, Repos) sind erfunden.
 */
const adminUrl = process.env.DATABASE_URL;
const migrationsFolder = path.join(process.cwd(), "drizzle");

const { privateKey: PRIVATE_KEY } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

const REPO = "acme-org/app";
const INSTALLATION = 7777;
const BRANCH_ONBOARDING = "renovate-platform/onboarding";
const BRANCH_BUILD_CHECK = "renovate-platform/build-check";
const TOKEN = "ghs_erfundenes_testtoken";
const CALLER_PATH = ".github/workflows/build-check.yml";

const server = setupServer();

type Recorded = { method: string; path: string; body?: unknown };
let calls: Recorded[];
/** Pro Test setzbar: Antwort auf einzelne Schritte. */
let behaviour: {
  openPulls: { number: number; html_url: string; head: { ref: string; sha: string } }[];
  trees?: () => Response;
  refs?: (attempt: number) => Response;
  pulls?: () => Response;
};
let refAttempts: number;

function record(request: Request, body?: unknown) {
  calls.push({ method: request.method, path: new URL(request.url).pathname, body });
}
const count = (method: string, p: string) =>
  calls.filter((c) => c.method === method && c.path === p).length;

function json(body: unknown, status = 200) {
  return HttpResponse.json(body as never, { status });
}

beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterAll(() => server.close());

beforeEach(() => {
  calls = [];
  refAttempts = 0;
  behaviour = { openPulls: [] };
  const base = `${API}/repos/${REPO}`;
  server.use(
    http.post(`${API}/app/installations/:id/access_tokens`, () =>
      json({ token: TOKEN, expires_at: new Date(Date.now() + 3_600_000).toISOString() }, 201),
    ),
    http.get(`${API}/app/installations`, () => json(installations)),
    http.get(`${API}/repos/Krinke-IT-Consulting/renovate/contents/templates/renovate.json`, ({ request }) => {
      record(request);
      return json(fileBody('{ "extends": ["github>Krinke-IT-Consulting/renovate"] }\n'));
    }),
    http.get(`${API}/repos/Krinke-IT-Consulting/renovate/contents/templates/build-check-caller.yml`, ({ request }) => {
      record(request);
      return json(fileBody("name: build-check\n"));
    }),
    http.get(`${base}/pulls`, ({ request }) => {
      record(request);
      const head = new URL(request.url).searchParams.get("head") ?? "";
      return json(behaviour.openPulls.filter((p) => head.endsWith(`:${p.head.ref}`)));
    }),
    http.get(`${base}/commits/main`, ({ request }) => {
      record(request);
      return new HttpResponse("basesha000");
    }),
    http.get(`${base}/git/commits/basesha000`, ({ request }) => {
      record(request);
      return json({ sha: "basesha000", tree: { sha: "tree000" } });
    }),
    http.post(`${base}/git/trees`, async ({ request }) => {
      record(request, await request.clone().json());
      return behaviour.trees?.() ?? json({ sha: "tree111" }, 201);
    }),
    http.post(`${base}/git/commits`, async ({ request }) => {
      record(request, await request.clone().json());
      return json({ sha: "commit111" }, 201);
    }),
    http.post(`${base}/git/refs`, async ({ request }) => {
      record(request, await request.clone().json());
      return behaviour.refs?.(++refAttempts) ?? json({ ref: "x" }, 201);
    }),
    http.post(`${base}/pulls`, async ({ request }) => {
      record(request, await request.clone().json());
      return behaviour.pulls?.() ?? json({ number: 7, html_url: `https://example.test/${REPO}/pull/7` }, 201);
    }),
    http.delete(`${base}/git/refs/heads/${BRANCH_ONBOARDING}`, ({ request }) => {
      record(request);
      return new HttpResponse(null, { status: 204 });
    }),
    http.delete(`${base}/git/refs/heads/${BRANCH_BUILD_CHECK}`, ({ request }) => {
      record(request);
      return new HttpResponse(null, { status: 204 });
    }),
  );
});
afterEach(() => server.resetHandlers());

describe.skipIf(!adminUrl)("Rollout-Service (Postgres, GitHub gegen msw)", () => {
  const dbName = `dashboard_rollout_${randomBytes(6).toString("hex")}`;
  let pool: Pool;
  let db: Db;
  let service: RolloutService;
  let repoId: string;

  /** Eigene Instanz: der Adapter merkt sich das Kontingent, ein Test darf es nicht für andere leeren. */
  const makeService = () =>
    createRolloutService({
      db,
      adapter: new GitHubAdapter({
        appId: "12345",
        privateKey: PRIVATE_KEY,
        appSlug: "krinke-it-renovate",
        cache: new MemoryHttpCache(),
      }),
    });

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
    db = drizzle(pool, { schema });
    service = makeService();
  });

  afterAll(async () => {
    await pool?.end();
    await admin((c) => c.query(`drop database if exists "${dbName}" with (force)`));
  });

  /** Frisches Repo: nicht onboardet, ohne Build-Check. `over` passt den Stand an. */
  async function seed(over: Partial<typeof schema.repositories.$inferInsert> = {}) {
    await pool.query("truncate platform_connections, audit_log cascade");
    await db.insert(schema.tenants).values({ name: "test" }).onConflictDoNothing();
    const [tenant] = await db.select().from(schema.tenants).limit(1);
    const [conn] = await db
      .insert(schema.platformConnections)
      .values({ tenantId: tenant!.id, platform: "github", ownerName: "acme-org", installationId: INSTALLATION })
      .returning();
    const [repo] = await db
      .insert(schema.repositories)
      .values({
        connectionId: conn!.id,
        externalId: "1",
        fullName: REPO,
        defaultBranch: "main",
        headSha: "basesha000",
        ...over,
      })
      .returning();
    repoId = repo!.id;
  }

  const actions = () => db.select().from(schema.rolloutActions);
  const audit = () => db.select().from(schema.auditLog);
  const repoRow = async () =>
    (await db.select().from(schema.repositories).where(eq(schema.repositories.id, repoId)))[0]!;
  const treePaths = () =>
    ((calls.find((c) => c.path.endsWith("/git/trees"))?.body as { tree: { path: string }[] }).tree).map((t) => t.path);

  describe("Onboarding-PR", () => {
    it("legt einen Commit mit beiden Dateien und den PR an (Onboarding per Klick)", async () => {
      await seed();
      const outcome = await service.run({ repositoryId: repoId, kind: "onboarding", actor: "sascha" });

      expect(outcome).toEqual({ status: "created", prUrl: `https://example.test/${REPO}/pull/7`, prNumber: 7 });
      expect(count("POST", `/repos/${REPO}/git/commits`)).toBe(1);
      expect(treePaths()).toEqual(["renovate.json", CALLER_PATH]);
      const tree = calls.find((c) => c.path.endsWith("/git/trees"))!.body as { base_tree: string; tree: { content: string }[] };
      expect(tree.base_tree).toBe("tree000");
      expect(tree.tree[0]!.content).toContain("github>Krinke-IT-Consulting/renovate");
      const pr = calls.find((c) => c.path.endsWith("/pulls") && c.method === "POST")!.body as {
        head: string;
        base: string;
        body: string;
      };
      expect(pr).toMatchObject({ head: BRANCH_ONBOARDING, base: "main" });
      for (const input of ["docker-context", "postgres", "run-tests", "exclude-paths"]) {
        expect(pr.body).toContain(`\`${input}\``);
      }
      expect(await actions()).toMatchObject([
        { kind: "onboarding", status: "pr_open", prNumber: 7, triggeredBy: "sascha", error: null },
      ]);
      expect(await audit()).toMatchObject([
        { actor: "sascha", action: "rollout.onboarding", target: REPO },
      ]);
      expect((await repoRow()).onboardingStatus).toBe("pr_open");
    });

    it("committet nur die Konfiguration, wenn die Aufrufdatei schon da ist", async () => {
      await seed({ buildCheckStatus: "active" });
      const outcome = await service.run({ repositoryId: repoId, kind: "onboarding", actor: "sascha" });
      expect(outcome.status).toBe("created");
      expect(treePaths()).toEqual(["renovate.json"]);
    });

    it("Wiederholter Klick: offener PR vorhanden, kein zweiter PR", async () => {
      await seed();
      behaviour.openPulls = [
        { number: 3, html_url: `https://example.test/${REPO}/pull/3`, head: { ref: BRANCH_ONBOARDING, sha: "x" } },
      ];
      const first = await service.run({ repositoryId: repoId, kind: "onboarding", actor: "sascha" });
      const second = await service.run({ repositoryId: repoId, kind: "onboarding", actor: "sascha" });

      for (const o of [first, second]) {
        expect(o).toEqual({ status: "existing", prUrl: `https://example.test/${REPO}/pull/3`, prNumber: 3 });
      }
      expect(count("POST", `/repos/${REPO}/pulls`)).toBe(0);
      expect(count("POST", `/repos/${REPO}/git/trees`)).toBe(0);
      expect(await actions()).toMatchObject([{ status: "pr_open", prNumber: 3 }]);
      expect((await repoRow()).onboardingStatus).toBe("pr_open");
      expect(await audit()).toHaveLength(2);
    });

    it("zwei gleichzeitige Klicks erzeugen genau einen PR", async () => {
      await seed();
      const [a, b] = await Promise.all([
        service.run({ repositoryId: repoId, kind: "onboarding", actor: "a" }),
        service.run({ repositoryId: repoId, kind: "onboarding", actor: "b" }),
      ]);
      expect([a.status, b.status].filter((s) => s === "created")).toHaveLength(1);
      expect(count("POST", `/repos/${REPO}/pulls`)).toBe(1);
      expect((await actions()).filter((x) => x.status === "pr_open" || x.status === "pending")).toHaveLength(1);
    });

    it("meldet 'läuft bereits' bei frischer pending-Aktion, übernimmt eine abgebrochene", async () => {
      await seed();
      await db.insert(schema.rolloutActions).values({ repositoryId: repoId, kind: "onboarding", triggeredBy: "x", status: "pending" });
      const blocked = await service.run({ repositoryId: repoId, kind: "onboarding", actor: "sascha" });
      expect(blocked).toMatchObject({ status: "failed", message: expect.stringContaining("läuft bereits") });
      expect(count("POST", `/repos/${REPO}/pulls`)).toBe(0);

      await pool.query("update rollout_actions set created_at = now() - ($1 || ' milliseconds')::interval", [
        String(PENDING_TIMEOUT_MS + 1000),
      ]);
      const outcome = await service.run({ repositoryId: repoId, kind: "onboarding", actor: "sascha" });
      expect(outcome.status).toBe("created");
      expect((await actions()).map((x) => x.status).sort()).toEqual(["failed", "pr_open"]);
    });

    it("Fehlende Rechte: verständliche Meldung, RolloutAction failed, kein Branch bleibt", async () => {
      await seed();
      behaviour.refs = () =>
        json(
          {
            message:
              "refusing to allow a GitHub App to create or update workflow `.github/workflows/build-check.yml` without `workflows` permission",
          },
          403,
        );
      const outcome = await service.run({ repositoryId: repoId, kind: "onboarding", actor: "sascha" });

      const message =
        "Der GitHub App fehlt in diesem Repo das Schreibrecht auf Workflows. Bitte in den App-Einstellungen ergänzen.";
      expect(outcome).toEqual({ status: "failed", message });
      expect(await actions()).toMatchObject([{ kind: "onboarding", status: "failed", error: message, prUrl: null }]);
      expect(await audit()).toMatchObject([{ action: "rollout.onboarding", actor: "sascha" }]);
      expect((await repoRow()).onboardingStatus).toBe("none");
      expect(count("POST", `/repos/${REPO}/pulls`)).toBe(0);
      expect(JSON.stringify(outcome)).not.toContain(TOKEN);
    });

    it("Fehlende Rechte beim Anlegen des Trees (404) ergeben dieselbe Fehlerart", async () => {
      await seed();
      behaviour.trees = () => json({ message: "Not Found" }, 404);
      const outcome = await service.run({ repositoryId: repoId, kind: "onboarding", actor: "sascha" });
      expect(outcome).toMatchObject({ status: "failed", message: expect.stringContaining("Schreibrechte") });
      expect((await actions())[0]!.status).toBe("failed");
    });

    it("Aufräumen: scheitert die PR-Erstellung nach dem Ref, wird der Branch gelöscht", async () => {
      await seed();
      behaviour.pulls = () => json({ message: "Server-Geheimnis im Text" }, 500);
      const outcome = await service.run({ repositoryId: repoId, kind: "onboarding", actor: "sascha" });

      expect(count("POST", `/repos/${REPO}/git/refs`)).toBe(1);
      expect(count("DELETE", `/repos/${REPO}/git/refs/heads/${BRANCH_ONBOARDING}`)).toBe(1);
      expect(outcome).toEqual({ status: "failed", message: "Die Plattform hat die Anfrage abgelehnt (Status 500)." });
      expect((await actions())[0]).toMatchObject({ status: "failed", error: "Die Plattform hat die Anfrage abgelehnt (Status 500)." });
      expect(JSON.stringify(await actions())).not.toContain("Geheimnis");
      expect(await audit()).toHaveLength(1);
      expect((await repoRow()).onboardingStatus).toBe("none");
    });

    it("Aufräumen auch, wenn die PR-Erstellung am Recht scheitert", async () => {
      await seed();
      behaviour.pulls = () => json({ message: "Resource not accessible by integration" }, 403);
      const outcome = await service.run({ repositoryId: repoId, kind: "onboarding", actor: "sascha" });
      expect(outcome.status).toBe("failed");
      expect(count("DELETE", `/repos/${REPO}/git/refs/heads/${BRANCH_ONBOARDING}`)).toBe(1);
    });

    it("ersetzt einen Rest-Branch eines früheren Rollouts (Ref existiert, 422)", async () => {
      await seed();
      behaviour.refs = (attempt) =>
        attempt === 1 ? json({ message: "Reference already exists" }, 422) : json({ ref: "x" }, 201);
      const outcome = await service.run({ repositoryId: repoId, kind: "onboarding", actor: "sascha" });
      expect(outcome.status).toBe("created");
      expect(count("POST", `/repos/${REPO}/git/refs`)).toBe(2);
      expect(count("DELETE", `/repos/${REPO}/git/refs/heads/${BRANCH_ONBOARDING}`)).toBe(1);
    });

    it("bei knappem Kontingent keine Spur: weder Aktion noch Audit, später erneut möglich", async () => {
      await seed();
      behaviour.trees = () =>
        new HttpResponse(JSON.stringify({ message: "rate limit" }), {
          status: 403,
          headers: {
            "content-type": "application/json",
            "x-ratelimit-remaining": "0",
            "x-ratelimit-limit": "5000",
            "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 3600),
          },
        });
      const outcome = await makeService().run({ repositoryId: repoId, kind: "onboarding", actor: "auto" });
      expect(outcome).toMatchObject({ status: "failed", message: expect.stringContaining("Kontingent") });
      expect(await actions()).toHaveLength(0);
      expect(await audit()).toHaveLength(0);
    });

    it("ist nicht nötig bei Konfiguration, archiviertem oder entferntem Repo (ohne Eintrag)", async () => {
      const cases: [Partial<typeof schema.repositories.$inferInsert>, string][] = [
        [{ configPath: "renovate.json" }, "config_present"],
        [{ onboardingStatus: "onboarded" }, "config_present"],
        [{ onboardingStatus: "disabled" }, "config_present"],
        [{ archived: true }, "archived"],
        [{ removedAt: new Date() }, "removed"],
      ];
      for (const [over, reason] of cases) {
        await seed(over);
        expect(await service.run({ repositoryId: repoId, kind: "onboarding", actor: "sascha" })).toMatchObject({
          status: "not_needed",
          reason,
        });
      }
      expect(calls.filter((c) => c.method !== "GET")).toHaveLength(0);
      expect(await actions()).toHaveLength(0);
      expect(await audit()).toHaveLength(0);
    });

    it("zieht einen veralteten pr_open-Eintrag nach: geschlossen -> neuer PR, gemergt -> nicht nötig", async () => {
      await seed();
      await db.insert(schema.rolloutActions).values({
        repositoryId: repoId, kind: "onboarding", triggeredBy: "x", status: "pr_open", prNumber: 5, prUrl: "https://example.test/5",
      });
      server.use(
        http.get(`${API}/repos/${REPO}/pulls/5`, () => json({ number: 5, state: "closed", merged_at: null })),
      );
      expect((await service.run({ repositoryId: repoId, kind: "onboarding", actor: "s" })).status).toBe("created");
      expect((await actions()).map((a) => a.status).sort()).toEqual(["closed", "pr_open"]);

      await seed();
      await db.insert(schema.rolloutActions).values({
        repositoryId: repoId, kind: "onboarding", triggeredBy: "x", status: "pr_open", prNumber: 5, prUrl: "https://example.test/5",
      });
      server.use(
        http.get(`${API}/repos/${REPO}/pulls/5`, () => json({ number: 5, state: "closed", merged_at: "2026-01-01T00:00:00Z" })),
      );
      expect(await service.run({ repositoryId: repoId, kind: "onboarding", actor: "s" })).toMatchObject({
        status: "not_needed",
        reason: "config_present",
      });
      expect((await actions())[0]!.status).toBe("merged");
    });
  });

  describe("Build-Check nachträglich ausrollen", () => {
    const onboarded = { configPath: "renovate.json", onboardingStatus: "onboarded" as const };

    it("committet nur die Aufrufdatei, Build-Check-Status pr_open", async () => {
      await seed(onboarded);
      const outcome = await service.run({ repositoryId: repoId, kind: "build_check", actor: "sascha" });

      expect(outcome).toMatchObject({ status: "created", prNumber: 7 });
      expect(treePaths()).toEqual([CALLER_PATH]);
      expect(calls.find((c) => c.path.endsWith("/git/refs") && c.method === "POST")!.body).toMatchObject({
        ref: `refs/heads/${BRANCH_BUILD_CHECK}`,
      });
      const row = await repoRow();
      expect(row.buildCheckStatus).toBe("pr_open");
      expect(row.onboardingStatus).toBe("onboarded");
      expect(await actions()).toMatchObject([{ kind: "build_check", status: "pr_open" }]);
      expect(await audit()).toMatchObject([{ action: "rollout.build_check", actor: "sascha", target: REPO }]);
    });

    it("Wiederholter Klick: vorhandener PR statt zweitem", async () => {
      await seed(onboarded);
      behaviour.openPulls = [
        { number: 9, html_url: `https://example.test/${REPO}/pull/9`, head: { ref: BRANCH_BUILD_CHECK, sha: "x" } },
      ];
      expect(await service.run({ repositoryId: repoId, kind: "build_check", actor: "s" })).toMatchObject({
        status: "existing",
        prNumber: 9,
      });
      expect(count("POST", `/repos/${REPO}/pulls`)).toBe(0);
    });

    it("ist nicht nötig bei eigener CI, aktivem Build-Check oder nicht onboardetem Repo", async () => {
      const cases: [Partial<typeof schema.repositories.$inferInsert>, string][] = [
        [{ ...onboarded, ownCi: true, buildCheckStatus: "own_ci" }, "own_ci"],
        [{ ...onboarded, ownCi: true }, "own_ci"],
        [{ ...onboarded, buildCheckStatus: "active" }, "build_check_present"],
        [{}, "not_onboarded"],
        [{ onboardingStatus: "pr_open" }, "not_onboarded"],
      ];
      for (const [over, reason] of cases) {
        await seed(over);
        expect(await service.run({ repositoryId: repoId, kind: "build_check", actor: "sascha" })).toMatchObject({
          status: "not_needed",
          reason,
        });
      }
      expect(calls.filter((c) => c.method !== "GET")).toHaveLength(0);
      expect(await actions()).toHaveLength(0);
    });

    it("Onboarding eines Repos mit eigener CI committet die Aufrufdatei nicht", async () => {
      await seed({ ownCi: true, buildCheckStatus: "own_ci" });
      await service.run({ repositoryId: repoId, kind: "onboarding", actor: "sascha" });
      expect(treePaths()).toEqual(["renovate.json"]);
    });
  });
});
