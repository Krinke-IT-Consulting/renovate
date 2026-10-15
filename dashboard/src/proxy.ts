import { NextResponse, type NextRequest } from "next/server";
import { getEnvFor } from "@/env";
import {
  STRIPPED_HEADERS,
  USER_HEADER,
  createSessionChecker,
  type SessionChecker,
} from "@/lib/session-check";

/**
 * Next 16 "Proxy" (früher Middleware, Node-Laufzeit): Jede Anfrage braucht eine gültige
 * Authelia-Sitzung, die das Dashboard selbst bei Authelia prüft (design.md, Entscheidung 4).
 * Läuft ohne matcher auf alles, damit auch statische Dateien nur über den Login erreichbar sind.
 * Eingehende Remote-*- und x-dashboard-user-Header werden entfernt; der Nutzer kommt allein aus
 * der Antwort von Authelia.
 */
let checker: SessionChecker | undefined;
let configLogged = false;

function getChecker(): SessionChecker | undefined {
  if (checker) return checker;
  try {
    checker = createSessionChecker({ autheliaUrl: getEnvFor("AUTHELIA_INTERNAL_URL").AUTHELIA_INTERNAL_URL });
    return checker;
  } catch {
    if (!configLogged) {
      configLogged = true;
      console.error("AUTHELIA_INTERNAL_URL ist nicht gesetzt oder ungültig: Alle Anfragen werden mit 403 abgewiesen.");
    }
    return undefined;
  }
}

function denied() {
  // Bewusst ohne Details, damit nichts über die Konfiguration verraten wird.
  return new NextResponse("Zugriff verweigert", {
    status: 403,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}

export async function proxy(request: NextRequest) {
  const active = getChecker();
  if (!active) return denied();

  const result = await active.check({
    method: request.method,
    pathname: request.nextUrl.pathname,
    search: request.nextUrl.search,
    headers: request.headers,
  });
  if (!result.allow) return denied();

  const headers = new Headers(request.headers);
  for (const name of STRIPPED_HEADERS) headers.delete(name);
  if (result.user) headers.set(USER_HEADER, result.user.user);
  return NextResponse.next({ request: { headers } });
}
