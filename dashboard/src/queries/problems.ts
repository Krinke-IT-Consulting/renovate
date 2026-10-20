import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, sql, type SQL } from "drizzle-orm";
import type { Db } from "@/db/client";
import { problems, pullRequests, repositories } from "@/db/schema";
import { problemEvidence, type ProblemEvidence } from "@/domain/problem-evidence";
import type { ProblemKind } from "@/domain/problems";

/** Behobene Probleme bleiben so viele Tage sichtbar. */
export const RESOLVED_WINDOW_DAYS = 30;

export type ProblemRow = {
  id: string;
  kind: ProblemKind;
  message: string;
  firstSeenAt: Date;
  resolvedAt: Date | null;
  repoId: string;
  repoFullName: string;
  dedupeKey: string;
  /** Genau ein Link zum Beleg (PR, Läufe oder Repo-Detail). */
  evidence: ProblemEvidence;
};

export type ProblemScope = {
  /** `full_name` der Repos; leer = alle. */
  repos?: string[];
  kinds?: ProblemKind[];
  /** Nur ein Repo (Repo-Detail); hebt den Ausschluss entfernter Repos auf. */
  repositoryId?: string;
};

export type ProblemFilter = ProblemScope & { state: "offen" | "behoben" };

function scopeConditions(scope: ProblemScope): (SQL | undefined)[] {
  const where: (SQL | undefined)[] = [];
  if (scope.repositoryId) where.push(eq(problems.repositoryId, scope.repositoryId));
  else where.push(isNull(repositories.removedAt));
  if (scope.repos?.length) where.push(inArray(repositories.fullName, scope.repos));
  if (scope.kinds?.length) where.push(inArray(problems.kind, scope.kinds));
  return where;
}

/**
 * Probleme eines Zustands. Offene: älteste zuerst (das am längsten Liegende zuerst).
 * Behobene: nur die letzten 30 Tage, zuletzt behobene zuerst.
 */
export async function listProblems(db: Db, filter: ProblemFilter, now: Date = new Date()): Promise<ProblemRow[]> {
  const open = filter.state === "offen";
  const where = [
    ...scopeConditions(filter),
    open
      ? isNull(problems.resolvedAt)
      : and(isNotNull(problems.resolvedAt), gte(problems.resolvedAt, new Date(now.getTime() - RESOLVED_WINDOW_DAYS * 86_400_000))),
  ];

  const rows = await db
    .select({
      id: problems.id,
      kind: problems.kind,
      message: problems.message,
      firstSeenAt: problems.firstSeenAt,
      resolvedAt: problems.resolvedAt,
      repoId: problems.repositoryId,
      repoFullName: repositories.fullName,
      dedupeKey: problems.dedupeKey,
      prUrl: pullRequests.url,
    })
    .from(problems)
    .innerJoin(repositories, eq(repositories.id, problems.repositoryId))
    // Beleg für PR-Probleme: die PR-Nummer steht im dedupe_key (nur Ziffern, sonst kein Join).
    .leftJoin(
      pullRequests,
      and(
        eq(pullRequests.repositoryId, problems.repositoryId),
        inArray(problems.kind, ["stale_pr", "ci_red"]),
        sql`${pullRequests.number} = case when ${problems.dedupeKey} ~ '^[0-9]{1,9}$' then ${problems.dedupeKey}::int end`,
      ),
    )
    .where(and(...where))
    .orderBy(
      ...(open
        ? [asc(problems.firstSeenAt), asc(problems.id)]
        : [desc(problems.resolvedAt), desc(problems.id)]),
    );

  return rows.map(({ prUrl, ...r }) => ({
    ...r,
    evidence: problemEvidence({ kind: r.kind, dedupeKey: r.dedupeKey, repoFullName: r.repoFullName, prUrl }),
  }));
}

/** Anzahl offener und (der letzten 30 Tage) behobener Probleme für den Umschalter. */
export async function countProblems(
  db: Db,
  scope: ProblemScope = {},
  now: Date = new Date(),
): Promise<{ offen: number; behoben: number }> {
  const since = new Date(now.getTime() - RESOLVED_WINDOW_DAYS * 86_400_000);
  const [row] = await db
    .select({
      offen: sql<number>`(count(*) filter (where ${problems.resolvedAt} is null))::int`,
      behoben: sql<number>`(count(*) filter (where ${problems.resolvedAt} >= ${since}))::int`,
    })
    .from(problems)
    .innerJoin(repositories, eq(repositories.id, problems.repositoryId))
    .where(and(...scopeConditions(scope)));
  return { offen: row?.offen ?? 0, behoben: row?.behoben ?? 0 };
}
