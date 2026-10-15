/**
 * Log-Auszug für fehlgeschlagene Jobs (design.md, Entscheidung 7): nur Bunyan-Level >= 40,
 * je Zeile nur time/level/msg und err.message/err.name. Felder mit token, password, secret oder
 * key im Namen werden rekursiv entfernt. Die letzten Zeilen bleiben erhalten.
 */
export const LOG_MIN_LEVEL = 40;
export const LOG_MAX_LINES = 200;
export const LOG_MAX_BYTES = 16 * 1024;

const SENSITIVE = /token|password|secret|key/i;
const LEVEL_NAMES: Record<number, string> = { 40: "WARN", 50: "ERROR", 60: "FATAL" };

function levelName(level: number): string {
  return LEVEL_NAMES[level] ?? (level >= 60 ? "FATAL" : level >= 50 ? "ERROR" : "WARN");
}

/** Entfernt sensible Felder rekursiv (Objekte und Arrays). */
export function stripSensitive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripSensitive);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE.test(k)) continue;
      out[k] = stripSensitive(v);
    }
    return out;
  }
  return value;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function formatTime(time: unknown): string {
  const t = typeof time === "string" || typeof time === "number" ? new Date(time) : null;
  if (!t || Number.isNaN(t.getTime())) return "--:--:--";
  return t.toISOString().slice(11, 19);
}

export function extractLogExcerpt(text: string): string {
  const lines: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line.startsWith("{")) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
    const entry = stripSensitive(parsed) as Record<string, unknown>;
    const level = entry.level;
    if (typeof level !== "number" || level < LOG_MIN_LEVEL) continue;

    const err =
      entry.err && typeof entry.err === "object" ? (entry.err as Record<string, unknown>) : {};
    const parts = [formatTime(entry.time), levelName(level)];
    const msg = str(entry.msg);
    if (msg) parts.push(msg);
    const errName = str(err.name);
    const errMessage = str(err.message);
    if (errName || errMessage) parts.push(`(${[errName, errMessage].filter(Boolean).join(": ")})`);
    lines.push(parts.join(" ").replace(/\s*\n\s*/g, " "));
  }

  let kept = lines.slice(-LOG_MAX_LINES);
  // Von hinten auffüllen, bis 16 KB erreicht sind (die letzten Zeilen bleiben).
  const enc = new TextEncoder();
  let total = 0;
  let start = kept.length;
  for (let i = kept.length - 1; i >= 0; i--) {
    const size = enc.encode(kept[i]!).length + 1;
    if (total + size > LOG_MAX_BYTES) break;
    total += size;
    start = i;
  }
  kept = kept.slice(start);
  return kept.join("\n");
}
