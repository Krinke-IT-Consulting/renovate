import { createHash, timingSafeEqual } from "node:crypto";

/** Reine Entscheidungslogik der Vertrauensgrenze (design.md, Entscheidung 4). */

export const PROXY_SECRET_HEADER = "x-dashboard-proxy-secret";
export const REMOTE_USER_HEADER = "remote-user";
export const HEALTH_PATH = "/api/health";

export type GuardInput = {
  method: string;
  pathname: string;
  /** Wert des Headers X-Dashboard-Proxy-Secret, falls vorhanden. */
  proxySecret: string | null;
  /** Wert des Headers Remote-User, falls vorhanden. */
  remoteUser: string | null;
  /** Erwartetes Secret aus der Konfiguration; fehlt es, wird alles abgewiesen. */
  expectedSecret: string | undefined;
};

export type GuardDecision = { allow: true } | { allow: false; reason: "secret" | "user" };

/** Vergleich in konstanter Zeit über SHA-256, damit auch die Länge nichts verrät. */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function decideAccess(input: GuardInput): GuardDecision {
  if (input.method === "GET" && input.pathname === HEALTH_PATH) {
    return { allow: true };
  }
  const { expectedSecret, proxySecret, remoteUser } = input;
  if (!expectedSecret || !proxySecret || !safeEqual(proxySecret, expectedSecret)) {
    return { allow: false, reason: "secret" };
  }
  if (!remoteUser || remoteUser.trim() === "") {
    return { allow: false, reason: "user" };
  }
  return { allow: true };
}
