import { repoDetailHref } from "@/lib/repo-detail-href";
import type { ProblemKind } from "./problems";

export type ProblemEvidence = { label: string; href: string; external: boolean };

export type ProblemEvidenceInput = {
  kind: ProblemKind;
  dedupeKey: string;
  repoFullName: string;
  /** URL des PR zu `dedupeKey` (Join auf pull_requests); null, wenn es ihn nicht (mehr) gibt. */
  prUrl?: string | null;
};

function jobsHref(fullName: string, failedOnly: boolean): string {
  const qs = new URLSearchParams({ repo: fullName });
  if (failedOnly) qs.set("status", "failed");
  return `/jobs?${qs.toString()}`;
}

/**
 * Genau ein Beleg je Problem (ansichten-entwurf.md, Abschnitt "Probleme"):
 * - PR-Probleme (hängend, CI rot) mit PR-Nummer: Link zum PR; fehlt der PR, das Repo-Detail.
 * - Konfigurations- und Lauffehler: fehlgeschlagene Läufe des Repos (Log-Auszug).
 * - Lockfile-Fehler: Läufe des Repos (der Lauf selbst kann erfolgreich sein).
 * - fehlender Build-Check: Repo-Detail.
 */
export function problemEvidence(p: ProblemEvidenceInput): ProblemEvidence {
  const detail: ProblemEvidence = { label: "Repo-Details", href: repoDetailHref(p.repoFullName), external: false };
  switch (p.kind) {
    case "stale_pr":
    case "ci_red": {
      const number = /^\d+$/.test(p.dedupeKey) ? p.dedupeKey : null;
      if (number && p.prUrl) return { label: `PR #${number} öffnen`, href: p.prUrl, external: true };
      return detail;
    }
    case "job_failed":
    case "config_error":
      return { label: "Log ansehen", href: jobsHref(p.repoFullName, true), external: false };
    case "lockfile_failure":
      return { label: "Läufe ansehen", href: jobsHref(p.repoFullName, false), external: false };
    case "missing_build_check":
      return detail;
  }
}
