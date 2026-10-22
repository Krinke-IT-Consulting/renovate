import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { platformConnections, pullRequests, repositories } from "@/db/schema";
import { BULK_MERGE_LIMIT, BULK_MERGE_TYPES, preferredMergeMethod, type MergeTarget } from "@/merge/types";

export type BulkMergeCandidates = {
  /** Höchstens BULK_MERGE_LIMIT, sortiert nach Repo, dann Alter; genau das, was die Action mergt. */
  targets: MergeTarget[];
  repoCount: number;
  /** Alle Kandidaten vor der Begrenzung (größer als targets.length, wenn das Limit greift). */
  total: number;
};

/**
 * Kandidaten des Sammel-Merge (design.md, Entscheidung 5): offene Patch-/Minor-PRs mit grüner CI
 * in Repos, die nicht archiviert oder entfernt sind und mindestens eine Merge-Methode erlauben.
 * Die Oberfläche übergibt `targets` unverändert an die Action `mergeAllGreen`.
 */
export async function listBulkMergeCandidates(db: Pick<Db, "select">): Promise<BulkMergeCandidates> {
  const rows = await db
    .select({
      pullRequestId: pullRequests.id,
      headSha: pullRequests.headSha,
      repositoryId: repositories.id,
      methods: repositories.mergeMethods,
    })
    .from(pullRequests)
    .innerJoin(repositories, eq(pullRequests.repositoryId, repositories.id))
    .innerJoin(platformConnections, eq(repositories.connectionId, platformConnections.id))
    .where(
      and(
        eq(pullRequests.state, "open"),
        inArray(pullRequests.updateType, [...BULK_MERGE_TYPES]),
        eq(pullRequests.ciStatus, "success"),
        isNotNull(pullRequests.headSha),
        eq(repositories.archived, false),
        isNull(repositories.removedAt),
        isNotNull(platformConnections.installationId),
        sql`cardinality(${repositories.mergeMethods}) > 0`,
      ),
    )
    .orderBy(asc(repositories.fullName), asc(pullRequests.createdAt), asc(pullRequests.number));

  const candidates: (MergeTarget & { repositoryId: string })[] = [];
  for (const r of rows) {
    const method = preferredMergeMethod(r.methods);
    if (!method || !r.headSha) continue;
    candidates.push({
      pullRequestId: r.pullRequestId,
      expectedSha: r.headSha,
      expectedMethod: method,
      repositoryId: r.repositoryId,
    });
  }
  const limited = candidates.slice(0, BULK_MERGE_LIMIT);
  return {
    targets: limited.map(({ pullRequestId, expectedSha, expectedMethod }) => ({
      pullRequestId,
      expectedSha,
      expectedMethod,
    })),
    repoCount: new Set(limited.map((c) => c.repositoryId)).size,
    total: candidates.length,
  };
}
