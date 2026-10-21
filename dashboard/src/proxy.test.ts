import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const AUTH = "http://authelia.test:9091";

/** Frisches Modul je Test: proxy.ts hält den Checker im Modulzustand. */
async function loadProxy() {
  vi.resetModules();
  return (await import("./proxy")).proxy;
}

function req(path: string, init: { method?: string; headers?: Record<string, string> } = {}) {
  return new NextRequest(`http://dashboard.test${path}`, {
    method: init.method ?? "GET",
    headers: { host: "dashboard.test", ...init.headers },
  });
}

/** Header, die Next der nachgelagerten Anwendung übergibt (x-middleware-request-*). */
function forwarded(res: Response): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of res.headers) {
    if (k.startsWith("x-middleware-request-")) out[k.slice("x-middleware-request-".length)] = v;
  }
  return out;
}

describe("proxy()", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubEnv("AUTHELIA_INTERNAL_URL", AUTH);
    fetchMock = vi.fn(
      async () => new Response(null, { status: 200, headers: { "Remote-User": "echter-nutzer", "Remote-Name": "Echt" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("entfernt eingehende Remote-* und x-dashboard-user und setzt den Nutzer nur aus der Authelia-Antwort", async () => {
    const proxy = await loadProxy();
    const res = await proxy(
      req("/repos", {
        headers: {
          cookie: "authelia_session=abc",
          "remote-user": "angreifer",
          "remote-groups": "admins",
          "remote-name": "Angreifer",
          "remote-email": "a@evil.test",
          "x-dashboard-user": "angreifer",
        },
      }),
    );
    expect(res.status).toBe(200);
    const h = forwarded(res);
    expect(h["x-dashboard-user"]).toBe("echter-nutzer");
    expect(h["remote-user"]).toBeUndefined();
    expect(h["remote-groups"]).toBeUndefined();
    expect(h["remote-name"]).toBeUndefined();
    expect(h["remote-email"]).toBeUndefined();
    // Authelia wurde mit dem Cookie gefragt, nicht mit den gefälschten Headern.
    const [, init] = fetchMock.mock.calls[0]!;
    expect((init as RequestInit).headers).toMatchObject({ Cookie: "authelia_session=abc" });
    expect(JSON.stringify((init as RequestInit).headers)).not.toMatch(/angreifer/i);
  });

  it("setzt x-dashboard-user nicht, wenn Authelia keinen Nutzer liefert, und weist ab", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 401 }));
    const proxy = await loadProxy();
    const res = await proxy(req("/", { headers: { cookie: "x=1", "x-dashboard-user": "angreifer" } }));
    expect(res.status).toBe(403);
    expect(forwarded(res)["x-dashboard-user"]).toBeUndefined();
  });

  it("antwortet ohne Cookie mit 403, ohne Authelia zu fragen", async () => {
    const proxy = await loadProxy();
    const res = await proxy(req("/"));
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("antwortet bei fehlender AUTHELIA_INTERNAL_URL mit 403, auch mit Cookie", async () => {
    vi.stubEnv("AUTHELIA_INTERNAL_URL", "");
    const proxy = await loadProxy();
    const res = await proxy(req("/", { headers: { cookie: "x=1" } }));
    expect(res.status).toBe(403);
    expect(await res.text()).toBe("Zugriff verweigert");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("lässt GET /api/health ohne Prüfung durch", async () => {
    const proxy = await loadProxy();
    const res = await proxy(req("/api/health"));
    expect(res.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(forwarded(res)["x-dashboard-user"]).toBeUndefined();
  });

  it("prüft POST /api/health dagegen wie jede andere Anfrage", async () => {
    const proxy = await loadProxy();
    const res = await proxy(req("/api/health", { method: "POST" }));
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
