import { headers } from "next/headers";
import { ActionError } from "./result";

/** Header, den proxy.ts aus der Antwort von Authelia setzt (nie aus der Anfrage übernimmt). */
const USER_HEADER = "x-dashboard-user";

/**
 * Nutzer der laufenden Anfrage. Ohne Nutzer wird die Aktion abgelehnt: Es gibt kein anonymes
 * Auslösen und keinen AuditLog-Eintrag ohne Namen. Gekürzt wie in layout.tsx.
 */
export async function requireActor(): Promise<string> {
  const actor = (await headers()).get(USER_HEADER)?.trim().slice(0, 64);
  if (!actor) throw new ActionError("Die Aktion braucht einen angemeldeten Nutzer.");
  return actor;
}
