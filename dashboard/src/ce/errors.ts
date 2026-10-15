/** Fehler der CE-API. Enthält Statuscode und Pfad, nie Secret, Header oder Antwortinhalt. */
export class CeApiError extends Error {
  readonly status: number | null;
  readonly path: string;

  constructor(message: string, path: string, status: number | null = null) {
    super(message);
    this.name = "CeApiError";
    this.path = path;
    this.status = status;
  }
}
