/**
 * PLATZHALTER (Task 4.3, Oberflächen-Zweig): Die Fassung des Merge-Zweigs (Task 3.2) ersetzt diese
 * Datei beim Zusammenführen. Signatur und Rückgabe sind abgestimmt; die Abfrage liest bereits echt
 * aus der Datenbank (design.md, Entscheidung 5).
 */
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { pullRequests, repositories } from "@/db/schema";
import { mergeTargetOf } from "@/merge/target";
import { BULK_MERGE_LIMIT, BULK_MERGE_TYPES, type MergeTarget } from "@/merge/types";

/**
 * Kandidaten für den Sammel-Merge: offene Patch- und Minor-PRs mit grüner CI in Repos, die nicht
 * archiviert und nicht entfernt sind und mindestens eine Merge-Methode erlauben. Sortiert nach
 * Repo, dann Alter; höchstens `BULK_MERGE_LIMIT`.
 */
export async function listBulkMergeCandidates(db: Db): Promise<{ targets: MergeTarget[]; repoCount: number }> {
  const rows = await db
    .select({
      id: pullRequests.id,
      ciStatus: pullRequests.ciStatus,
      headSha: pullRequests.headSha,
      mergeMethods: repositories.mergeMethods,
      repositoryId: repositories.id,
    })
    .from(pullRequests)
    .innerJoin(repositories, eq(repositories.id, pullRequests.repositoryId))
    .where(
      and(
        eq(pullRequests.state, "open"),
        inArray(pullRequests.updateType, [...BULK_MERGE_TYPES]),
        eq(pullRequests.ciStatus, "success"),
        eq(repositories.archived, false),
        isNull(repositories.removedAt),
        sql`cardinality(${repositories.mergeMethods}) > 0`,
      ),
    )
    .orderBy(asc(repositories.fullName), asc(pullRequests.createdAt), asc(pullRequests.number));

  const picked: { target: MergeTarget; repositoryId: string }[] = [];
  for (const r of rows) {
    const target = mergeTargetOf(r);
    if (target) picked.push({ target, repositoryId: r.repositoryId });
    if (picked.length >= BULK_MERGE_LIMIT) break;
  }
  return {
    targets: picked.map((p) => p.target),
    repoCount: new Set(picked.map((p) => p.repositoryId)).size,
  };
}
