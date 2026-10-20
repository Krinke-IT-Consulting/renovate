/**
 * Zielversion aus dem Titel eines Renovate-PRs: "update dependency next to v16" -> "v16".
 * Ohne erkennbare Version (Gruppen, Lockfile-Maintenance) null; es wird nichts geraten.
 * Ein Schlusspunkt (Satzende) gehört nicht zur Version.
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
