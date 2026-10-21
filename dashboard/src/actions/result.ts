/**
 * Ergebnis einer Aktion der Oberfläche (Spec dashboard-actions, "Bestätigung, Protokoll und
 * Rückmeldung"). Bewusst keine "use server"-Datei: Sie enthält Typen, eine Fehlerklasse und
 * Hilfen, die Server Actions und Client-Komponenten gemeinsam nutzen.
 *
 * Meldungen sind deutsch und nennen nie Werte aus Tokens, Headern oder Rohantworten.
 */

export type ActionLink = {
  href: string;
  label: string;
  /** Extern: neuer Tab, nur https (safeExternalHref). Intern: Link innerhalb des Dashboards. */
  external: boolean;
};

export type ActionState =
  | { status: "idle" }
  | {
      status: "done";
      /** erfolg: ausgeführt; neutral: nichts zu tun; warnung: teilweise ausgeführt. */
      tone: "erfolg" | "neutral" | "warnung";
      message: string;
      link?: ActionLink;
    }
  | { status: "error"; message: string };

export const IDLE: ActionState = { status: "idle" };

/** Fehler mit einer Meldung, die dem Betreiber so angezeigt werden darf. */
export class ActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ActionError";
  }
}

export const FALLBACK_ERROR = "Die Aktion ist fehlgeschlagen. Bitte versuchen Sie es erneut.";

export function done(
  tone: "erfolg" | "neutral" | "warnung",
  message: string,
  link?: ActionLink,
): ActionState {
  return link ? { status: "done", tone, message, link } : { status: "done", tone, message };
}

export function failed(message: string): ActionState {
  return { status: "error", message };
}

/**
 * Führt die Aktion aus und macht aus jedem Fehler eine Meldung. Nur ActionError-Texte erreichen
 * die Oberfläche; bei allem anderen steht die feste Rückfallmeldung da, im Log nur der Fehlername.
 */
export async function runAction(fn: () => Promise<ActionState>): Promise<ActionState> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ActionError) return failed(e.message);
    console.error(`Aktion fehlgeschlagen: ${e instanceof Error ? e.name : "unbekannt"}`);
    return failed(FALLBACK_ERROR);
  }
}
