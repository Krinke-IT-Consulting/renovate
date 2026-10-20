/**
 * Adresse für einen externen Link, sonst null. Nur `https:` ist erlaubt; Werte aus der Datenbank
 * (PR-Adressen, Dependency Dashboard) stammen von der Plattform und werden nicht blind verlinkt
 * (`javascript:`, `data:`, `http:` usw. ergeben keinen Link).
 */
export function safeExternalHref(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}
