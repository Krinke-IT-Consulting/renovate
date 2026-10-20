import { ageInDays } from "@/lib/format";
import { STALE_PR_DAYS, STALE_SECURITY_PR_DAYS, type UpdateType } from "@/domain";

export { parseTargetVersion, versionJump } from "@/domain/version-jump";

/** Hängend: ab 14 Tagen, bei Sicherheitsupdates ab 7 Tagen (domain/problems.ts). */
export function isStale(updateType: UpdateType, ageDays: number): boolean {
  return ageDays >= (updateType === "security" ? STALE_SECURITY_PR_DAYS : STALE_PR_DAYS);
}

/** Alter in Tagen als Text; tagesgenau, damit Server und Browser denselben Text erzeugen. */
export function ageLabel(days: number): string {
  if (days <= 0) return "heute";
  return days === 1 ? "vor 1 Tag" : `vor ${days} Tagen`;
}

/** Sortierrang des Update-Typs (Sicherheit zuerst). */
export const UPDATE_TYPE_RANK: Record<UpdateType, number> = {
  security: 0,
  major: 1,
  minor: 2,
  patch: 3,
  digest: 4,
  lockfile: 5,
  other: 6,
};

/** Spalten der PR-Liste, nach denen sortiert werden kann (IDs wie in `pull-request-table.tsx`). */
export const PR_SORT_KEYS = ["repo", "typ", "alter"] as const;
export type PrSortKey = (typeof PR_SORT_KEYS)[number];

type SortablePr = { repoFullName: string; updateType: UpdateType; createdAt: Date };

/**
 * Aufsteigende Vergleiche je Sortierschlüssel; absteigend (Vorgabe in der Adresse) heißt
 * "älteste bzw. dringendste zuerst". Tabelle (clientseitig) und Seite (vor dem Schneiden in
 * Seiten) benutzen dieselben Funktionen.
 */
export const PR_COMPARE: Record<PrSortKey, (a: SortablePr, b: SortablePr, now: Date) => number> = {
  repo: (a, b) => a.repoFullName.toLowerCase().localeCompare(b.repoFullName.toLowerCase(), "de", { numeric: true }),
  // Aufsteigend steht der höchste Rang (am wenigsten dringend) vorn; absteigend Sicherheit zuerst.
  typ: (a, b) => UPDATE_TYPE_RANK[b.updateType] - UPDATE_TYPE_RANK[a.updateType],
  alter: (a, b, now) => ageInDays(a.createdAt, now) - ageInDays(b.createdAt, now),
};

/** Sortiert eine Kopie; bei Gleichstand bleibt die bisherige Reihenfolge (stabile Sortierung). */
export function sortPullRequests<T extends SortablePr>(
  rows: readonly T[],
  sort: { key: PrSortKey; dir: "asc" | "desc" },
  now: Date,
): T[] {
  const sign = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => sign * PR_COMPARE[sort.key](a, b, now));
}
