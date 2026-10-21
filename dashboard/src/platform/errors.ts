/** Fehlerklassen der Plattform-Schicht. Nie Header, Tokens oder Schlüssel in Meldungen. */

/** Ein Plattform-Aufruf ist fehlgeschlagen. Status 0 = kein HTTP-Ergebnis (Netz, Anmeldung). */
export class PlatformApiError extends Error {
  readonly status: number;
  readonly method: string;
  readonly path: string;

  constructor(status: number, method: string, path: string) {
    super(
      `Plattform-Anfrage fehlgeschlagen: ${method} ${path} (Status ${status})`,
    );
    this.name = "PlatformApiError";
    this.status = status;
    this.method = method;
    this.path = path;
  }
}

/**
 * Das Rest-Kontingent ist unter die Schwelle gefallen. Der Abgleich pausiert bis `resetAt`
 * und vermerkt das im Stempel (sync_state).
 */
export class RateLimitPause extends Error {
  readonly remaining: number;
  readonly limit: number;
  readonly resetAt: Date | null;

  constructor(remaining: number, limit: number, resetAt: Date | null) {
    super(
      `Plattform-Kontingent knapp (${remaining} von ${limit} übrig). Abgleich pausiert` +
        (resetAt ? ` bis ${resetAt.toISOString()}.` : "."),
    );
    this.name = "RateLimitPause";
    this.remaining = remaining;
    this.limit = limit;
    this.resetAt = resetAt;
  }
}

/**
 * Dem Zugang fehlen Rechte zum Schreiben (etwa auf Workflow-Dateien). `userMessage` ist deutsch,
 * für den Betreiber formuliert und enthält keine Werte aus der Antwort der Plattform.
 */
export class PlatformPermissionError extends Error {
  readonly userMessage: string;

  constructor(userMessage: string) {
    super(userMessage);
    this.name = "PlatformPermissionError";
    this.userMessage = userMessage;
  }
}
