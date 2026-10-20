import { and, asc, desc, eq, gte, ilike, inArray, isNull, sql, type SQL } from "drizzle-orm";
import type { Db } from "@/db/client";
import { renovateJobs, repositories } from "@/db/schema";
import type { JobStatus } from "@/domain/status-tone";

export const JOBS_PAGE_SIZE = 50;
/** Zeitraum der Jobs-Liste in Tagen (außer bei Filter auf ein einzelnes Repo per `repositoryId`). */
export const JOBS_WINDOW_DAYS = 7;

export type JobRow = {
  id: string;
  ceJobId: string;
  repoId: string;
  repoFullName: string;
  trigger: "schedule" | "webhook" | "manual";
  status: JobStatus;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  durationMs: number | null;
  logExcerpt: string | null;
  reason: string | null;
  artifactErrorCount: number;
};

export type JobFilter = {
  /** `full_name` der Repos; leer = alle. */
  repos?: string[];
  status?: JobStatus[];
  /** Nur ein Repo (Repo-Detail); hebt die 7-Tage-Grenze und den Ausschluss entfernter Repos auf. */
  repositoryId?: string;
  /** Freitext auf den Repo-Namen. */
  q?: string;
  /** Ab 1. */
  page: number;
  pageSize?: number;
};

/** Zeitpunkt, nach dem ein Job einsortiert wird: Start, sonst erstes Erscheinen im Dashboard. */
const sortTime = sql<Date>`coalesce(${renovateJobs.startedAt}, ${renovateJobs.createdAt})`;

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function conditions(filter: Omit<JobFilter, "page" | "pageSize">, now: Date): SQL | undefined {
  const where: (SQL | undefined)[] = [];
  if (filter.repositoryId) {
    where.push(eq(renovateJobs.repositoryId, filter.repositoryId));
  } else {
    where.push(isNull(repositories.removedAt));
    where.push(gte(sortTime, new Date(now.getTime() - JOBS_WINDOW_DAYS * 86_400_000)));
  }
  if (filter.repos?.length) where.push(inArray(repositories.fullName, filter.repos));
  if (filter.status?.length) where.push(inArray(renovateJobs.status, filter.status));
  if (filter.q) where.push(ilike(repositories.fullName, `%${escapeLike(filter.q)}%`));
  return and(...where);
}

/** Jobs, neueste zuerst; `total` zählt alle Treffer des Filters (für die Paginierung). */
export async function listJobs(
  db: Db,
  filter: JobFilter,
  now: Date = new Date(),
): Promise<{ rows: JobRow[]; total: number }> {
  const pageSize = filter.pageSize ?? JOBS_PAGE_SIZE;
  const page = Math.max(1, Math.floor(filter.page));
  const where = conditions(filter, now);

  const [rows, [count]] = await Promise.all([
    db
      .select({
        id: renovateJobs.id,
        ceJobId: renovateJobs.ceJobId,
        repoId: renovateJobs.repositoryId,
        repoFullName: repositories.fullName,
        trigger: renovateJobs.trigger,
        status: renovateJobs.status,
        startedAt: renovateJobs.startedAt,
        finishedAt: renovateJobs.finishedAt,
        createdAt: renovateJobs.createdAt,
        logExcerpt: renovateJobs.logExcerpt,
        reason: renovateJobs.reason,
        artifactErrorCount: renovateJobs.artifactErrorCount,
      })
      .from(renovateJobs)
      .innerJoin(repositories, eq(repositories.id, renovateJobs.repositoryId))
      .where(where)
      // Zweiter Schlüssel macht die Reihenfolge zwischen den Seiten stabil.
      .orderBy(desc(sortTime), desc(renovateJobs.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(renovateJobs)
      .innerJoin(repositories, eq(repositories.id, renovateJobs.repositoryId))
      .where(where),
  ]);

  return {
    rows: rows.map((r) => ({
      ...r,
      durationMs: r.startedAt && r.finishedAt ? Math.max(0, r.finishedAt.getTime() - r.startedAt.getTime()) : null,
    })),
    total: count?.n ?? 0,
  };
}

/** Läufe der letzten 7 Tage aller Repos und davon fehlgeschlagene (Zusammenfassung im Seitenkopf). */
export async function summarizeJobs(db: Db, now: Date = new Date()): Promise<{ total: number; failed: number }> {
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      failed: sql<number>`(count(*) filter (where ${renovateJobs.status} = 'failed'))::int`,
    })
    .from(renovateJobs)
    .innerJoin(repositories, eq(repositories.id, renovateJobs.repositoryId))
    .where(conditions({}, now));
  return { total: row?.total ?? 0, failed: row?.failed ?? 0 };
}

/** Alle sichtbaren (nicht entfernten) Repos, alphabetisch: Auswahl für den Repo-Filter. */
export async function listJobRepos(db: Db): Promise<{ id: string; fullName: string }[]> {
  return db
    .select({ id: repositories.id, fullName: repositories.fullName })
    .from(repositories)
    .where(isNull(repositories.removedAt))
    .orderBy(asc(repositories.fullName));
}
