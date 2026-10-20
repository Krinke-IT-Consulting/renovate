/** Anzeigeformate der Oberfläche: deutsch, Zeitzone Europe/Berlin (der Server läuft in UTC). */

const TZ = "Europe/Berlin";

const timeFmt = new Intl.DateTimeFormat("de-DE", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
const dateTimeFmt = new Intl.DateTimeFormat("de-DE", {
  timeZone: TZ,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const dayFmt = new Intl.DateTimeFormat("de-DE", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" });

/** "14:05" */
export function formatTime(d: Date): string {
  return timeFmt.format(d);
}

/** "20.10.2026, 14:05" */
export function formatDateTime(d: Date): string {
  return dateTimeFmt.format(d);
}

/** "20.10.2026" */
export function formatDate(d: Date): string {
  return dayFmt.format(d);
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Relative Zeit in der Vergangenheit: "gerade eben", "vor 5 Min.", "vor 3 Std.", "vor 12 Tagen". */
export function formatRelative(d: Date, now: Date = new Date()): string {
  const diff = now.getTime() - d.getTime();
  if (diff < MIN) return "gerade eben";
  if (diff < HOUR) return `vor ${Math.floor(diff / MIN)} Min.`;
  if (diff < DAY) return `vor ${Math.floor(diff / HOUR)} Std.`;
  const days = Math.floor(diff / DAY);
  return days === 1 ? "vor 1 Tag" : `vor ${days} Tagen`;
}

/** Alter in ganzen Tagen (abgerundet). */
export function ageInDays(d: Date, now: Date = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - d.getTime()) / DAY));
}

/** Dauer: "42 s", "3 Min. 05 s", "1 Std. 02 Min."; ohne Wert ein Gedankenstrich. */
export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "–";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} Min. ${String(s % 60).padStart(2, "0")} s`;
  return `${Math.floor(m / 60)} Std. ${String(m % 60).padStart(2, "0")} Min.`;
}

/** "1 offener PR" / "3 offene PRs": Zahl mit Einzahl- oder Mehrzahlform. */
export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}
