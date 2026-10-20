import type { Db } from "@/db/client";
import { syncState } from "@/db/schema";

export type SyncSourceState = {
  source: "github" | "ce";
  label: string;
  lastSuccessAt: Date | null;
  /** Nur gesetzt, wenn der letzte Fehler jünger ist als der letzte Erfolg. */
  lastError: { at: Date; message: string } | null;
  partialErrorCount: number;
  pausedUntil: Date | null;
  /** Abgleich-Intervall; ab dem Dreifachen ohne Erfolg gelten die Daten als veraltet. */
  intervalMs: number;
};

const SOURCES = [
  { source: "github", label: "GitHub", intervalMs: 5 * 60_000 },
  { source: "ce", label: "Renovate", intervalMs: 60_000 },
] as const;

/** Abgleich-Stempel je Quelle aus sync_state; fehlende Zeilen = noch kein Abgleich. */
export async function loadSyncStamp(db: Db): Promise<SyncSourceState[]> {
  const rows = await db.select().from(syncState);
  return SOURCES.map(({ source, label, intervalMs }) => {
    const row = rows.find((r) => r.source === source);
    const lastSuccessAt = row?.lastSuccessAt ?? null;
    const errorIsCurrent =
      row?.lastErrorAt != null && (lastSuccessAt === null || row.lastErrorAt > lastSuccessAt);
    return {
      source,
      label,
      intervalMs,
      lastSuccessAt,
      lastError: errorIsCurrent
        ? { at: row!.lastErrorAt!, message: row!.lastErrorMessage ?? "Unbekannter Fehler" }
        : null,
      partialErrorCount: row?.partialErrors.length ?? 0,
      pausedUntil: row?.pausedUntil ?? null,
    };
  });
}
