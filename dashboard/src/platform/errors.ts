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

/**
 * Die Plattform lehnt die Anfrage aus einem erkennbaren Grund ab, der kein Rechtefehler ist (etwa
 * leeres Repo, Repo nicht in der Installation, Branch-Regel, Vorlagen-Repo nicht lesbar).
 * `userMessage` ist deutsch, für den Betreiber formuliert und enthält keine Werte aus der Antwort.
 */
export class PlatformRejectedError extends Error {
  readonly userMessage: string;

  constructor(userMessage: string) {
    super(userMessage);
    this.name = "PlatformRejectedError";
    this.userMessage = userMessage;
  }
}

/**
 * `createChangeRequest` hat die Dateien live im Repo geprüft und legt nichts an: Mindestens eine
 * Datei existiert mit anderem Inhalt (`differing`), oder alle sind schon mit dem Inhalt der
 * Vorlage da (`differing` leer). `identical` nennt die Dateien mit gleichem Inhalt.
 */
export class PlatformFilesExistError extends Error {
  readonly identical: string[];
  readonly differing: string[];

  constructor(identical: string[], differing: string[]) {
    super(
      `Dateien im Repo vorhanden (${identical.length} gleich, ${differing.length} abweichend).`,
    );
    this.name = "PlatformFilesExistError";
    this.identical = identical;
    this.differing = differing;
  }
}

/**
 * Der Vorgang ist gescheitert (`original`), und der Branch konnte danach nicht aufgeräumt werden
 * oder durfte es nicht (Zustand unklar): `branch` bleibt im Repo zurück. Der nächste Versuch ersetzt
 * ihn. Enthält nur den Branchnamen, keine Werte der Plattform.
 */
export class PlatformLeftoverBranchError extends Error {
  readonly branch: string;
  readonly original: unknown;

  constructor(branch: string, original: unknown) {
    super(`Rest-Branch ${branch} blieb im Repo zurück.`);
    this.name = "PlatformLeftoverBranchError";
    this.branch = branch;
    this.original = original;
  }
}
