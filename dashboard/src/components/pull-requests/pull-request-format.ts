import { STALE_PR_DAYS, STALE_SECURITY_PR_DAYS, type UpdateType } from "@/domain";

/**
 * Zielversion aus dem Titel eines Renovate-PRs: "update dependency next to v16" -> "v16".
 * Ohne erkennbare Version (Gruppen, Lockfile-Maintenance) null; es wird nichts geraten.
 */
export function parseTargetVersion(title: string): string | null {
  const m = /\bto\s+(v?\d[^\s\]),;]*)/i.exec(title);
  if (!m) return null;
  const v = m[1]!.replace(/[.:]+$/, "");
  return v || null;
}

/** "→ v16", sonst null. */
export function versionJump(title: string): string | null {
  const v = parseTargetVersion(title);
  return v ? `→ ${v}` : null;
}

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
