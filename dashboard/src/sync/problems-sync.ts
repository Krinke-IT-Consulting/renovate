import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { problems, pullRequests, renovateJobs, repositories } from "@/db/schema";
import { deriveProblems, reconcileProblems, type ProblemInput } from "@/domain";
import { SYNC_LOCK_KEYS, withAdvisoryLock } from "./lock";

export type ProblemsSyncResult = {
  inserted: number;
  touched: number;
  resolved: number;
  /** true, wenn eine andere Bewertung lief; der nächste Lauf bewertet erneut. */
  skipped?: boolean;
};

/**
 * Bewertet die Probleme aller Repos (oder der genannten) neu aus dem Datenbankzustand und gleicht
 * sie mit den offenen Problemen ab: neu -> einfügen, weiter da -> last_seen_at, weg -> resolved_at.
 * Idempotent; entfernte Repos zählen wie archivierte (keine Probleme).
 *
 * Läuft unter einem eigenen Advisory-Lock (`SYNC_LOCK_KEYS.problems`), damit GitHub- und CE-Abgleich
 * sie nie parallel ausführen. Ist der Lock belegt, wird übersprungen (`skipped`).
 */
export async function syncProblems(
  db: Db,
  options: { repositoryIds?: readonly string[]; now?: Date } = {},
): Promise<ProblemsSyncResult> {
  const result = await withAdvisoryLock(db.$client, SYNC_LOCK_KEYS.problems, () =>
    evaluateProblems(db, options),
  );
  return result.ran ? result.value : { inserted: 0, touched: 0, resolved: 0, skipped: true };
}

async function evaluateProblems(
  db: Db,
  options: { repositoryIds?: readonly string[]; now?: Date },
): Promise<ProblemsSyncResult> {
  const now = options.now ?? new Date();
  const total: ProblemsSyncResult = { inserted: 0, touched: 0, resolved: 0 };

  const repos = await db
    .select({
      id: repositories.id,
      archived: repositories.archived,
      removedAt: repositories.removedAt,
      onboarding: repositories.onboardingStatus,
      buildCheck: repositories.buildCheckStatus,
      ceStatus: repositories.ceStatus,
    })
    .from(repositories)
    .where(options.repositoryIds ? inArray(repositories.id, [...options.repositoryIds]) : undefined);

  for (const repo of repos) {
    // Letzter beendeter Job; wartende und laufende Jobs verdecken ihn nicht. Bereinigte Jobs
    // (`purged`: Log von CE gelöscht) sind kein Ergebnis und zählen nicht.
    const [job] = await db
      .select({
        status: renovateJobs.status,
        errorMessage: renovateJobs.errorMessage,
        artifactErrorCount: renovateJobs.artifactErrorCount,
      })
      .from(renovateJobs)
      .where(
        and(
          eq(renovateJobs.repositoryId, repo.id),
          inArray(renovateJobs.status, ["success", "failed"]),
          sql`${renovateJobs.statusRaw} is distinct from 'purged'`,
        ),
      )
      .orderBy(sql`coalesce(${renovateJobs.finishedAt}, ${renovateJobs.startedAt}) desc nulls last`)
      .limit(1);

    const openPrs = await db
      .select({
        number: pullRequests.number,
        updateType: pullRequests.updateType,
        ciStatus: pullRequests.ciStatus,
        createdAt: pullRequests.createdAt,
      })
      .from(pullRequests)
      .where(and(eq(pullRequests.repositoryId, repo.id), eq(pullRequests.state, "open")));

    const input: ProblemInput = {
      repo: {
        archived: repo.archived || repo.removedAt !== null,
        onboarding: repo.onboarding,
        buildCheck: repo.buildCheck,
        ceStatus: repo.ceStatus,
      },
      lastJob: job
        ? {
            status: job.status,
            error: job.errorMessage ? { message: job.errorMessage } : null,
            artifactErrors: Array.from({ length: job.artifactErrorCount }),
          }
        : null,
      openPrs,
      now,
    };
    const derived = deriveProblems(input);

    const existing = await db
      .select({ id: problems.id, kind: problems.kind, dedupeKey: problems.dedupeKey })
      .from(problems)
      .where(and(eq(problems.repositoryId, repo.id), isNull(problems.resolvedAt)))
      .orderBy(desc(problems.firstSeenAt));

    const plan = reconcileProblems(existing, derived, now);

    if (plan.insert.length > 0) {
      await db
        .insert(problems)
        .values(
          plan.insert.map((p) => ({
            repositoryId: repo.id,
            kind: p.kind,
            dedupeKey: p.dedupeKey,
            message: p.message,
            firstSeenAt: p.firstSeenAt,
            lastSeenAt: p.firstSeenAt,
          })),
        )
        // Teil-Unique-Index (offene Probleme): ein paralleler Eintrag ist kein Fehler.
        .onConflictDoNothing();
    }
    const messages = new Map(derived.map((d) => [`${d.kind}\u0000${d.dedupeKey}`, d.message]));
    for (const t of plan.touch) {
      await db
        .update(problems)
        .set({ lastSeenAt: t.lastSeenAt, message: messages.get(`${t.kind}\u0000${t.dedupeKey}`) })
        .where(eq(problems.id, t.id));
    }
    if (plan.resolve.length > 0) {
      await db
        .update(problems)
        .set({ resolvedAt: now })
        .where(
          and(
            inArray(
              problems.id,
              plan.resolve.map((r) => r.id),
            ),
            isNull(problems.resolvedAt),
          ),
        );
    }
    total.inserted += plan.insert.length;
    total.touched += plan.touch.length;
    total.resolved += plan.resolve.length;
  }
  return total;
}
