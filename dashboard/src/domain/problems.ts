import type { BuildCheckStatus, OnboardingStatus } from "./repo-status";
import type { CiStatus, UpdateType } from "./pull-requests";

/** Schwellen in Tagen (Spec dashboard-sync, "Probleme ableiten"). */
export const STALE_PR_DAYS = 14;
export const STALE_SECURITY_PR_DAYS = 7;

export type ProblemKind =
  | "config_error"
  | "lockfile_failure"
  | "job_failed"
  | "stale_pr"
  | "ci_red"
  | "missing_build_check";

export type DerivedProblem = { kind: ProblemKind; dedupeKey: string; message: string };

export type ProblemInput = {
  repo: {
    archived: boolean;
    onboarding: OnboardingStatus;
    buildCheck: BuildCheckStatus;
    ceStatus: string | null;
  };
  lastJob: {
    status: "queued" | "running" | "success" | "failed";
    error?: { name?: string | null; message?: string | null } | null;
    artifactErrors?: readonly unknown[] | null;
  } | null;
  openPrs: readonly {
    number: number;
    updateType: UpdateType;
    ciStatus: CiStatus;
    createdAt: Date;
  }[];
  now: Date;
};

const DAY_MS = 86_400_000;
const CONFIG_HINT = /config|validation/i;

export function deriveProblems(input: ProblemInput): DerivedProblem[] {
  const { repo, lastJob, openPrs, now } = input;
  if (repo.archived) return [];
  const out: DerivedProblem[] = [];

  const jobFailed = lastJob?.status === "failed";
  const configError =
    repo.ceStatus === "failed" ||
    (jobFailed && CONFIG_HINT.test(`${lastJob?.error?.name ?? ""} ${lastJob?.error?.message ?? ""}`));
  const lockfileFailure = (lastJob?.artifactErrors?.length ?? 0) > 0;

  if (configError) {
    out.push({
      kind: "config_error",
      dedupeKey: "",
      message: "Renovate meldet einen Konfigurationsfehler.",
    });
  }
  if (lockfileFailure) {
    out.push({
      kind: "lockfile_failure",
      dedupeKey: "",
      message: "Lockfiles konnten im letzten Lauf nicht aktualisiert werden.",
    });
  }
  if (jobFailed && !configError && !lockfileFailure) {
    out.push({ kind: "job_failed", dedupeKey: "", message: "Der letzte Renovate-Lauf ist fehlgeschlagen." });
  }

  for (const pr of openPrs) {
    const key = String(pr.number);
    const limitDays = pr.updateType === "security" ? STALE_SECURITY_PR_DAYS : STALE_PR_DAYS;
    const ageMs = now.getTime() - pr.createdAt.getTime();
    if (ageMs > limitDays * DAY_MS) {
      // Angefangene Tage aufgerundet: Die Anzeige liegt damit immer über der Grenze.
      const ageDays = Math.ceil(ageMs / DAY_MS);
      out.push({
        kind: "stale_pr",
        dedupeKey: key,
        message: `PR #${pr.number} ist seit ${ageDays} Tagen offen (Grenze ${limitDays} Tage).`,
      });
    }
    if (pr.ciStatus === "failure") {
      out.push({ kind: "ci_red", dedupeKey: key, message: `PR #${pr.number}: CI ist fehlgeschlagen.` });
    }
  }

  if (repo.onboarding === "onboarded" && repo.buildCheck === "missing") {
    out.push({
      kind: "missing_build_check",
      dedupeKey: "",
      message: "Der Build-Check ist nicht eingerichtet.",
    });
  }
  return out;
}

export type ProblemKey = { kind: ProblemKind; dedupeKey: string };

/** Abgleich offener Probleme: neu -> insert, weiter da -> touch, weg -> resolve. */
export function reconcileProblems<E extends ProblemKey>(
  existingOpen: readonly E[],
  derived: readonly DerivedProblem[],
  now: Date,
): { insert: (DerivedProblem & { firstSeenAt: Date })[]; touch: (E & { lastSeenAt: Date })[]; resolve: (E & { resolvedAt: Date })[] } {
  const k = (p: ProblemKey) => `${p.kind}\u0000${p.dedupeKey}`;
  const existing = new Map(existingOpen.map((e) => [k(e), e]));
  const wanted = new Set(derived.map(k));
  const seen = new Set<string>();
  const insert: (DerivedProblem & { firstSeenAt: Date })[] = [];
  const touch: (E & { lastSeenAt: Date })[] = [];
  for (const d of derived) {
    const key = k(d);
    if (seen.has(key)) continue;
    seen.add(key);
    const e = existing.get(key);
    if (e) touch.push({ ...e, lastSeenAt: now });
    else insert.push({ ...d, firstSeenAt: now });
  }
  const resolve = existingOpen.filter((e) => !wanted.has(k(e))).map((e) => ({ ...e, resolvedAt: now }));
  return { insert, touch, resolve };
}
