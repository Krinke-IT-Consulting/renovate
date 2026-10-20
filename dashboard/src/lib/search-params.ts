/**
 * Filter, Suche und Sortierung stehen in der Adresse (Spec dashboard-views), damit Links aus dem
 * Lagebericht die gefilterte Ansicht öffnen. Mehrfachwerte werden kommagetrennt geschrieben:
 * `?typ=major,security&ci=failure`. Unbekannte Werte werden still verworfen.
 */

export type RawSearchParams = Record<string, string | string[] | undefined>;

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** Steuerzeichen (C0 und DEL) haben in einem Suchtext nichts verloren. */
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

/** Freitext ohne Steuerzeichen, gekürzt auf 100 Zeichen; leer = undefined. */
export function parseText(sp: RawSearchParams, key: string): string | undefined {
  const v = first(sp[key])?.replace(CONTROL_CHARS, "").trim().slice(0, 100);
  return v ? v : undefined;
}

/** Liste erlaubter Werte, Reihenfolge der Erlaubnisliste, ohne Duplikate. */
export function parseList<T extends string>(sp: RawSearchParams, key: string, allowed: readonly T[]): T[] {
  const raw = first(sp[key]);
  if (!raw) return [];
  const given = new Set(raw.split(",").map((s) => s.trim()));
  return allowed.filter((a) => given.has(a));
}

/** Ein einzelner erlaubter Wert, sonst der Vorgabewert. */
export function parseOne<T extends string>(sp: RawSearchParams, key: string, allowed: readonly T[], fallback: T): T {
  const raw = first(sp[key]);
  return raw && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
}

/** Schalter: "1" oder "ja" gilt als gesetzt. */
export function parseFlag(sp: RawSearchParams, key: string): boolean {
  const raw = first(sp[key]);
  return raw === "1" || raw === "ja";
}

/** Positive Seitenzahl ab 1. */
export function parsePage(sp: RawSearchParams, key = "seite"): number {
  const n = Number.parseInt(first(sp[key]) ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export type Sort<K extends string> = { key: K; dir: "asc" | "desc" };

/** `?sort=alter&dir=asc`; ohne gültigen Schlüssel null (= Standardsortierung der Ansicht). */
export function parseSort<K extends string>(sp: RawSearchParams, allowed: readonly K[]): Sort<K> | null {
  const key = first(sp.sort);
  if (!key || !(allowed as readonly string[]).includes(key)) return null;
  return { key: key as K, dir: first(sp.dir) === "asc" ? "asc" : "desc" };
}

/** Normalisiert die Parameter zu URLSearchParams (nur Strings, Mehrfachwerte zusammengeführt). */
export function toUrlSearchParams(sp: RawSearchParams): URLSearchParams {
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    const value = Array.isArray(v) ? v.join(",") : v;
    if (value) out.set(k, value);
  }
  return out;
}

/**
 * Adresse mit geänderten Parametern. `undefined`, leere Strings und leere Listen entfernen den
 * Parameter. Jede Filteränderung setzt die Seite zurück.
 */
export function withParams(
  pathname: string,
  current: RawSearchParams | URLSearchParams,
  changes: Record<string, string | readonly string[] | undefined>,
): string {
  const next = current instanceof URLSearchParams ? new URLSearchParams(current) : toUrlSearchParams(current);
  for (const [k, v] of Object.entries(changes)) {
    const value = Array.isArray(v) ? v.join(",") : (v as string | undefined);
    if (value) next.set(k, value);
    else next.delete(k);
  }
  if (!("seite" in changes)) next.delete("seite");
  const qs = next.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

/** Wert in einer Liste umschalten (für Filter-Chips). */
export function toggle<T extends string>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}
