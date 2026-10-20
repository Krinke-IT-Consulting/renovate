import { TONE_RANK, type RepoHealth } from "@/domain/status-tone";
import type { OnboardingStatus } from "@/domain/repo-status";
import { plural } from "./format";

/** Teil eines Repo-Listeneintrags, den Sortierung und Zusammenfassung brauchen. */
export type RepoListItem = { fullName: string; health: RepoHealth; onboarding: OnboardingStatus };

/** Standardsortierung der Repo-Liste: nach Handlungsbedarf (Fehler, Warnung, ...), danach nach Name. */
export function sortByAttention<T extends RepoListItem>(rows: readonly T[]): T[] {
  return [...rows].sort(
    (a, b) =>
      TONE_RANK[a.health.tone] - TONE_RANK[b.health.tone] ||
      a.fullName.localeCompare(b.fullName, "de", { sensitivity: "base" }),
  );
}

/** Repos, die eine Entscheidung brauchen: Fehler oder Warnung. */
export function needsDecision(row: RepoListItem): boolean {
  return row.health.tone === "fehler" || row.health.tone === "warnung";
}

/** "12 Repos, 9 onboardet, 4 brauchen eine Entscheidung" (Seitenkopf der Repo-Liste). */
export function summarizeRepos(rows: readonly RepoListItem[], filtered = false): string {
  if (rows.length === 0) return filtered ? "Keine Treffer für diese Filter." : "Noch keine Repos.";
  const onboarded = rows.filter((r) => r.onboarding === "onboarded").length;
  const decide = rows.filter(needsDecision).length;
  const decideText =
    decide === 0
      ? "keines braucht eine Entscheidung"
      : decide === 1
        ? "1 braucht eine Entscheidung"
        : `${decide} brauchen eine Entscheidung`;
  return `${plural(rows.length, "Repo", "Repos")}${filtered ? " (gefiltert)" : ""}, ${onboarded} onboardet, ${decideText}`;
}
