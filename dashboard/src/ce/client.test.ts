import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { createCeClient } from "./client";
import { CeApiError } from "./errors";

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL("./__fixtures__/recorded-2026-10-15.json", import.meta.url)), "utf8"),
);
const SECRET = "test-secret-do-not-leak";

type Call = { url: string; init: RequestInit };
function mock(responder: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchFn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init: init ?? {} });
    return responder(url, init ?? {});
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}
const json = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });

function client(fetchFn: typeof fetch, extra: { timeoutMs?: number } = {}) {
  return createCeClient({ baseUrl: "http://ce:8080/", secret: SECRET, fetch: fetchFn, ...extra });
}

describe("CE-Client", () => {
  it("liest Status, Queue und Jobs aus der Fixture mit Bearer-Auth", async () => {
    const { fetchFn, calls } = mock((url) => {
      if (url.endsWith("/system/v1/status")) return json(fixture.status);
      if (url.endsWith("/system/v1/jobs/queue")) return json(fixture.queue);
      return json(fixture.jobs);
    });
    const c = client(fetchFn);
    expect((await c.getStatus()).renovateVersion).toBe("44.134.1");
    expect(await c.getQueue()).toEqual({ running: [], pending: [] });
    const jobs = await c.listRepoJobs("Krinke-IT-Consulting/renovate", 5);
    expect(jobs).toHaveLength(5);
    expect(jobs[0]?.status).toBe("success");
    expect(calls[2]?.url).toBe("http://ce:8080/api/v1/repos/Krinke-IT-Consulting/renovate/-/jobs?limit=5");
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${SECRET}`);
  });

  it("kodiert Pfadsegmente einzeln und behält den Slash", async () => {
    const { fetchFn, calls } = mock(() => json([]));
    await client(fetchFn).listRepoJobs("Org Name/re#po");
    expect(calls[0]!.url).toContain("/api/v1/repos/Org%20Name/re%23po/-/jobs?limit=20");
  });

  it("paginiert Repos über x-next-cursor mit limit=100", async () => {
    const { fetchFn, calls } = mock((url) =>
      url.includes("cursor=c2")
        ? json([{ name: "b", fullName: "o/b", status: "disabled" }])
        : json([{ name: "a", fullName: "o/a", status: "onboarded" }], { headers: { "x-next-cursor": "c2" } }),
    );
    const repos = await client(fetchFn).listOrgRepos("o");
    expect(repos.map((r) => r.fullName)).toEqual(["o/a", "o/b"]);
    expect(calls[0]!.url).toContain("/api/v1/orgs/o/-/repos?limit=100");
    expect(calls[1]!.url).toContain("cursor=c2");
  });

  it("paginiert über den Link-Header und akzeptiert { orgs: [...] }", async () => {
    const { fetchFn } = mock((url) =>
      url.includes("cursor=n1")
        ? json({ orgs: [{ name: "B" }] })
        : json({ orgs: [{ name: "A" }] }, { headers: { link: '<http://ce/api/v1/orgs?limit=100&cursor=n1>; rel="next"' } }),
    );
    expect((await client(fetchFn).listOrgs()).map((o) => o.name)).toEqual(["A", "B"]);
  });

  it("liefert das Log als Text", async () => {
    const { fetchFn, calls } = mock(() => new Response("zeile1\nzeile2"));
    expect(await client(fetchFn).getJobLog("abc")).toBe("zeile1\nzeile2");
    expect(calls[0]!.url).toBe("http://ce:8080/system/v1/jobs/logs/abc");
  });

  it("addJob sendet das Repo und gibt inserted/unchanged zurück", async () => {
    const { fetchFn, calls } = mock((_u, init) =>
      json({ jobId: "j1", status: "pending", change: JSON.parse(String(init.body)).repository === "o/new" ? "inserted" : "unchanged" }),
    );
    const c = client(fetchFn);
    expect((await c.addJob("o/new")).change).toBe("inserted");
    expect((await c.addJob("o/old")).change).toBe("unchanged");
    expect(calls[0]!.init.method).toBe("POST");
    expect(calls[0]!.url).toBe("http://ce:8080/system/v1/jobs/add");
  });

  it("Fehler nennen Status und Pfad, aber nie das Secret", async () => {
    const { fetchFn } = mock(() => new Response(`Bearer ${SECRET}`, { status: 401 }));
    const err = await client(fetchFn).getStatus().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CeApiError);
    const e = err as CeApiError;
    expect(e.status).toBe(401);
    expect(e.path).toBe("/system/v1/status");
    expect(e.message).toContain("401");
    expect(JSON.stringify({ m: e.message, s: e.stack, p: e.path })).not.toContain(SECRET);
  });

  it("Netzwerkfehler und Zeitlimit enthalten das Secret nicht", async () => {
    const net = mock(() => {
      throw new Error(`connect failed with Authorization: Bearer ${SECRET}`);
    });
    const e1 = (await client(net.fetchFn).getQueue().catch((e: unknown) => e)) as CeApiError;
    expect(e1.message).not.toContain(SECRET);
    expect(e1.status).toBeNull();

    const slow = mock((_u, init) => new Promise<Response>((_res, rej) => {
      init.signal?.addEventListener("abort", () => rej(init.signal!.reason));
    }));
    const e2 = (await client(slow.fetchFn, { timeoutMs: 20 }).getQueue().catch((e: unknown) => e)) as CeApiError;
    expect(e2).toBeInstanceOf(CeApiError);
    expect(e2.message).toContain("abgebrochen");
    expect(e2.message).not.toContain(SECRET);
  });
});
