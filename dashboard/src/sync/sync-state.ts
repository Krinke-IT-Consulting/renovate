import type { Db } from "@/db/client";
import { syncState } from "@/db/schema";
import { CeApiError } from "@/ce/errors";
import { PlatformApiError, RateLimitPause } from "@/platform/errors";

export type SyncSource = "github" | "ce";
export type PartialError = { repository: string; message: string };

/**
 * Kurze Kategorie eines Fehlers für sync_state. Nie Rohmeldung, Header oder Werte: nur Art und
 * gegebenenfalls Statuscode.
 */
export function errorCategory(e: unknown): string {
  if (e instanceof RateLimitPause) return "Kontingent knapp";
  if (e instanceof PlatformApiError) {
    return e.status === 0 ? "Plattform nicht erreichbar" : `Plattform-Fehler (Status ${e.status})`;
  }
  if (e instanceof CeApiError) {
    return e.status === null ? "CE nicht erreichbar" : `CE-Fehler (Status ${e.status})`;
  }
  // Drizzle verpackt Fehler von pg (DrizzleQueryError, Ursache in `cause`); der SQLSTATE steht dort.
  const code = [e, (e as { cause?: unknown } | null)?.cause]
    .map((c) => (c as { code?: unknown } | null)?.code)
    .find((c): c is string => typeof c === "string");
  if (e instanceof Error && code !== undefined) {
    return code === "23505" ? "Datenbankfehler (Eindeutigkeitskonflikt)" : "Datenbankfehler";
  }
  return "Unerwarteter Fehler";
}

export type RunOutcome = {
  partialErrors: PartialError[];
  /** Gesetzt, wenn der Durchlauf wegen RateLimitPause früh endete. */
  pause?: { until: Date | null; note: string };
};

/**
 * Durchlauf beendet (auch mit Teilfehlern oder Pause): Teilfehler ersetzen die des letzten
 * Durchlaufs. Ohne Pause zählt er als Erfolg und löscht den Pausenvermerk; bei Pause bleibt der
 * letzte Erfolg unverändert.
 */
export async function recordRun(db: Db, source: SyncSource, outcome: RunOutcome, now = new Date()) {
  const { partialErrors, pause } = outcome;
  const values = {
    partialErrors,
    pausedAt: pause ? now : null,
    pausedUntil: pause?.until ?? null,
    pauseNote: pause?.note ?? null,
  };
  await db
    .insert(syncState)
    .values({ source, lastSuccessAt: pause ? null : now, ...values })
    .onConflictDoUpdate({
      target: syncState.source,
      set: pause ? values : { ...values, lastSuccessAt: now },
    });
}

/** Der Durchlauf selbst ist gescheitert (nicht nur einzelne Repos). */
export async function recordFailure(db: Db, source: SyncSource, error: unknown, now = new Date()) {
  const message = errorCategory(error);
  await db
    .insert(syncState)
    .values({ source, lastErrorAt: now, lastErrorMessage: message })
    .onConflictDoUpdate({
      target: syncState.source,
      set: { lastErrorAt: now, lastErrorMessage: message },
    });
}

export function pauseOutcome(e: RateLimitPause): NonNullable<RunOutcome["pause"]> {
  return {
    until: e.resetAt,
    note: `Kontingent knapp (${e.remaining} von ${e.limit} übrig)`,
  };
}
