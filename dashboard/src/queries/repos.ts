import { and, asc, eq, ilike, inArray, isNull, sql, type SQL } from "drizzle-orm";
import type { Db } from "@/db/client";
import { problems, pullRequests, renovateJobs, repositories, syncState } from "@/db/schema";
import type { ProblemKind } from "@/domain/problems";
import type { BuildCheckStatus, OnboardingStatus } from "@/domain/repo-status";
import { deriveRepoHealth, type RepoHealth, type StatusTone } from "@/domain/status-tone";
import { sortByAttention } from "@/lib/repo-list";
import { likePattern } from "@/lib/sql";

export type RepoRow = {
  id: string;
  fullName: string;
  owner: string;
  name: string;
  archived: boolean;
  removedAt: Date | null;
  onboarding: OnboardingStatus;
  buildCheck: BuildCheckStatus;
  ownCi: boolean;
  lastJobAt: Date | null;
  lastJobResult: "success" | "failed" | "skipped" | "unknown";
  openPrs: number;
  securityPrs: number;
  majorPrs: number;
  openProblemKinds: ProblemKind[];
  jobActive: boolean;
  health: RepoHealth;
  dependencyDashboardUrl: string | null;
  /** Teilfehler des letzten Abgleichs für dieses Repo (sync_state.partial_errors), sonst null. */
  partialError: string | null;
};

export type RepoFilter = {
  /** Owner (erster Teil von `full_name`); leer = alle. */
  owners?: string[];
  /** Tonlage des Zustands (`health.tone`). */
  tones?: StatusTone[];
  /** Onboarding-Status; schließt archivierte Repos aus. */
  onboarding?: OnboardingStatus[];
  /** Nur Repos mit mindestens einem offenen Problem. */
  problem?: boolean;
  /** Nur Repos mit Markierung "eigene CI". */
  ownCi?: boolean;
  /** Entfernte Repos (`removed_at` gesetzt) mit anzeigen; ohne diesen Wert bleiben sie außen vor. */
  removed?: boolean;
  /** Freitext auf den Repo-Namen (ilike). */
  q?: string;
};

const ownerOf = sql<string>`split_part(${repositories.fullName}, '/', 1)`;

/**
 * Repos mit abgeleitetem Zustand, Zählern und Teilfehler. Standardsortierung: nach Handlungsbedarf
 * (`TONE_RANK` des Zustands), danach nach Name. Entfernte Repos nur mit `removed: true`.
 */
export async function listRepos(db: Db, filter: RepoFilter = {}): Promise<RepoRow[]> {
  const where: SQL[] = [];
  if (!filter.removed) where.push(isNull(repositories.removedAt));
  if (filter.owners?.length) where.push(inArray(ownerOf, filter.owners));
  if (filter.onboarding?.length) {
    where.push(inArray(repositories.onboardingStatus, filter.onboarding));
    // Archivierte Repos brauchen kein Onboarding; sie zählen weder im Lagebericht noch hier.
    where.push(eq(repositories.archived, false));
  }
  if (filter.ownCi) where.push(eq(repositories.ownCi, true));
  if (filter.q) where.push(ilike(repositories.fullName, likePattern(filter.q)));

  const repoRows = await db
    .select()
    .from(repositories)
    .where(and(...where))
    .orderBy(asc(repositories.fullName));
  if (repoRows.length === 0) return [];
  const ids = repoRows.map((r) => r.id);

  const [prStats, problemRows, activeJobs, syncRows] = await Promise.all([
    db
      .select({
        repositoryId: pullRequests.repositoryId,
        open: sql<number>`count(*)::int`,
        security: sql<number>`(count(*) filter (where ${pullRequests.updateType} = 'security'))::int`,
        major: sql<number>`(count(*) filter (where ${pullRequests.updateType} = 'major'))::int`,
      })
      .from(pullRequests)
      .where(and(eq(pullRequests.state, "open"), inArray(pullRequests.repositoryId, ids)))
      .groupBy(pullRequests.repositoryId),
    db
      .select({ repositoryId: problems.repositoryId, kind: problems.kind })
      .from(problems)
      .where(and(isNull(problems.resolvedAt), inArray(problems.repositoryId, ids))),
    db
      .selectDistinct({ repositoryId: renovateJobs.repositoryId })
      .from(renovateJobs)
      .where(and(inArray(renovateJobs.status, ["queued", "running"]), inArray(renovateJobs.repositoryId, ids))),
    db.select({ partialErrors: syncState.partialErrors }).from(syncState),
  ]);

  const prByRepo = new Map(prStats.map((s) => [s.repositoryId, s]));
  const kindsByRepo = new Map<string, ProblemKind[]>();
  for (const p of problemRows) kindsByRepo.set(p.repositoryId, [...(kindsByRepo.get(p.repositoryId) ?? []), p.kind]);
  const active = new Set(activeJobs.map((j) => j.repositoryId));
  const partialByRepo = new Map<string, string>();
  for (const row of syncRows) {
    for (const e of row.partialErrors) if (!partialByRepo.has(e.repository)) partialByRepo.set(e.repository, e.message);
  }

  const rows: RepoRow[] = repoRows.map((r) => {
    const pr = prByRepo.get(r.id);
    const openProblemKinds = kindsByRepo.get(r.id) ?? [];
    const securityPrs = pr?.security ?? 0;
    const majorPrs = pr?.major ?? 0;
    const jobActive = active.has(r.id);
    const [owner, ...rest] = r.fullName.split("/");
    return {
      id: r.id,
      fullName: r.fullName,
      owner,
      name: rest.join("/"),
      archived: r.archived,
      removedAt: r.removedAt,
      onboarding: r.onboardingStatus,
      buildCheck: r.buildCheckStatus,
      ownCi: r.ownCi,
      lastJobAt: r.lastJobAt,
      lastJobResult: r.lastJobResult,
      openPrs: pr?.open ?? 0,
      securityPrs,
      majorPrs,
      openProblemKinds,
      jobActive,
      dependencyDashboardUrl: r.dependencyDashboardUrl,
      partialError: partialByRepo.get(r.fullName) ?? null,
      health: deriveRepoHealth({
        archived: r.archived,
        removed: r.removedAt !== null,
        onboarding: r.onboardingStatus,
        openProblemKinds,
        openSecurityPrs: securityPrs,
        openMajorPrs: majorPrs,
        jobActive,
      }),
    };
  });

  const filtered = rows.filter(
    (r) =>
      (!filter.tones?.length || filter.tones.includes(r.health.tone)) &&
      (!filter.problem || r.openProblemKinds.length > 0),
  );
  return sortByAttention(filtered);
}

/** Owner aller bekannten Repos (auch entfernter), alphabetisch: Auswahl für die Owner-Chips. */
export async function listRepoOwners(db: Db): Promise<string[]> {
  const rows = await db.selectDistinct({ owner: ownerOf }).from(repositories).orderBy(asc(ownerOf));
  return rows.map((r) => r.owner);
}
