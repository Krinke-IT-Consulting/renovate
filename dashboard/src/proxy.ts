import { NextResponse, type NextRequest } from "next/server";
import { getEnvFor } from "@/env";
import { PROXY_SECRET_HEADER, REMOTE_USER_HEADER, decideAccess } from "@/lib/proxy-guard";

/**
 * Next 16 "Proxy" (früher Middleware): lässt nur Anfragen durch, die über den Traefik-Router mit
 * Authelia kommen. Der Router setzt X-Dashboard-Proxy-Secret; der Nutzer kommt aus Remote-User.
 * Läuft auf jede Anfrage (kein matcher), damit auch statische Dateien nur über den Login erreichbar sind.
 */
let missingSecretLogged = false;

export function proxy(request: NextRequest) {
  let expectedSecret: string | undefined;
  try {
    expectedSecret = getEnvFor("DASHBOARD_PROXY_SECRET").DASHBOARD_PROXY_SECRET;
  } catch {
    expectedSecret = undefined; // nicht konfiguriert: alles abweisen
    if (!missingSecretLogged) {
      missingSecretLogged = true;
      console.error("DASHBOARD_PROXY_SECRET ist nicht gesetzt: Alle Anfragen werden mit 403 abgewiesen.");
    }
  }

  const decision = decideAccess({
    method: request.method,
    pathname: request.nextUrl.pathname,
    proxySecret: request.headers.get(PROXY_SECRET_HEADER),
    remoteUser: request.headers.get(REMOTE_USER_HEADER),
    expectedSecret,
  });

  if (!decision.allow) {
    // Bewusst ohne Details, damit nichts über die Konfiguration verraten wird.
    return new NextResponse("Zugriff verweigert", {
      status: 403,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }
  return NextResponse.next();
}
