import { describe, expect, it, vi } from "vitest";
import { createSessionChecker, type SessionRequest } from "./session-check";

const URL_BASE = "http://renovate-authelia:9091";

function req(over: { method?: string; pathname?: string; search?: string; headers?: Record<string, string> } = {}): SessionRequest {
  const { headers: h, ...rest } = over;
  const map = new Headers({ cookie: "renovate_authelia_session=test", host: "renovate.example", ...h });
  return { method: "GET", pathname: "/", search: "?a=1", ...rest, headers: map };
}

function ok(user = "admin") {
  return new Response(null, { status: 200, headers: { "Remote-User": user, "Remote-Name": "Test Name" } });
}

function setup(respond: () => Promise<Response> | Response = () => ok()) {
  const fetchMock = vi.fn<typeof fetch>(async () => respond());
  let t = 1_000_000;
  const logError = vi.fn();
  const checker = createSessionChecker({
    autheliaUrl: URL_BASE,
    fetch: fetchMock,
    now: () => t,
    logError,
  });
  return { checker, fetchMock, logError, advance: (ms: number) => (t += ms) };
}

describe("createSessionChecker", () => {
  it("erlaubt eine gültige Sitzung und übernimmt den Nutzer aus Authelia", async () => {
    const { checker, fetchMock } = setup();
    const result = await checker.check(req({ headers: { "x-forwarded-for": "203.0.113.7" } }));
    expect(result).toEqual({ allow: true, user: { user: "admin", name: "Test Name" } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${URL_BASE}/api/authz/forward-auth`);
    expect(init?.redirect).toBe("manual");
    expect(init?.headers).toMatchObject({
      Cookie: "renovate_authelia_session=test",
      Accept: "application/json",
      "X-Forwarded-Method": "GET",
      "X-Forwarded-Proto": "https",
      "X-Forwarded-Host": "renovate.example",
      "X-Forwarded-Uri": "/?a=1",
      "X-Forwarded-For": "203.0.113.7",
    });
  });

  it("nutzt x-forwarded-proto und x-forwarded-host der Anfrage", async () => {
    const { checker, fetchMock } = setup();
    await checker.check(req({ headers: { "x-forwarded-proto": "http", "x-forwarded-host": "a.example" } }));
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({
      "X-Forwarded-Proto": "http",
      "X-Forwarded-Host": "a.example",
    });
  });

  it.each([401, 403, 302])("weist Status %i ab", async (status) => {
    const { checker } = setup(() => new Response(null, { status, headers: { Location: "https://x" } }));
    expect(await checker.check(req())).toEqual({ allow: false });
  });

  it("weist 200 ohne Remote-User ab", async () => {
    const { checker } = setup(() => new Response(null, { status: 200 }));
    expect(await checker.check(req())).toEqual({ allow: false });
  });

  it("weist ab, wenn Authelia nicht erreichbar ist, und loggt höchstens einmal pro Minute ohne Werte", async () => {
    const { checker, logError, advance } = setup(() => {
      throw new Error("ECONNREFUSED test-cookie-wert");
    });
    expect(await checker.check(req())).toEqual({ allow: false });
    await checker.check(req());
    expect(logError).toHaveBeenCalledTimes(1);
    expect(logError.mock.calls[0][0]).not.toContain("test");
    advance(61_000);
    await checker.check(req());
    expect(logError).toHaveBeenCalledTimes(2);
  });

  it("weist bei Zeitüberschreitung ab", async () => {
    const { checker } = setup(() => Promise.reject(new DOMException("timeout", "TimeoutError")));
    expect(await checker.check(req())).toEqual({ allow: false });
  });

  it("ignoriert einen gefälschten eingehenden Remote-User: Nutzer stammt aus der Authelia-Antwort", async () => {
    const { checker, fetchMock } = setup(() => ok("echter-nutzer"));
    const result = await checker.check(req({ headers: { "remote-user": "admin", "x-dashboard-user": "admin" } }));
    expect(result).toMatchObject({ allow: true, user: { user: "echter-nutzer" } });
    const sent = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
    expect(Object.keys(sent).map((k) => k.toLowerCase())).not.toContain("remote-user");
  });

  it("ruft ohne Cookie Authelia nicht auf und weist ab", async () => {
    const { checker, fetchMock } = setup();
    const headers = new Headers({ host: "renovate.example" });
    expect(await checker.check({ method: "GET", pathname: "/", headers })).toEqual({ allow: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("cached positive Ergebnisse 30 s und fragt danach erneut", async () => {
    const { checker, fetchMock, advance } = setup();
    await checker.check(req());
    advance(29_000);
    await checker.check(req());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    advance(2_000);
    await checker.check(req());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("cached nicht pro Cookie oder Host übergreifend und nicht negative Ergebnisse", async () => {
    const { checker, fetchMock } = setup();
    await checker.check(req());
    await checker.check(req({ headers: { cookie: "anderes=1" } }));
    await checker.check(req({ headers: { host: "b.example" } }));
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const denied = setup(() => new Response(null, { status: 401 }));
    await denied.checker.check(req());
    await denied.checker.check(req());
    expect(denied.fetchMock).toHaveBeenCalledTimes(2);
  });

  it("begrenzt den Cache und wirft die ältesten Einträge zuerst raus", async () => {
    const fetchMock = vi.fn(async () => ok());
    const checker = createSessionChecker({
      autheliaUrl: URL_BASE,
      fetch: fetchMock as unknown as typeof fetch,
      maxEntries: 2,
    });
    await checker.check(req({ headers: { cookie: "a=1" } }));
    await checker.check(req({ headers: { cookie: "b=1" } }));
    await checker.check(req({ headers: { cookie: "c=1" } }));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await checker.check(req({ headers: { cookie: "c=1" } })); // noch im Cache
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await checker.check(req({ headers: { cookie: "a=1" } })); // verdrängt
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("nimmt nur GET /api/health aus, ohne Prüfung", async () => {
    const { checker, fetchMock } = setup(() => new Response(null, { status: 401 }));
    const bare = new Headers();
    expect(await checker.check({ method: "GET", pathname: "/api/health", headers: bare })).toEqual({
      allow: true,
      user: null,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await checker.check({ method: "POST", pathname: "/api/health", headers: bare })).allow).toBe(false);
    expect((await checker.check({ method: "GET", pathname: "/api/health/x", headers: bare })).allow).toBe(false);
  });
});
