import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { renovateJobs, repositories, rolloutActions } from "@/db/schema";
import type { BuildCheckStatus, OnboardingStatus } from "@/domain/repo-status";
import { buildSteps, type ReportInput, type Step } from "@/domain/report";
import { deriveRepoHealth, type RepoHealth } from "@/domain/status-tone";
import { listJobs, type JobRow } from "@/queries/jobs";
import { countProblems, listProblems, type ProblemRow } from "@/queries/problems";
import { listOpenPullRequests, type PullRequestRow } from "@/queries/pull-requests";

/** So viele Läufe zeigt das Repo-Detail. */
export const REPO_DETAIL_JOBS = 20;

export type RolloutRow = {
  id: string;
  kind: "onboarding" | "build_check";
  status: "pending" | "pr_open" | "merged" | "failed" | "closed";
  prUrl: string | null;
  prNumber: number | null;
  createdAt: Date;
};

export type RepoDetail = {
  id: string;
  fullName: string;
  owner: string;
  name: string;
  archived: boolean;
  removedAt: Date | null;
  onboarding: OnboardingStatus;
  buildCheck: BuildCheckStatus;
  ownCi: boolean;
  configPath: string | null;
  dependencyDashboardUrl: string | null;
  lastJobAt: Date | null;
  lastJobResult: "success" | "failed" | "skipped" | "unknown";
  health: RepoHealth;
  /** "Was hier zu tun ist": offene Probleme und PRs, die eine Entscheidung brauchen. */
  steps: Step[];
  openPrs: PullRequestRow[];
  jobs: JobRow[];
  openProblems: ProblemRow[];
  /** Behobene Probleme der letzten 30 Tage. */
  resolvedProblems: number;
  rollouts: RolloutRow[];
};

/** Schritte dieses Repos im Format des Lageberichts (gleiche Reihenfolge, gleiche Bausteine). */
export function repoSteps(
  repo: { fullName: string; onboarding: OnboardingStatus; archived: boolean; removed: boolean },
  openPrs: PullRequestRow[],
  openProblems: ProblemRow[],
  now: Date,
): Step[] {
  const prByNumber = new Map(openPrs.map((p) => [p.number, p]));
  const input: ReportInput = {
    now,
    // Archivierte und entfernte Repos haben keine Aufgaben (wie im Lagebericht).
    repos: [{ fullName: repo.fullName, onboarding: repo.onboarding, archived: repo.archived || repo.removed }],
    openPrs: openPrs.map((p) => ({
      id: p.id,
      number: p.number,
      title: p.title,
      url: p.url,
      updateType: p.updateType,
      packageNames: p.packageNames,
      ciStatus: p.ciStatus,
      createdAt: p.createdAt,
      repoFullName: repo.fullName,
    })),
    openProblems: openProblems.map((p) => {
      const prNumber = /^\d+$/.test(p.dedupeKey) ? Number(p.dedupeKey) : null;
      const pr = prNumber !== null ? prByNumber.get(prNumber) : undefined;
      return {
        id: p.id,
        kind: p.kind,
        message: p.message,
        firstSeenAt: p.firstSeenAt,
        repoFullName: repo.fullName,
        prNumber,
        prUrl: pr?.url ?? null,
        prIsSecurity: pr?.updateType === "security",
      };
    }),
    hasAnyJob: true,
  };
  return repo.removed ? [] : buildSteps(input);
}

/** Alles für die Repo-Detailseite; `null`, wenn es das Repo nicht gibt (nicht abgeglichen). */
export async function loadRepoDetail(db: Db, fullName: string, now = new Date()): Promise<RepoDetail | null> {
  // full_name ist nicht eindeutig (Umbenennung): ein nicht entferntes Repo hat Vorrang.
  const [repo] = await db
    .select()
    .from(repositories)
    .where(sql`lower(${repositories.fullName}) = lower(${fullName})`)
    .orderBy(sql`${repositories.removedAt} is not null`, desc(repositories.firstSeenAt))
    .limit(1);
  if (!repo) return null;

  const scope = { repositoryId: repo.id };
  const [openPrs, jobs, openProblems, counts, rollouts, active] = await Promise.all([
    listOpenPullRequests(db, scope),
    listJobs(db, { ...scope, page: 1, pageSize: REPO_DETAIL_JOBS }, now),
    listProblems(db, { ...scope, state: "offen" }, now),
    countProblems(db, scope, now),
    db
      .select({
        id: rolloutActions.id,
        kind: rolloutActions.kind,
        status: rolloutActions.status,
        prUrl: rolloutActions.prUrl,
        prNumber: rolloutActions.prNumber,
        createdAt: rolloutActions.createdAt,
      })
      .from(rolloutActions)
      .where(eq(rolloutActions.repositoryId, repo.id))
      .orderBy(desc(rolloutActions.createdAt), desc(rolloutActions.id)),
    db
      .select({ id: renovateJobs.id })
      .from(renovateJobs)
      .where(and(eq(renovateJobs.repositoryId, repo.id), inArray(renovateJobs.status, ["queued", "running"])))
      .limit(1),
  ]);

  const removed = repo.removedAt !== null;
  const [owner, ...rest] = repo.fullName.split("/");
  return {
    id: repo.id,
    fullName: repo.fullName,
    owner,
    name: rest.join("/"),
    archived: repo.archived,
    removedAt: repo.removedAt,
    onboarding: repo.onboardingStatus,
    buildCheck: repo.buildCheckStatus,
    ownCi: repo.ownCi,
    configPath: repo.configPath,
    dependencyDashboardUrl: repo.dependencyDashboardUrl,
    lastJobAt: repo.lastJobAt,
    lastJobResult: repo.lastJobResult,
    health: deriveRepoHealth({
      archived: repo.archived,
      removed,
      onboarding: repo.onboardingStatus,
      openProblemKinds: openProblems.map((p) => p.kind),
      openSecurityPrs: openPrs.filter((p) => p.updateType === "security").length,
      openMajorPrs: openPrs.filter((p) => p.updateType === "major").length,
      jobActive: active.length > 0,
    }),
    steps: repoSteps(
      { fullName: repo.fullName, onboarding: repo.onboardingStatus, archived: repo.archived, removed },
      openPrs,
      openProblems,
      now,
    ),
    openPrs,
    jobs: jobs.rows,
    openProblems,
    resolvedProblems: counts.behoben,
    rollouts,
  };
}
