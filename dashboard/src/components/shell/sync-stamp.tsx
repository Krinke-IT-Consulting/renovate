import { StatusIcon } from "@/components/status/status";
import type { StatusTone } from "@/domain/status-tone";
import { formatDateTime, formatTime } from "@/lib/format";
import type { SyncSourceState } from "@/queries/sync";

export type { SyncSourceState };

type Entry = { tone: StatusTone; text: string; detail?: string };

function describe(s: SyncSourceState, now: Date): Entry {
  if (s.lastError) {
    const since = s.lastSuccessAt ? `, Daten von ${formatTime(s.lastSuccessAt)}` : "";
    return {
      tone: "fehler",
      text: `${s.label}: Fehler ${formatTime(s.lastError.at)}`,
      detail: `${s.label}: ${s.lastError.message} (${formatDateTime(s.lastError.at)})${since}`,
    };
  }
  if (!s.lastSuccessAt) return { tone: "neutral", text: `${s.label}: noch kein Abgleich` };
  if (s.pausedUntil && s.pausedUntil > now) {
    return {
      tone: "warnung",
      text: `${s.label} ${formatTime(s.lastSuccessAt)}, pausiert`,
      detail: `${s.label}: Kontingent knapp, Abgleich pausiert bis ${formatTime(s.pausedUntil)}`,
    };
  }
  const stale = now.getTime() - s.lastSuccessAt.getTime() > 3 * s.intervalMs;
  if (stale) {
    return {
      tone: "warnung",
      text: `${s.label} ${formatTime(s.lastSuccessAt)}, veraltet`,
      detail: `${s.label}: letzter Abgleich ${formatDateTime(s.lastSuccessAt)}`,
    };
  }
  if (s.partialErrorCount > 0) {
    return {
      tone: "warnung",
      text: `${s.label} ${formatTime(s.lastSuccessAt)}`,
      detail: `${s.label}: ${s.partialErrorCount} Repo(s) mit Teilfehler im letzten Abgleich`,
    };
  }
  return { tone: "erfolg", text: `${s.label} ${formatTime(s.lastSuccessAt)}` };
}

/**
 * Abgleich-Stempel: je Quelle, wann zuletzt abgeglichen wurde, mit Fehler und Uhrzeit. Die letzten
 * Daten bleiben bei einem Fehler sichtbar; der Stempel sagt, von wann sie stammen.
 * `sources === null`: Datenbank nicht erreichbar.
 */
export function SyncStamp({ sources, now = new Date() }: { sources: SyncSourceState[] | null; now?: Date }) {
  if (sources === null) {
    return (
      <p className="flex items-center gap-1.5 text-xs font-medium text-status-fehler">
        <StatusIcon tone="fehler" className="size-3.5" />
        Datenbank nicht erreichbar
      </p>
    );
  }
  const entries = sources.map((s) => describe(s, now));
  const details = entries.map((e) => e.detail).filter(Boolean);
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-ink-soft" title={details.join("\n") || undefined}>
      <span className="font-medium text-ink">Abgleich</span>
      {entries.map((e, i) => (
        <span
          key={i}
          className={
            e.tone === "fehler"
              ? "inline-flex items-center gap-1 font-medium text-status-fehler"
              : e.tone === "warnung"
                ? "inline-flex items-center gap-1 font-medium text-status-warnung"
                : "inline-flex items-center gap-1 tabular-nums"
          }
        >
          <StatusIcon tone={e.tone} className="size-3.5" />
          {e.text}
        </span>
      ))}
      {details.length > 0 ? <span className="sr-only">{details.join(". ")}</span> : null}
    </p>
  );
}
