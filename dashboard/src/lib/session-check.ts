import { createHash } from "node:crypto";

/**
 * Sitzungsprüfung bei Authelia (design.md, Entscheidung 4): Das Dashboard vertraut keinem
 * eingehenden Header, sondern fragt für jede Anfrage Authelia, ob die Sitzung gültig ist.
 * Reine Logik mit injizierbarem fetch und Uhr. Es werden nie Cookie- oder Nutzerwerte geloggt.
 */

export const HEALTH_PATH = "/api/health";
export const USER_HEADER = "x-dashboard-user";
/** Header, die von außen kommen können und deshalb vor dem Weiterreichen entfernt werden. */
export const STRIPPED_HEADERS = [
  "remote-user",
  "remote-name",
  "remote-email",
  "remote-groups",
  USER_HEADER,
] as const;

export type SessionUser = { user: string; name?: string; email?: string };

export type SessionResult =
  | { allow: true; user: SessionUser | null }
  | { allow: false };

export type SessionRequest = {
  method: string;
  pathname: string;
  search?: string;
  headers: Pick<Headers, "get">;
};

export type SessionCheckerOptions = {
  /** Basis-URL von Authelia im internen Netz, z. B. http://renovate-authelia:9091 */
  autheliaUrl: string;
  fetch?: typeof fetch;
  now?: () => number;
  cacheTtlMs?: number;
  maxEntries?: number;
  timeoutMs?: number;
  /** Fehlerausgabe ohne Werte; Standard: console.error. */
  logError?: (message: string) => void;
};

const LOG_INTERVAL_MS = 60_000;

export function createSessionChecker(options: SessionCheckerOptions) {
  const doFetch = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const ttl = options.cacheTtlMs ?? 30_000;
  const maxEntries = options.maxEntries ?? 500;
  const timeoutMs = options.timeoutMs ?? 3_000;
  const logError = options.logError ?? ((m: string) => console.error(m));
  const endpoint = `${options.autheliaUrl.replace(/\/+$/, "")}/api/authz/forward-auth`;

  // Nur positive Ergebnisse; Map behält die Einfügereihenfolge, der älteste Eintrag steht vorn.
  const cache = new Map<string, { user: SessionUser; expires: number }>();
  let lastLogged = Number.NEGATIVE_INFINITY;

  function logUnreachable() {
    const t = now();
    if (t - lastLogged >= LOG_INTERVAL_MS) {
      lastLogged = t;
      logError("Authelia nicht erreichbar oder Antwort nicht auswertbar: Anfragen werden mit 403 abgewiesen.");
    }
  }

  function remember(key: string, user: SessionUser) {
    cache.delete(key);
    while (cache.size >= maxEntries) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
    cache.set(key, { user, expires: now() + ttl });
  }

  async function check(req: SessionRequest): Promise<SessionResult> {
    if (req.method === "GET" && req.pathname === HEALTH_PATH) {
      return { allow: true, user: null };
    }
    const cookie = req.headers.get("cookie");
    if (!cookie || cookie.trim() === "") return { allow: false };

    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
    const key = createHash("sha256").update(cookie).update("\n").update(host).digest("hex");

    const hit = cache.get(key);
    if (hit) {
      if (hit.expires > now()) return { allow: true, user: hit.user };
      cache.delete(key);
    }

    const forwarded: Record<string, string> = {
      Cookie: cookie,
      Accept: "application/json",
      "X-Forwarded-Method": req.method,
      "X-Forwarded-Proto": req.headers.get("x-forwarded-proto") ?? "https",
      "X-Forwarded-Host": host,
      "X-Forwarded-Uri": `${req.pathname}${req.search ?? ""}`,
    };
    const forwardedFor = req.headers.get("x-forwarded-for");
    if (forwardedFor) forwarded["X-Forwarded-For"] = forwardedFor;

    let response: Response;
    try {
      response = await doFetch(endpoint, {
        method: "GET",
        headers: forwarded,
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      logUnreachable();
      return { allow: false };
    }

    if (response.status !== 200) {
      // 401/403/3xx: Sitzung ungültig. 5xx deuten auf ein Problem bei Authelia hin.
      if (response.status >= 500) logUnreachable();
      return { allow: false };
    }
    const user = response.headers.get("remote-user")?.trim();
    if (!user) return { allow: false };

    const result: SessionUser = { user };
    const name = response.headers.get("remote-name")?.trim();
    const email = response.headers.get("remote-email")?.trim();
    if (name) result.name = name;
    if (email) result.email = email;
    remember(key, result);
    return { allow: true, user: result };
  }

  return { check };
}

export type SessionChecker = ReturnType<typeof createSessionChecker>;
