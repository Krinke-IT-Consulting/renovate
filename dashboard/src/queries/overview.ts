import { and, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { problems, pullRequests, renovateJobs, repositories } from "@/db/schema";
import { deriveRepoHealth, type RepoHealth } from "@/domain/status-tone";
import type { ProblemKind } from "@/domain/problems";
import type { ReportInput, ReportProblem, ReportPr, ReportRepo } from "@/domain/report";

export type RepoTile = { fullName: string; health: RepoHealth };

export type OverviewMetrics = {
  repos: number;
  onboarded: number;
  openPrs: number;
  automergePrs: number;
  jobs7d: number;
  failedJobs7d: number;
  openProblems: number;
};

export type OverviewData = {
  report: ReportInput;
  tiles: RepoTile[];
  metrics: OverviewMetrics;
};

/** Alles für den Lagebericht in wenigen Abfragen; entfernte Repos bleiben außen vor. */
export async function loadOverview(db: Db, now = new Date()): Promise<OverviewData> {
  const repoRows = await db
    .select({
      id: repositories.id,
      fullName: repositories.fullName,
      onboarding: repositories.onboardingStatus,
      archived: repositories.archived,
    })
    .from(repositories)
    .where(isNull(repositories.removedAt))
    .orderBy(repositories.fullName);
  const repoIds = repoRows.map((r) => r.id);
  const nameOf = new Map(repoRows.map((r) => [r.id, r.fullName]));

  // Gleiches Fenster wie die Seite /jobs, auf die die Kennzahl verlinkt.
  const since = new Date(now.getTime() - 7 * 86_400_000);
  const [prRows, problemRows, jobStats, activeJobs, anyJob] = repoIds.length
    ? await Promise.all([
        db
          .select()
          .from(pullRequests)
          .where(and(eq(pullRequests.state, "open"), inArray(pullRequests.repositoryId, repoIds))),
        db
          .select()
          .from(problems)
          .where(and(isNull(problems.resolvedAt), inArray(problems.repositoryId, repoIds))),
        db
          .select({
            total: sql<number>`count(*)::int`,
            failed: sql<number>`count(*) filter (where ${renovateJobs.status} = 'failed')::int`,
          })
          .from(renovateJobs)
          .where(
            and(
              inArray(renovateJobs.repositoryId, repoIds),
              gte(sql`coalesce(${renovateJobs.startedAt}, ${renovateJobs.createdAt})`, since),
            ),
          ),
        db
          .selectDistinct({ repositoryId: renovateJobs.repositoryId })
          .from(renovateJobs)
          .where(and(inArray(renovateJobs.status, ["queued", "running"]), inArray(renovateJobs.repositoryId, repoIds))),
        db.select({ id: renovateJobs.id }).from(renovateJobs).limit(1),
      ])
    : [[], [], [{ total: 0, failed: 0 }], [], []];

  const openPrs: ReportPr[] = prRows.map((p) => ({
    id: p.id,
    number: p.number,
    title: p.title,
    url: p.url,
    updateType: p.updateType,
    packageNames: p.packageNames,
    ciStatus: p.ciStatus,
    createdAt: p.createdAt,
    repoFullName: nameOf.get(p.repositoryId)!,
  }));
  const prByKey = new Map(prRows.map((p) => [`${p.repositoryId}#${p.number}`, p]));

  const openProblems: ReportProblem[] = problemRows.map((p) => {
    const prNumber = /^\d+$/.test(p.dedupeKey) ? Number(p.dedupeKey) : null;
    const pr = prNumber !== null ? prByKey.get(`${p.repositoryId}#${prNumber}`) : undefined;
    return {
      id: p.id,
      kind: p.kind,
      message: p.message,
      firstSeenAt: p.firstSeenAt,
      repoFullName: nameOf.get(p.repositoryId)!,
      prNumber,
      prUrl: pr?.url ?? null,
      prIsSecurity: pr?.updateType === "security",
    };
  });

  const active = new Set(activeJobs.map((j) => j.repositoryId));
  const kindsByRepo = new Map<string, ProblemKind[]>();
  for (const p of problemRows) kindsByRepo.set(p.repositoryId, [...(kindsByRepo.get(p.repositoryId) ?? []), p.kind]);

  const tiles: RepoTile[] = repoRows
    .filter((r) => !r.archived)
    .map((r) => ({
      fullName: r.fullName,
      health: deriveRepoHealth({
        archived: r.archived,
        removed: false,
        onboarding: r.onboarding,
        openProblemKinds: kindsByRepo.get(r.id) ?? [],
        openSecurityPrs: prRows.filter((p) => p.repositoryId === r.id && p.updateType === "security").length,
        openMajorPrs: prRows.filter((p) => p.repositoryId === r.id && p.updateType === "major").length,
        jobActive: active.has(r.id),
      }),
    }));

  const repos: ReportRepo[] = repoRows.map((r) => ({ id: r.id, fullName: r.fullName, onboarding: r.onboarding, archived: r.archived }));
  const activeRepos = repoRows.filter((r) => !r.archived);

  return {
    report: { now, repos, openPrs, openProblems, hasAnyJob: anyJob.length > 0 },
    tiles,
    metrics: {
      repos: activeRepos.length,
      onboarded: activeRepos.filter((r) => r.onboarding === "onboarded").length,
      openPrs: prRows.length,
      automergePrs: prRows.filter((p) => p.automerge).length,
      jobs7d: jobStats[0]?.total ?? 0,
      failedJobs7d: jobStats[0]?.failed ?? 0,
      openProblems: problemRows.length,
    },
  };
}
