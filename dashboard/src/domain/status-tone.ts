import type { ProblemKind } from "./problems";
import type { CiStatus, UpdateType } from "./pull-requests";
import type { BuildCheckStatus, OnboardingStatus } from "./repo-status";

/** Tonlage eines Status; die Farben dazu stehen als Tokens in globals.css (--status-*). */
export type StatusTone = "fehler" | "warnung" | "erfolg" | "laeuft" | "neutral";

/** Rangfolge für "dringendster Zustand" und Sortierung nach Handlungsbedarf (kleiner = dringender). */
export const TONE_RANK: Record<StatusTone, number> = {
  fehler: 0,
  warnung: 1,
  laeuft: 2,
  erfolg: 3,
  neutral: 4,
};

export type JobStatus = "queued" | "running" | "success" | "failed";

/* ---------- Beschriftungen (Oberfläche deutsch, plattformneutral) ---------- */

export const PROBLEM_KIND_LABEL: Record<ProblemKind, string> = {
  config_error: "Konfigurationsfehler",
  job_failed: "Lauf fehlgeschlagen",
  lockfile_failure: "Lockfile-Fehler",
  ci_red: "CI rot",
  missing_build_check: "Build-Check fehlt",
  stale_pr: "PR hängt",
};

/** Reihenfolge der Gruppen auf der Probleme-Seite (ansichten-entwurf.md). */
export const PROBLEM_KIND_ORDER: readonly ProblemKind[] = [
  "config_error",
  "job_failed",
  "lockfile_failure",
  "ci_red",
  "missing_build_check",
  "stale_pr",
];

export const PROBLEM_KIND_TONE: Record<ProblemKind, StatusTone> = {
  config_error: "fehler",
  job_failed: "fehler",
  lockfile_failure: "fehler",
  ci_red: "fehler",
  missing_build_check: "warnung",
  stale_pr: "warnung",
};

export const UPDATE_TYPE_LABEL: Record<UpdateType, string> = {
  security: "Sicherheit",
  major: "Major",
  minor: "Minor",
  patch: "Patch",
  digest: "Digest",
  lockfile: "Lockfile",
  other: "Sonstiges",
};

export const UPDATE_TYPE_TONE: Record<UpdateType, StatusTone> = {
  security: "fehler",
  major: "warnung",
  minor: "neutral",
  patch: "neutral",
  digest: "neutral",
  lockfile: "neutral",
  other: "neutral",
};

export const CI_STATUS_LABEL: Record<CiStatus, string> = {
  success: "CI grün",
  failure: "CI rot",
  pending: "CI läuft",
  none: "Keine CI",
};

export const CI_STATUS_TONE: Record<CiStatus, StatusTone> = {
  success: "erfolg",
  failure: "fehler",
  pending: "laeuft",
  none: "neutral",
};

export const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  queued: "Wartet",
  running: "Läuft",
  success: "Erfolgreich",
  failed: "Fehlgeschlagen",
};

export const JOB_STATUS_TONE: Record<JobStatus, StatusTone> = {
  queued: "laeuft",
  running: "laeuft",
  success: "erfolg",
  failed: "fehler",
};

export const JOB_TRIGGER_LABEL: Record<"schedule" | "webhook" | "manual", string> = {
  schedule: "Zeitplan",
  webhook: "Webhook",
  manual: "Manuell",
};

export const ONBOARDING_LABEL: Record<OnboardingStatus, string> = {
  onboarded: "Onboardet",
  pr_open: "Onboarding-PR offen",
  none: "Nicht onboardet",
  disabled: "Deaktiviert",
};

export const ONBOARDING_TONE: Record<OnboardingStatus, StatusTone> = {
  onboarded: "erfolg",
  pr_open: "laeuft",
  none: "warnung",
  disabled: "neutral",
};

export const BUILD_CHECK_LABEL: Record<BuildCheckStatus, string> = {
  active: "Aktiv",
  pr_open: "PR offen",
  own_ci: "Eigene CI",
  missing: "Fehlt",
};

export const BUILD_CHECK_TONE: Record<BuildCheckStatus, StatusTone> = {
  active: "erfolg",
  pr_open: "laeuft",
  own_ci: "erfolg",
  missing: "warnung",
};

/* ---------- Zustand eines Repos ---------- */

export type RepoHealthInput = {
  archived: boolean;
  removed: boolean;
  onboarding: OnboardingStatus;
  /** Arten der offenen Probleme dieses Repos. */
  openProblemKinds: readonly ProblemKind[];
  openSecurityPrs: number;
  openMajorPrs: number;
  /** Ein Job dieses Repos wartet oder läuft gerade. */
  jobActive: boolean;
};

export type RepoHealth = { tone: StatusTone; label: string };

/**
 * Dringendster Zustand eines Repos, in der Reihenfolge des Lagebericht: Sicherheitsupdates, dann
 * Fehler (Probleme der Art Konfiguration, Lauf, Lockfile, CI), dann hängende PRs, Onboarding,
 * fehlender Build-Check, Major-Updates; danach "Läuft" und "Aktuell".
 */
export function deriveRepoHealth(input: RepoHealthInput): RepoHealth {
  if (input.removed) return { tone: "neutral", label: "Entfernt" };
  if (input.archived) return { tone: "neutral", label: "Archiviert" };

  if (input.openSecurityPrs > 0) {
    return {
      tone: "fehler",
      label: input.openSecurityPrs === 1 ? "Sicherheitsupdate offen" : `${input.openSecurityPrs} Sicherheitsupdates`,
    };
  }
  const kinds = new Set(input.openProblemKinds);
  for (const kind of PROBLEM_KIND_ORDER) {
    if (PROBLEM_KIND_TONE[kind] === "fehler" && kinds.has(kind)) {
      return { tone: "fehler", label: PROBLEM_KIND_LABEL[kind] };
    }
  }
  if (kinds.has("stale_pr")) return { tone: "warnung", label: PROBLEM_KIND_LABEL.stale_pr };
  if (input.onboarding === "none") return { tone: "warnung", label: ONBOARDING_LABEL.none };
  if (kinds.has("missing_build_check")) return { tone: "warnung", label: PROBLEM_KIND_LABEL.missing_build_check };
  if (input.openMajorPrs > 0) return { tone: "warnung", label: "Major zur Freigabe" };
  if (input.jobActive) return { tone: "laeuft", label: "Läuft" };
  if (input.onboarding === "pr_open") return { tone: "laeuft", label: ONBOARDING_LABEL.pr_open };
  if (input.onboarding === "disabled") return { tone: "neutral", label: ONBOARDING_LABEL.disabled };
  return { tone: "erfolg", label: "Aktuell" };
}
