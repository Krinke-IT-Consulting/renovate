import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

/**
 * FIXTURE-DATEN für Entwicklung und E2E-Smoke (PRODUCT.md: Fixtures als solche kennzeichnen).
 * Owner, Repos, PRs und Jobs sind erfunden ("beispiel-firma", "beispiel-privat") und decken alle
 * Zustände der Ansichten ab. Nie gegen eine echte Datenbank ausführen: seedFixtures() verweigert
 * jede Datenbank, deren Name nicht auf "_fixture" oder "_e2e" endet.
 */

type Db = NodePgDatabase<typeof schema>;

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export const FIXTURE_DB_SUFFIXES = ["_fixture", "_e2e"] as const;

export function assertFixtureDatabase(name: string): void {
  if (!FIXTURE_DB_SUFFIXES.some((s) => name.endsWith(s))) {
    throw new Error(
      `Fixtures nur in Wegwerf-Datenbanken (Name endet auf ${FIXTURE_DB_SUFFIXES.join(" oder ")}).`,
    );
  }
}

type RepoSpec = {
  key: string;
  owner: "beispiel-firma" | "beispiel-privat";
  name: string;
  onboarding?: (typeof schema.onboardingStatusEnum.enumValues)[number];
  buildCheck?: (typeof schema.buildCheckStatusEnum.enumValues)[number];
  ownCi?: boolean;
  archived?: boolean;
  removedDaysAgo?: number;
  ceStatus?: string;
  configPath?: string | null;
  dashboard?: boolean;
  ecosystems?: string[];
};

const REPOS: RepoSpec[] = [
  { key: "shop", owner: "beispiel-firma", name: "shop-api", ecosystems: ["npm", "docker"], dashboard: true },
  { key: "kasse", owner: "beispiel-firma", name: "kasse", ecosystems: ["npm", "expo"], dashboard: true },
  { key: "lager", owner: "beispiel-firma", name: "lager-sync", buildCheck: "missing", ecosystems: ["python"], dashboard: true },
  { key: "website", owner: "beispiel-firma", name: "website", buildCheck: "own_ci", ownCi: true, ecosystems: ["npm"], dashboard: true },
  { key: "infra", owner: "beispiel-firma", name: "infra", onboarding: "none", buildCheck: "missing", configPath: null, ecosystems: ["terraform"] },
  { key: "legacy", owner: "beispiel-firma", name: "legacy-portal", archived: true, ecosystems: ["npm"] },
  { key: "alt", owner: "beispiel-firma", name: "alt-tool", removedDaysAgo: 5, ecosystems: ["go"] },
  { key: "notizen", owner: "beispiel-privat", name: "notizen", ceStatus: "failed", ecosystems: ["npm"], dashboard: true },
  { key: "rezepte", owner: "beispiel-privat", name: "rezepte", ecosystems: ["pnpm"], dashboard: true },
  { key: "wetter", owner: "beispiel-privat", name: "wetter-app", ecosystems: ["bun"], dashboard: true },
  { key: "dotfiles", owner: "beispiel-privat", name: "dotfiles", onboarding: "pr_open", buildCheck: "missing", configPath: null },
  { key: "blog", owner: "beispiel-privat", name: "blog", ecosystems: ["npm", "github-actions"], dashboard: true },
  { key: "foto", owner: "beispiel-privat", name: "fotoarchiv", onboarding: "disabled", ecosystems: ["python"] },
  { key: "leer", owner: "beispiel-privat", name: "leeres-repo", ecosystems: [] },
];

type PrSpec = {
  repo: string;
  number: number;
  title: string;
  type: (typeof schema.updateTypeEnum.enumValues)[number];
  packages: string[];
  ci: (typeof schema.ciStatusEnum.enumValues)[number];
  automerge?: boolean;
  ageDays: number;
};

const PRS: PrSpec[] = [
  { repo: "shop", number: 101, title: "fix(deps): update dependency lodash to v4.17.21 [SECURITY]", type: "security", packages: ["lodash"], ci: "success", ageDays: 2 },
  { repo: "shop", number: 98, title: "chore(deps): update dependency next to v16", type: "major", packages: ["next"], ci: "failure", ageDays: 4 },
  { repo: "shop", number: 103, title: "chore(deps): update dependency zod to v4.6.8", type: "patch", packages: ["zod"], ci: "pending", automerge: true, ageDays: 0 },
  { repo: "kasse", number: 57, title: "chore(deps): update dependency react-native to v0.83.0", type: "major", packages: ["react-native"], ci: "failure", ageDays: 6 },
  { repo: "kasse", number: 59, title: "chore(deps): update expo monorepo", type: "minor", packages: ["expo", "expo-router", "expo-camera"], ci: "success", ageDays: 1 },
  { repo: "lager", number: 12, title: "chore(deps): update dependency requests to v2.33.0", type: "minor", packages: ["requests"], ci: "success", ageDays: 20 },
  { repo: "website", number: 210, title: "chore(deps): update actions/checkout digest to 11bd719", type: "digest", packages: ["actions/checkout"], ci: "success", automerge: true, ageDays: 0 },
  { repo: "blog", number: 33, title: "fix(deps): update dependency undici to v7.16.1 [SECURITY]", type: "security", packages: ["undici"], ci: "success", ageDays: 9 },
  { repo: "blog", number: 35, title: "chore(deps): update dependency astro to v6", type: "major", packages: ["astro"], ci: "success", ageDays: 3 },
  { repo: "rezepte", number: 8, title: "chore(deps): lock file maintenance", type: "lockfile", packages: [], ci: "success", automerge: true, ageDays: 1 },
];

const LOG_KASSE = [
  "WARN: Package lookup failures",
  "ERROR: Command failed: npm install --package-lock-only --no-audit",
  "npm error code ERESOLVE",
  "npm error ERESOLVE could not resolve",
  "npm error While resolving: kasse@1.4.0",
  "npm error Found: react@19.3.1",
  "npm error Could not resolve dependency:",
  "npm error peer react@\"^18.2.0\" from react-native-camera-kit@15.1.0",
  "ERROR: Repository has unknown error",
].join("\n");

const LOG_WETTER = [
  "WARN: artifactErrors",
  "ERROR: bun install --frozen-lockfile failed",
  "error: lockfile had changes, but lockfile is frozen",
].join("\n");

const LOG_NOTIZEN = [
  "ERROR: config-validation",
  "Invalid configuration option: packageRules[2].matchUpdateType",
  "Did you mean matchUpdateTypes?",
].join("\n");

export type SeedOptions = {
  now?: Date;
  /** Abgleich im Fehlerzustand (E2E: Stempel mit Fehler und Uhrzeit). */
  syncError?: boolean;
};

/** Leert alle Tabellen und schreibt die Fixtures. Nur für Wegwerf-Datenbanken. */
export async function seedFixtures(db: Db, options: SeedOptions = {}): Promise<void> {
  const now = options.now ?? new Date();
  const ago = (ms: number) => new Date(now.getTime() - ms);

  const [{ name }] = (await db.execute<{ name: string }>(sql`select current_database() as name`)).rows;
  assertFixtureDatabase(name);

  await db.execute(sql`
    truncate table audit_log, rollout_actions, problems, renovate_jobs, pull_requests, repositories,
      platform_connections, tenants, sync_state, http_cache restart identity cascade
  `);

  const [tenant] = await db.insert(schema.tenants).values({ name: "Fixture" }).returning();
  const connections = await db
    .insert(schema.platformConnections)
    .values([
      { tenantId: tenant.id, platform: "github", ownerName: "beispiel-firma", installationId: 9_000_001 },
      { tenantId: tenant.id, platform: "github", ownerName: "beispiel-privat", installationId: 9_000_002 },
    ])
    .returning();
  const connectionId = (owner: string) => connections.find((c) => c.ownerName === owner)!.id;

  const repoRows = await db
    .insert(schema.repositories)
    .values(
      REPOS.map((r, i) => ({
        connectionId: connectionId(r.owner),
        externalId: String(1000 + i),
        fullName: `${r.owner}/${r.name}`,
        defaultBranch: "main",
        archived: r.archived ?? false,
        onboardingStatus: r.onboarding ?? "onboarded",
        buildCheckStatus: r.buildCheck ?? "active",
        ownCi: r.ownCi ?? false,
        detectedEcosystems: r.ecosystems ?? [],
        dependencyDashboardUrl: r.dashboard ? `https://github.com/${r.owner}/${r.name}/issues/1` : null,
        configPath: r.configPath === undefined ? "renovate.json" : r.configPath,
        ceStatus: r.ceStatus ?? (r.onboarding === "disabled" ? "disabled" : r.onboarding === "none" ? null : "onboarded"),
        removedAt: r.removedDaysAgo ? ago(r.removedDaysAgo * DAY) : null,
        firstSeenAt: ago(40 * DAY),
        syncedAt: ago(2 * MIN),
        headSha: `f1x7${String(i).padStart(2, "0")}a9c3e5b7d1f0a2c4e6b8d0f2a4c6e8b0d2f4a6`,
      })),
    )
    .returning();
  const repoId = (key: string) => repoRows[REPOS.findIndex((r) => r.key === key)].id;

  await db.insert(schema.pullRequests).values(
    PRS.map((p) => {
      const spec = REPOS.find((r) => r.key === p.repo)!;
      return {
        repositoryId: repoId(p.repo),
        number: p.number,
        title: p.title,
        url: `https://github.com/${spec.owner}/${spec.name}/pull/${p.number}`,
        updateType: p.type,
        packageNames: p.packages,
        ciStatus: p.ci,
        automerge: p.automerge ?? false,
        state: "open" as const,
        createdAt: ago(p.ageDays * DAY + 3 * HOUR),
        updatedAt: ago(2 * HOUR),
        labels: p.type === "security" ? ["security"] : [`update:${p.type}`],
      };
    }),
  );

  // Jobs: je onboardetem Repo die letzten sechs stündlichen Läufe; Sonderfälle danach.
  type JobInsert = typeof schema.renovateJobs.$inferInsert;
  const jobs: JobInsert[] = [];
  let jobNo = 0;
  const job = (key: string, hoursAgo: number, over: Partial<JobInsert> = {}): JobInsert => {
    jobNo += 1;
    const started = ago(hoursAgo * HOUR + (jobNo % 7) * MIN);
    const durationMs = (40 + ((jobNo * 37) % 180)) * 1000;
    return {
      repositoryId: repoId(key),
      ceJobId: `fixture-job-${String(jobNo).padStart(4, "0")}`,
      trigger: "schedule",
      status: "success",
      statusRaw: "finished",
      startedAt: started,
      finishedAt: new Date(started.getTime() + durationMs),
      createdAt: started,
      ...over,
    };
  };
  for (const r of REPOS) {
    if ((r.onboarding ?? "onboarded") !== "onboarded" || r.archived || r.removedDaysAgo || r.key === "leer") continue;
    for (let h = 6; h >= 1; h--) jobs.push(job(r.key, h));
  }
  jobs.push(
    job("kasse", 0.2, { status: "failed", statusRaw: "failed", reason: "Repository has unknown error", errorMessage: "ERESOLVE could not resolve", logExcerpt: LOG_KASSE }),
    job("wetter", 0.3, { status: "success", artifactErrorCount: 2, logExcerpt: LOG_WETTER }),
    job("notizen", 0.4, { status: "failed", statusRaw: "failed", reason: "config-validation", errorMessage: "Invalid configuration", logExcerpt: LOG_NOTIZEN }),
    job("shop", 0.1, { trigger: "manual" }),
    job("website", 0.05, { trigger: "webhook" }),
    job("rezepte", 0, { status: "running", statusRaw: "running", finishedAt: null, startedAt: ago(40_000), createdAt: ago(60_000) }),
    job("blog", 0, { status: "queued", statusRaw: "queued", startedAt: null, finishedAt: null, createdAt: ago(20_000) }),
    // Älterer, inzwischen bereinigter Fehlschlag (Log nicht mehr verfügbar).
    job("shop", 30, { status: "failed", statusRaw: "failed", reason: "Repository has unknown error", logExcerpt: null }),
  );
  await db.insert(schema.renovateJobs).values(jobs);

  // Letzter Lauf je Repo nachziehen (wie der CE-Abgleich).
  await db.execute(sql`
    update repositories r set last_job_at = j.finished_at,
      last_job_result = case j.status when 'success' then 'success'::job_result when 'failed' then 'failed'::job_result else 'unknown'::job_result end
    from (
      select distinct on (repository_id) repository_id, status, coalesce(finished_at, started_at, created_at) as finished_at
      from renovate_jobs where status in ('success', 'failed')
      order by repository_id, coalesce(finished_at, started_at, created_at) desc
    ) j where j.repository_id = r.id
  `);

  type ProblemInsert = typeof schema.problems.$inferInsert;
  const problem = (key: string, kind: ProblemInsert["kind"], message: string, daysAgo: number, over: Partial<ProblemInsert> = {}): ProblemInsert => ({
    repositoryId: repoId(key),
    kind,
    message,
    firstSeenAt: ago(daysAgo * DAY),
    lastSeenAt: ago(2 * MIN),
    ...over,
  });
  await db.insert(schema.problems).values([
    problem("kasse", "job_failed", "Der letzte Renovate-Lauf ist fehlgeschlagen.", 0.2),
    problem("kasse", "ci_red", "PR #57 hat rote CI.", 5, { dedupeKey: "57" }),
    problem("shop", "ci_red", "PR #98 hat rote CI.", 3, { dedupeKey: "98" }),
    problem("notizen", "config_error", "Renovate meldet einen Konfigurationsfehler.", 1),
    problem("notizen", "job_failed", "Der letzte Renovate-Lauf ist fehlgeschlagen.", 0.4),
    problem("wetter", "lockfile_failure", "Lockfile konnte nicht aktualisiert werden.", 0.3),
    problem("lager", "missing_build_check", "Build-Check-Aufruf fehlt.", 12),
    problem("lager", "stale_pr", "PR #12 ist seit 20 Tagen offen.", 6, { dedupeKey: "12" }),
    problem("blog", "stale_pr", "Sicherheits-PR #33 ist seit 9 Tagen offen.", 2, { dedupeKey: "33" }),
    // Behobene
    problem("shop", "job_failed", "Der letzte Renovate-Lauf ist fehlgeschlagen.", 2, { resolvedAt: ago(29 * HOUR), lastSeenAt: ago(29 * HOUR) }),
    problem("website", "ci_red", "PR #205 hat rote CI.", 8, { dedupeKey: "205", resolvedAt: ago(6 * DAY), lastSeenAt: ago(6 * DAY) }),
    problem("rezepte", "missing_build_check", "Build-Check-Aufruf fehlt.", 15, { resolvedAt: ago(10 * DAY), lastSeenAt: ago(10 * DAY) }),
  ]);

  await db.insert(schema.rolloutActions).values([
    { repositoryId: repoId("dotfiles"), kind: "onboarding", triggeredBy: "fixture", status: "pr_open", prNumber: 1, prUrl: "https://github.com/beispiel-privat/dotfiles/pull/1", createdAt: ago(2 * DAY) },
    { repositoryId: repoId("shop"), kind: "onboarding", triggeredBy: "fixture", status: "merged", prNumber: 4, prUrl: "https://github.com/beispiel-firma/shop-api/pull/4", createdAt: ago(30 * DAY) },
    { repositoryId: repoId("shop"), kind: "build_check", triggeredBy: "fixture", status: "merged", prNumber: 6, prUrl: "https://github.com/beispiel-firma/shop-api/pull/6", createdAt: ago(29 * DAY) },
  ]);

  await db.insert(schema.syncState).values([
    {
      source: "github",
      lastSuccessAt: ago(2 * MIN),
      partialErrors: [],
      ...(options.syncError ? { lastErrorAt: ago(30_000), lastErrorMessage: "Plattform nicht erreichbar" } : {}),
    },
    {
      source: "ce",
      lastSuccessAt: ago(30_000),
      partialErrors: [],
    },
  ]);
}
