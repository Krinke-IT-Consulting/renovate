import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { platformConnections, renovateJobs, repositories } from "@/db/schema";
import {
  CeApiError,
  extractLogExcerpt,
  isFinished,
  mapJobStatus,
  mapReasonToTrigger,
  type CeClient,
  type CeJobReport,
  type CeQueueJob,
} from "@/ce";
import { deriveOnboardingStatus } from "@/domain";
import { syncProblems } from "./problems-sync";
import { loadOpenRollouts } from "./rollouts";
import { errorCategory, recordRun, type PartialError, type RunOutcome } from "./sync-state";

export type CeSyncOptions = {
  db: Db;
  client: Pick<
    CeClient,
    "getQueue" | "listOrgs" | "listOrgRepos" | "listRepoJobs" | "getJobLog"
  >;
  now?: () => Date;
};

export type CeSyncSummary = RunOutcome & { repositories: number; logsFetched: number };

/** Höchstens so viele Log-Abrufe je Durchlauf; der Rest folgt im nächsten. */
export const MAX_LOG_FETCHES_PER_RUN = 10;
/** Nach so vielen Fehlversuchen (kein 404/410) wird das Log eines Jobs endgültig aufgegeben. */
export const MAX_LOG_ATTEMPTS = 3;

// Fehlversuche je CE-Job-ID, nur im Prozess (Schema bleibt unverändert). Nach einem Neustart
// beginnt die Zählung von vorn; das ist unkritisch, weil es nur um die Wiederholungen geht.
const logFailures = new Map<string, number>();

/** Nur für Tests. */
export function resetLogFailures() {
  logFailures.clear();
}
const JOB_HISTORY_LIMIT = 20;
const ERROR_MESSAGE_MAX = 300;
/** Ein als queued/running geführter Job, der nirgends mehr auftaucht, gilt nach so langer Zeit als verschwunden. */
export const VANISHED_JOB_AGE_MS = 6 * 3_600_000;
export const VANISHED_STATUS_RAW = "verschwunden";

function toDate(v: string | undefined | null): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function shortError(job: CeJobReport): string | null {
  const parts = [job.error?.name, job.error?.message].filter(
    (p): p is string => typeof p === "string" && p.length > 0,
  );
  if (parts.length === 0) return null;
  return parts.join(": ").replace(/\s+/g, " ").slice(0, ERROR_MESSAGE_MAX);
}

function queueRepository(job: CeQueueJob): string | null {
  const repo = job.repository;
  if (typeof repo !== "string" || repo.length === 0) return null;
  if (repo.includes("/")) return repo;
  return job.organizationName ? `${job.organizationName}/${repo}` : null;
}

type KnownRepo = typeof repositories.$inferSelect & { ownerName: string };

/**
 * Zuordnung CE -> Repo über den vollen Namen. Annahme (MVP, design.md Entscheidung 3): genau ein
 * Tenant, ein Name gehört zu genau einem Repo. Tragen mehrere Repos (etwa in mehreren Connections
 * nach einer Übertragung) denselben Namen, ist die Zuordnung mehrdeutig: Der Name wird nicht
 * zugeordnet und als Kollision gemeldet, statt still ein Repo zu überschreiben.
 */
function indexByFullName(repos: readonly KnownRepo[]) {
  const unique = new Map<string, KnownRepo>();
  const collisions = new Set<string>();
  for (const r of repos) {
    const key = r.fullName.toLowerCase();
    if (unique.has(key) || collisions.has(key)) {
      unique.delete(key);
      collisions.add(key);
    } else {
      unique.set(key, r);
    }
  }
  return { unique, collisions };
}

/**
 * Jobs, die in der Datenbank noch queued/running sind, aber weder in der Queue noch (nach erfolgreich
 * gelesener Historie) im Verlauf ihres Repos stehen und älter als 6 Stunden sind, werden auf
 * `failed` mit `status_raw = 'verschwunden'` gesetzt. Jobs archivierter oder entfernter Repos sofort,
 * denn deren Historie wird nicht gelesen. Beendet in der Historie stehende Jobs sind vorher schon
 * auf ihren Endwert gesetzt.
 */
async function markVanishedJobs(
  db: Db,
  now: Date,
  queueJobIds: ReadonlySet<string>,
  historyReadRepoIds: ReadonlySet<string>,
  /** Jobs, die die Historie selbst noch als laufend oder wartend führt: nicht verschwunden. */
  historyOpenJobIds: ReadonlySet<string>,
): Promise<void> {
  const open = await db
    .select({
      id: renovateJobs.id,
      ceJobId: renovateJobs.ceJobId,
      repositoryId: renovateJobs.repositoryId,
      startedAt: renovateJobs.startedAt,
      createdAt: renovateJobs.createdAt,
      archived: repositories.archived,
      removedAt: repositories.removedAt,
    })
    .from(renovateJobs)
    .innerJoin(repositories, eq(repositories.id, renovateJobs.repositoryId))
    .where(inArray(renovateJobs.status, ["queued", "running"]));
  const vanished = open.filter((j) => {
    if (queueJobIds.has(j.ceJobId) || historyOpenJobIds.has(j.ceJobId)) return false;
    if (j.archived || j.removedAt !== null) return true;
    const since = (j.startedAt ?? j.createdAt).getTime();
    return historyReadRepoIds.has(j.repositoryId) && now.getTime() - since > VANISHED_JOB_AGE_MS;
  });
  if (vanished.length === 0) return;
  await db
    .update(renovateJobs)
    .set({ status: "failed", statusRaw: VANISHED_STATUS_RAW })
    .where(
      and(
        inArray(
          renovateJobs.id,
          vanished.map((j) => j.id),
        ),
        inArray(renovateJobs.status, ["queued", "running"]),
      ),
    );
}

/**
 * Ein CE-Durchlauf (design.md, Entscheidung 7). Fehler je Org oder Repo werden gefangen und als
 * Teilfehler vermerkt. Danach werden die Probleme neu bewertet.
 */
export async function runCeSync(options: CeSyncOptions): Promise<CeSyncSummary> {
  const { db, client } = options;
  const clock = options.now ?? (() => new Date());
  const partialErrors: PartialError[] = [];
  let logsFetched = 0;

  const loadRepos = async (): Promise<KnownRepo[]> => {
    const rows = await db
      .select({ repo: repositories, ownerName: platformConnections.ownerName })
      .from(repositories)
      .innerJoin(platformConnections, eq(platformConnections.id, repositories.connectionId))
      .where(isNull(repositories.removedAt));
    return rows.map((r) => ({ ...r.repo, ownerName: r.ownerName }));
  };

  const repos = await loadRepos();
  const { unique: byFullName, collisions } = indexByFullName(repos);
  for (const name of collisions) {
    partialErrors.push({
      repository: name,
      message: "Mehrdeutige Zuordnung (mehrere Repos mit gleichem Namen)",
    });
  }
  const openRollouts = await loadOpenRollouts(
    db,
    repos.map((r) => r.id),
  );

  // 1. Repo-Status je Org (Reporting-API) -> repositories.ce_status.
  try {
    const orgs = await client.listOrgs();
    for (const org of orgs) {
      try {
        const ceRepos = await client.listOrgRepos(org.name);
        for (const ceRepo of ceRepos) {
          const row = byFullName.get(ceRepo.fullName.toLowerCase());
          if (!row || row.ownerName.toLowerCase() !== org.name.toLowerCase()) continue;
          if (row.ceStatus === ceRepo.status) continue;
          const open = openRollouts.get(row.id);
          // Zeile sperren und frisch lesen: Der GitHub-Abgleich schreibt config_path parallel.
          await db.transaction(async (tx) => {
            const [fresh] = await tx
              .select({ configPath: repositories.configPath })
              .from(repositories)
              .where(eq(repositories.id, row.id))
              .for("update");
            if (!fresh) return;
            await tx
              .update(repositories)
              .set({
                ceStatus: ceRepo.status,
                // `disabled` von CE ändert den Onboarding-Status nur bei vorhandener Konfiguration.
                onboardingStatus: deriveOnboardingStatus({
                  hasConfig: fresh.configPath !== null,
                  openOnboardingPr: open?.onboarding ?? false,
                  ceStatus: ceRepo.status,
                }),
              })
              .where(eq(repositories.id, row.id));
          });
        }
      } catch (e) {
        partialErrors.push({ repository: org.name, message: errorCategory(e) });
      }
    }
  } catch (e) {
    partialErrors.push({ repository: "(Repo-Status)", message: errorCategory(e) });
  }

  // 2. Laufende und wartende Jobs. Beendete Jobs werden nie auf "läuft" zurückgesetzt.
  let queueJobIds: Set<string> | null = null;
  try {
    const queue = await client.getQueue();
    queueJobIds = new Set([...queue.running, ...queue.pending].map((j) => j.jobId));
    const entries: [CeQueueJob, "running" | "queued"][] = [
      ...queue.running.map((j) => [j, "running"] as [CeQueueJob, "running"]),
      ...queue.pending.map((j) => [j, "queued"] as [CeQueueJob, "queued"]),
    ];
    for (const [job, status] of entries) {
      const name = queueRepository(job);
      const row = name ? byFullName.get(name.toLowerCase()) : undefined;
      if (!row) continue;
      const values = {
        trigger: mapReasonToTrigger(job.reason),
        reason: job.reason ?? null,
        status,
        statusRaw: status,
        startedAt: toDate(job.startedAt),
      };
      await db
        .insert(renovateJobs)
        .values({ repositoryId: row.id, ceJobId: job.jobId, ...values })
        .onConflictDoUpdate({
          target: renovateJobs.ceJobId,
          set: {
            ...values,
            // Eine fehlende Startzeit überschreibt keine vorhandene.
            startedAt: sql`coalesce(excluded.started_at, ${renovateJobs.startedAt})`,
          },
          setWhere: inArray(renovateJobs.status, ["queued", "running"]),
        });
    }
  } catch (e) {
    partialErrors.push({ repository: "(Queue)", message: errorCategory(e) });
  }

  // 3. Job-Historie je bekanntem, nicht archiviertem Repo (ohne mehrdeutige Namen).
  const historyReadRepoIds = new Set<string>();
  const historyOpenJobIds = new Set<string>();
  for (const row of byFullName.values()) {
    if (row.archived) continue;
    try {
      const history = await client.listRepoJobs(row.fullName, JOB_HISTORY_LIMIT);
      for (const job of history) {
        if (!isFinished(mapJobStatus(job.status))) historyOpenJobIds.add(job.jobId);
        const values = {
          trigger: mapReasonToTrigger(job.reason),
          reason: job.reason ?? null,
          status: mapJobStatus(job.status),
          statusRaw: job.status,
          startedAt: toDate(job.startedAt),
          finishedAt: toDate(job.completedAt),
          errorMessage: shortError(job),
          artifactErrorCount: job.artifactErrors?.length ?? 0,
        };
        await db
          .insert(renovateJobs)
          .values({ repositoryId: row.id, ceJobId: job.jobId, ...values })
          .onConflictDoUpdate({
            target: renovateJobs.ceJobId,
            set: {
              ...values,
              // Fehlende Zeiten überschreiben keine vorhandenen.
              startedAt: sql`coalesce(excluded.started_at, ${renovateJobs.startedAt})`,
              finishedAt: sql`coalesce(excluded.finished_at, ${renovateJobs.finishedAt})`,
            },
          });
      }
      historyReadRepoIds.add(row.id);

      // Log-Auszug einmal je fehlgeschlagenem Job; "" heißt: abgerufen, nichts Verwertbares.
      const missing = await db
        .select({ id: renovateJobs.id, ceJobId: renovateJobs.ceJobId })
        .from(renovateJobs)
        .where(
          and(
            eq(renovateJobs.repositoryId, row.id),
            eq(renovateJobs.status, "failed"),
            // Bereinigte Jobs (`purged`) haben kein Log mehr.
            sql`${renovateJobs.statusRaw} is distinct from 'purged'`,
            isNull(renovateJobs.logExcerpt),
            inArray(
              renovateJobs.ceJobId,
              history.map((j) => j.jobId),
            ),
          ),
        );
      let logFailed = false;
      for (const job of missing) {
        if (logsFetched >= MAX_LOG_FETCHES_PER_RUN) break;
        logsFetched++;
        try {
          const excerpt = extractLogExcerpt(await client.getJobLog(job.ceJobId));
          await db.update(renovateJobs).set({ logExcerpt: excerpt }).where(eq(renovateJobs.id, job.id));
          logFailures.delete(job.ceJobId);
        } catch (e) {
          // Log gelöscht: endgültig leer markieren. Sonst Teilfehler (einmal je Repo) und im
          // nächsten Durchlauf erneut versuchen; der Rest des Repos wird trotzdem abgeglichen.
          if (e instanceof CeApiError && (e.status === 404 || e.status === 410)) {
            await db.update(renovateJobs).set({ logExcerpt: "" }).where(eq(renovateJobs.id, job.id));
            logFailures.delete(job.ceJobId);
          } else {
            const attempts = (logFailures.get(job.ceJobId) ?? 0) + 1;
            if (attempts >= MAX_LOG_ATTEMPTS) {
              // Aufgeben: "" heißt abgerufen, nichts Verwertbares; sonst würde der Job das
              // Kontingent der Abrufe jede Minute erneut belegen.
              logFailures.delete(job.ceJobId);
              await db.update(renovateJobs).set({ logExcerpt: "" }).where(eq(renovateJobs.id, job.id));
              partialErrors.push({
                repository: row.fullName,
                message: `Log aufgegeben nach ${MAX_LOG_ATTEMPTS} Fehlversuchen: ${errorCategory(e)}`,
              });
            } else {
              logFailures.set(job.ceJobId, attempts);
              if (!logFailed) {
                logFailed = true;
                partialErrors.push({ repository: row.fullName, message: `Log: ${errorCategory(e)}` });
              }
            }
          }
        }
      }

      const finished = history
        .filter((j) => j.status !== "purged")
        .map((j) => ({ at: toDate(j.completedAt) ?? toDate(j.startedAt), status: mapJobStatus(j.status) }))
        .filter((j): j is { at: Date; status: "success" | "failed" } => j.at !== null && isFinished(j.status))
        .sort((a, b) => b.at.getTime() - a.at.getTime())[0];
      if (finished) {
        await db
          .update(repositories)
          .set({ lastJobAt: finished.at, lastJobResult: finished.status })
          .where(eq(repositories.id, row.id));
      }
    } catch (e) {
      partialErrors.push({ repository: row.fullName, message: errorCategory(e) });
    }
  }

  // 4. Verschwundene Jobs; nur mit vollständig gelesener Queue.
  if (queueJobIds) {
    try {
      await markVanishedJobs(db, clock(), queueJobIds, historyReadRepoIds, historyOpenJobIds);
    } catch (e) {
      partialErrors.push({ repository: "(Verschwundene Jobs)", message: errorCategory(e) });
    }
  }

  await syncProblems(db, { now: clock() });
  const outcome: RunOutcome = { partialErrors };
  await recordRun(db, "ce", outcome, clock());
  return { ...outcome, repositories: repos.length, logsFetched };
}
