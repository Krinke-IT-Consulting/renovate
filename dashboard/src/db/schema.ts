import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Datenmodell des Dashboards: PRD 4.3 plus die Ergänzungen aus design.md, Entscheidung 3.
 * Alle Zeiten sind timestamptz, alle Schlüssel uuid (gen_random_uuid()).
 * Löschverhalten: Tenant -> Connection "restrict" (kein versehentliches Löschen eines Mandanten),
 * Connection -> Repository und Repository -> Kind-Tabellen "cascade".
 */

export const platformEnum = pgEnum("platform", ["github", "gitlab"]);
export const onboardingStatusEnum = pgEnum("onboarding_status", [
  "none",
  "pr_open",
  "onboarded",
  "disabled",
]);
export const buildCheckStatusEnum = pgEnum("build_check_status", [
  "missing",
  "pr_open",
  "active",
  "own_ci",
]);
export const jobResultEnum = pgEnum("job_result", ["success", "failed", "skipped", "unknown"]);
export const updateTypeEnum = pgEnum("update_type", [
  "major",
  "minor",
  "patch",
  "security",
  "digest",
  "lockfile",
  "other",
]);
export const ciStatusEnum = pgEnum("ci_status", ["success", "failure", "pending", "none"]);
export const changeRequestStateEnum = pgEnum("change_request_state", ["open", "merged", "closed"]);
export const jobTriggerEnum = pgEnum("job_trigger", ["schedule", "webhook", "manual"]);
export const jobStatusEnum = pgEnum("job_status", ["queued", "running", "success", "failed"]);
export const problemKindEnum = pgEnum("problem_kind", [
  "config_error",
  "lockfile_failure",
  "job_failed",
  "stale_pr",
  "ci_red",
  "missing_build_check",
]);
export const rolloutKindEnum = pgEnum("rollout_kind", ["onboarding", "build_check"]);
export const rolloutStatusEnum = pgEnum("rollout_status", [
  "pending",
  "pr_open",
  "merged",
  "failed",
  "closed",
]);

const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const tenants = pgTable(
  "tenants",
  {
    id: id(),
    name: text("name").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("tenants_name_key").on(t.name)],
);

export const platformConnections = pgTable(
  "platform_connections",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    platform: platformEnum("platform").notNull(),
    ownerName: text("owner_name").notNull(),
    installationId: bigint("installation_id", { mode: "number" }),
    autoOnboarding: boolean("auto_onboarding").notNull().default(false),
    /** Repos, die vor diesem Zeitpunkt bekannt waren, bleiben vom Auto-Onboarding ausgenommen. */
    autoOnboardingEnabledAt: ts("auto_onboarding_enabled_at"),
  },
  (t) => [
    uniqueIndex("platform_connections_tenant_platform_owner_key").on(
      t.tenantId,
      t.platform,
      t.ownerName,
    ),
    uniqueIndex("platform_connections_platform_installation_key")
      .on(t.platform, t.installationId)
      .where(sql`${t.installationId} is not null`),
    index("platform_connections_tenant_id_idx").on(t.tenantId),
  ],
);

export const repositories = pgTable(
  "repositories",
  {
    id: id(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => platformConnections.id, { onDelete: "cascade" }),
    /** ID auf der Plattform; bleibt bei Umbenennung stabil, full_name wird nachgezogen. */
    externalId: text("external_id").notNull(),
    fullName: text("full_name").notNull(),
    defaultBranch: text("default_branch").notNull(),
    archived: boolean("archived").notNull().default(false),
    onboardingStatus: onboardingStatusEnum("onboarding_status").notNull().default("none"),
    buildCheckStatus: buildCheckStatusEnum("build_check_status").notNull().default("missing"),
    detectedEcosystems: text("detected_ecosystems")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    dependencyDashboardUrl: text("dependency_dashboard_url"),
    lastJobAt: ts("last_job_at"),
    lastJobResult: jobResultEnum("last_job_result").notNull().default("unknown"),
    syncedAt: ts("synced_at"),
    // Ergänzungen (Entscheidung 3)
    firstSeenAt: ts("first_seen_at").notNull().defaultNow(),
    headSha: text("head_sha"),
    configPath: text("config_path"),
    /** Rohwert des Repo-Status aus der CE-Reporting-API (onboarded, disabled, failed, ...). */
    ceStatus: text("ce_status"),
    /** Markierung des Betreibers: Repo hat eigene CI. Der Abgleich überschreibt sie nie. */
    ownCi: boolean("own_ci").notNull().default(false),
    /** Gesetzt, wenn das Repo auf der Plattform verschwunden ist; Zeilen werden nie gelöscht. */
    removedAt: ts("removed_at"),
  },
  (t) => [
    uniqueIndex("repositories_connection_external_id_key").on(t.connectionId, t.externalId),
    // Kein Unique: bei Umbenennung kann full_name kurzzeitig doppelt vorkommen.
    index("repositories_connection_full_name_idx").on(t.connectionId, t.fullName),
    index("repositories_connection_id_idx").on(t.connectionId),
  ],
);

export const pullRequests = pgTable(
  "pull_requests",
  {
    id: id(),
    repositoryId: uuid("repository_id")
      .notNull()
      .references(() => repositories.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    title: text("title").notNull(),
    url: text("url").notNull(),
    updateType: updateTypeEnum("update_type").notNull().default("other"),
    packageNames: text("package_names")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    ciStatus: ciStatusEnum("ci_status").notNull().default("none"),
    automerge: boolean("automerge").notNull().default(false),
    state: changeRequestStateEnum("state").notNull().default("open"),
    createdAt: ts("created_at").notNull(),
    updatedAt: ts("updated_at").notNull(),
    mergedAt: ts("merged_at"),
    // Ergänzungen (Entscheidung 3)
    headSha: text("head_sha"),
    labels: text("labels")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
  },
  (t) => [
    uniqueIndex("pull_requests_repository_number_key").on(t.repositoryId, t.number),
    index("pull_requests_repository_id_idx").on(t.repositoryId),
    index("pull_requests_repository_state_idx").on(t.repositoryId, t.state),
  ],
);

export const renovateJobs = pgTable(
  "renovate_jobs",
  {
    id: id(),
    repositoryId: uuid("repository_id")
      .notNull()
      .references(() => repositories.id, { onDelete: "cascade" }),
    ceJobId: text("ce_job_id").notNull(),
    trigger: jobTriggerEnum("trigger").notNull(),
    status: jobStatusEnum("status").notNull(),
    startedAt: ts("started_at"),
    finishedAt: ts("finished_at"),
    /** Gekürztes Log (nur warn/error, ohne Secrets). */
    logExcerpt: text("log_excerpt"),
    // Ergänzungen (Entscheidung 3)
    reason: text("reason"),
    errorMessage: text("error_message"),
    /** Roher CE-Zustand; unbekannte Werte gehen so nicht verloren. */
    statusRaw: text("status_raw"),
    /** Anzahl der `artifactErrors` des Jobs (Lockfile-Fehler); Grundlage für lockfile_failure. */
    artifactErrorCount: integer("artifact_error_count").notNull().default(0),
    /** Wann das Dashboard den Job zuerst gesehen hat; Alter für "verschwundene" Jobs ohne Startzeit. */
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("renovate_jobs_ce_job_id_key").on(t.ceJobId),
    index("renovate_jobs_repository_id_idx").on(t.repositoryId),
    index("renovate_jobs_repository_started_at_idx").on(t.repositoryId, t.startedAt),
    index("renovate_jobs_status_idx").on(t.status),
  ],
);

export const problems = pgTable(
  "problems",
  {
    id: id(),
    repositoryId: uuid("repository_id")
      .notNull()
      .references(() => repositories.id, { onDelete: "cascade" }),
    kind: problemKindEnum("kind").notNull(),
    message: text("message").notNull(),
    firstSeenAt: ts("first_seen_at").notNull().defaultNow(),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
    resolvedAt: ts("resolved_at"),
    /** Unterscheidet mehrere Probleme gleicher Art je Repo (etwa die PR-Nummer); sonst leer. */
    dedupeKey: text("dedupe_key").notNull().default(""),
  },
  (t) => [
    index("problems_repository_id_idx").on(t.repositoryId),
    // Höchstens ein offenes Problem je (Repo, Art, Schlüssel); behobene können neu entstehen.
    // Dient zugleich als Index für offene Probleme (Übersicht, Probleme-Seite).
    uniqueIndex("problems_open_key")
      .on(t.repositoryId, t.kind, t.dedupeKey)
      .where(sql`${t.resolvedAt} is null`),
  ],
);

export const rolloutActions = pgTable(
  "rollout_actions",
  {
    id: id(),
    repositoryId: uuid("repository_id")
      .notNull()
      .references(() => repositories.id, { onDelete: "cascade" }),
    kind: rolloutKindEnum("kind").notNull(),
    /** Authelia-Nutzer oder "auto". */
    triggeredBy: text("triggered_by").notNull(),
    prUrl: text("pr_url"),
    prNumber: integer("pr_number"),
    status: rolloutStatusEnum("status").notNull().default("pending"),
    error: text("error"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("rollout_actions_repository_id_idx").on(t.repositoryId),
    index("rollout_actions_repository_kind_status_idx").on(t.repositoryId, t.kind, t.status),
    // Höchstens ein offener Rollout je Repo und Art.
    uniqueIndex("rollout_actions_open_key")
      .on(t.repositoryId, t.kind)
      .where(sql`${t.status} in ('pending', 'pr_open')`),
  ],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    actor: text("actor").notNull(),
    /** z. B. "job.trigger", "rollout.onboarding". */
    action: text("action").notNull(),
    target: text("target").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("audit_log_created_at_idx").on(t.createdAt)],
);

/** Abgleich-Stempel: je Quelle ("github", "ce") letzter Erfolg und letzter Fehler. */
export const syncState = pgTable("sync_state", {
  source: text("source").primaryKey(),
  lastSuccessAt: ts("last_success_at"),
  lastErrorAt: ts("last_error_at"),
  lastErrorMessage: text("last_error_message"),
  /** Teilfehler je Repo des letzten Durchlaufs. */
  partialErrors: jsonb("partial_errors")
    .$type<{ repository: string; message: string }[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  /** Gesetzt, wenn der Durchlauf wegen knappen Kontingents (RateLimitPause) früh endete. */
  pausedAt: ts("paused_at"),
  pausedUntil: ts("paused_until"),
  pauseNote: text("pause_note"),
});

/** Bedingte Requests: je URL-Schlüssel ETag und letzte Antwort. */
export const httpCache = pgTable("http_cache", {
  key: text("key").primaryKey(),
  etag: text("etag").notNull(),
  body: jsonb("body").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});
