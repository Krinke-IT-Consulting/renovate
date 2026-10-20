import { and, asc, eq, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import type { Db } from "@/db/client";
import { pullRequests, repositories } from "@/db/schema";
import { likePattern } from "@/lib/sql";
import type { CiStatus, UpdateType } from "@/domain/pull-requests";

export type PullRequestRow = {
  id: string;
  number: number;
  title: string;
  url: string;
  updateType: UpdateType;
  packageNames: string[];
  ciStatus: CiStatus;
  automerge: boolean;
  createdAt: Date;
  repoId: string;
  repoFullName: string;
};

export type PullRequestFilter = {
  /** `full_name` der Repos. */
  repos?: string[];
  types?: UpdateType[];
  ci?: CiStatus[];
  automerge?: boolean;
  /** Freitext: Titel, Repo-Name oder Paketname (ilike). */
  q?: string;
  /** Nur ein Repo (Repo-Detail). */
  repositoryId?: string;
};

/**
 * Offene PRs von Repos ohne `removed_at`. Standardsortierung: Sicherheit zuerst, dann rote CI,
 * dann Major, danach nach Alter (älteste zuerst).
 */
export async function listOpenPullRequests(db: Db, filter: PullRequestFilter = {}): Promise<PullRequestRow[]> {
  const conditions: SQL[] = [eq(pullRequests.state, "open"), isNull(repositories.removedAt)];
  if (filter.repositoryId) conditions.push(eq(pullRequests.repositoryId, filter.repositoryId));
  if (filter.repos?.length) conditions.push(inArray(repositories.fullName, filter.repos));
  if (filter.types?.length) conditions.push(inArray(pullRequests.updateType, filter.types));
  if (filter.ci?.length) conditions.push(inArray(pullRequests.ciStatus, filter.ci));
  if (filter.automerge) conditions.push(eq(pullRequests.automerge, true));
  if (filter.q) {
    const pattern = likePattern(filter.q);
    conditions.push(
      or(
        ilike(pullRequests.title, pattern),
        ilike(repositories.fullName, pattern),
        sql`exists (select 1 from unnest(${pullRequests.packageNames}) as p(name) where p.name ilike ${pattern})`,
      )!,
    );
  }

  return db
    .select({
      id: pullRequests.id,
      number: pullRequests.number,
      title: pullRequests.title,
      url: pullRequests.url,
      updateType: pullRequests.updateType,
      packageNames: pullRequests.packageNames,
      ciStatus: pullRequests.ciStatus,
      automerge: pullRequests.automerge,
      createdAt: pullRequests.createdAt,
      repoId: repositories.id,
      repoFullName: repositories.fullName,
    })
    .from(pullRequests)
    .innerJoin(repositories, eq(repositories.id, pullRequests.repositoryId))
    .where(and(...conditions))
    .orderBy(
      sql`case when ${pullRequests.updateType} = 'security' then 0 else 1 end`,
      sql`case when ${pullRequests.ciStatus} = 'failure' then 0 else 1 end`,
      sql`case when ${pullRequests.updateType} = 'major' then 0 else 1 end`,
      asc(pullRequests.createdAt),
      asc(pullRequests.number),
    );
}

/** Distinkte Repo-Namen mit offenen PRs (Repo-Chips), alphabetisch. */
export async function listPullRequestRepos(db: Db): Promise<string[]> {
  const rows = await db
    .selectDistinct({ fullName: repositories.fullName })
    .from(pullRequests)
    .innerJoin(repositories, eq(repositories.id, pullRequests.repositoryId))
    .where(and(eq(pullRequests.state, "open"), isNull(repositories.removedAt)))
    .orderBy(asc(repositories.fullName));
  return rows.map((r) => r.fullName);
}
