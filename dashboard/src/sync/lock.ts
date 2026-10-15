import type { Pool } from "pg";

/** Schlüssel der Advisory-Locks je Quelle. Beliebige feste Zahlen; nur dieser Code nutzt sie. */
export const SYNC_LOCK_KEYS = {
  github: 7_260_011_101,
  ce: 7_260_011_102,
  /** Problembewertung: GitHub- und CE-Abgleich führen sie nie parallel aus. */
  problems: 7_260_011_103,
} as const;

export type LockResult<T> = { ran: true; value: T } | { ran: false };

/**
 * Führt `fn` nur aus, wenn der Advisory-Lock `key` frei ist (`pg_try_advisory_lock`). Ist er belegt,
 * auch von einer anderen Instanz, kehrt die Funktion sofort mit `{ ran: false }` zurück.
 * Der Lock hängt an einer dedizierten Verbindung aus dem Pool, die für die Dauer von `fn` reserviert
 * bleibt. Schlägt das Freigeben fehl oder meldet die Verbindung einen Fehler (etwa DB-Neustart),
 * wird sie verworfen; damit endet auch der Lock. Der Fehler selbst beendet den Prozess nicht.
 */
export async function withAdvisoryLock<T>(
  pool: Pool,
  key: number,
  fn: () => Promise<T>,
): Promise<LockResult<T>> {
  const client = await pool.connect();
  let destroy = false;
  // Ohne Handler beendet ein Fehler auf der reservierten Verbindung den Prozess.
  const onError = () => {
    destroy = true;
    console.error("Datenbank: Verbindung der Abgleich-Sperre verloren.");
  };
  client.on("error", onError);
  try {
    let locked: boolean | undefined;
    try {
      const res = await client.query<{ locked: boolean }>(
        "select pg_try_advisory_lock($1) as locked",
        [key],
      );
      locked = res.rows[0]?.locked;
    } catch (e) {
      destroy = true;
      throw e;
    }
    if (!locked) return { ran: false };
    try {
      return { ran: true, value: await fn() };
    } finally {
      try {
        await client.query("select pg_advisory_unlock($1)", [key]);
      } catch {
        destroy = true;
      }
    }
  } finally {
    // Eine verworfene Verbindung behält den Handler: Sie kann beim Schließen noch Fehler melden.
    if (!destroy) client.removeListener("error", onError);
    client.release(destroy);
  }
}
