import { generateKeyPairSync } from "node:crypto";
import { http, HttpResponse, type JsonBodyType } from "msw";
import { setupServer } from "msw/node";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { PlatformApiError, RateLimitPause } from "../errors";
import {
  API,
  APP_SLUG,
  BOT,
  HEAD_SHA,
  INSTALLATION_ID,
  REPO,
  dirEntry,
  fileBody,
  installationRepositories,
  installations,
  pull,
} from "../__fixtures__/github";
import { MemoryHttpCache } from "../http-cache";
import type { PlatformConnection } from "../types";
import { GitHubAdapter } from "./adapter";
import { BUILD_CHECK_CALLER_MARKER } from "./build-check";

// Wegwerf-Schlüssel, nur für diese Testläufe erzeugt.
const { privateKey: PRIVATE_KEY } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const KEY_BODY = PRIVATE_KEY.replace(/-----[A-Z ]+-----|\s/g, "");

const conn: PlatformConnection = {
  externalConnectionId: String(INSTALLATION_ID),
  ownerName: "Krinke-IT-Consulting",
  ownerType: "organization",
};

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterAll(() => server.close());

let hits: string[];
let rate: { remaining: number; limit: number; reset: number };

function rateHeaders() {
  return {
    "x-ratelimit-remaining": String(rate.remaining),
    "x-ratelimit-limit": String(rate.limit),
    "x-ratelimit-reset": String(rate.reset),
  };
}

/** Antwort mit ETag; kommt If-None-Match passend an, antwortet sie 304 (zählt separat). */
function etagged(path: string, etag: string, body: JsonBodyType, text = false) {
  return http.get(`${API}${path}`, ({ request }) => {
    hits.push(`${request.method} ${new URL(request.url).pathname}`);
    if (request.headers.get("if-none-match") === etag) {
      return new HttpResponse(null, {
        status: 304,
        headers: { ...rateHeaders(), etag },
      });
    }
    const headers = { ...rateHeaders(), etag };
    return text
      ? new HttpResponse(String(body), { headers })
      : HttpResponse.json(body, { headers });
  });
}

function makeAdapter(now?: () => number) {
  return new GitHubAdapter({
    appId: "12345",
    privateKey: PRIVATE_KEY,
    appSlug: APP_SLUG,
    cache: new MemoryHttpCache(),
    now,
  });
}

beforeEach(() => {
  hits = [];
  rate = {
    remaining: 4900,
    limit: 5000,
    reset: Math.floor(Date.now() / 1000) + 3600,
  };
  server.use(
    http.post(`${API}/app/installations/:id/access_tokens`, () =>
      HttpResponse.json(
        {
          token: "ghs_fixture_token",
          expires_at: new Date(Date.now() + 3600_000).toISOString(),
        },
        { status: 201 },
      ),
    ),
  );
});
afterEach(() => server.resetHandlers());

describe("Verbindungen und Repos", () => {
  it("liest Installationen (ohne gesperrte) neutral als Connections", async () => {
    server.use(etagged("/app/installations", '"i1"', installations));
    const conns = await makeAdapter().listConnections();
    expect(conns).toEqual([
      {
        externalConnectionId: "424242",
        ownerName: "Krinke-IT-Consulting",
        ownerType: "organization",
      },
      {
        externalConnectionId: "424243",
        ownerName: "Hiwamashi",
        ownerType: "user",
      },
    ]);
  });

  it("liest Repos neutral", async () => {
    server.use(
      etagged("/installation/repositories", '"r1"', installationRepositories),
    );
    const repos = await makeAdapter().listRepositories(conn);
    expect(repos).toEqual([
      {
        externalId: "1001",
        fullName: "Krinke-IT-Consulting/fixture-repo",
        defaultBranch: "main",
        archived: false,
        private: true,
      },
      {
        externalId: "1002",
        fullName: "Krinke-IT-Consulting/fixture-old",
        defaultBranch: "master",
        archived: true,
        private: false,
      },
    ]);
  });

  it("(a) 304 liefert den gecachten Body und verbraucht kein zweites Kontingent", async () => {
    server.use(
      etagged("/installation/repositories", '"r1"', installationRepositories),
    );
    const adapter = makeAdapter();
    const first = await adapter.listRepositories(conn);
    // Zweiter Durchlauf: Der Server prüft If-None-Match und antwortet 304.
    const second = await adapter.listRepositories(conn);
    expect(second).toEqual(first);
    expect(hits).toHaveLength(2);

    // Beleg für "kein Kontingentverbrauch": Der Server zählt nur 200er gegen das Limit.
    let counted = 0;
    server.use(
      http.get(`${API}/installation/repositories`, ({ request }) => {
        if (request.headers.get("if-none-match") === '"r1"') {
          return new HttpResponse(null, {
            status: 304,
            headers: { ...rateHeaders(), etag: '"r1"' },
          });
        }
        counted++;
        return HttpResponse.json(installationRepositories, {
          headers: { ...rateHeaders(), etag: '"r1"' },
        });
      }),
    );
    const fresh = makeAdapter();
    await fresh.listRepositories(conn);
    await fresh.listRepositories(conn);
    await fresh.listRepositories(conn);
    expect(counted).toBe(1);
  });

  it("(a) 304 ohne gecachten Eintrag ist ein Fehler, kein stilles Leer", async () => {
    server.use(
      http.get(
        `${API}/installation/repositories`,
        () => new HttpResponse(null, { status: 304 }),
      ),
    );
    await expect(makeAdapter().listRepositories(conn)).rejects.toBeInstanceOf(
      PlatformApiError,
    );
  });
});

describe("Head-SHA und Repo-Zustand", () => {
  const commitsPath = `/repos/${REPO.fullName}/commits/main`;
  const rootPath = `/repos/${REPO.fullName}/contents`;

  it("liest die Head-SHA als Text", async () => {
    server.use(etagged(commitsPath, '"c1"', HEAD_SHA, true));
    expect(await makeAdapter().getHeadSha(conn, REPO)).toBe(HEAD_SHA);
  });

  function repoContents(opts: {
    root: ReturnType<typeof dirEntry>[];
    dirs?: Record<string, ReturnType<typeof dirEntry>[]>;
    caller?: string | null;
  }) {
    const handlers = [
      http.get(`${API}${rootPath}`, ({ request }) => {
        hits.push(`GET ${new URL(request.url).pathname}`);
        return HttpResponse.json(opts.root);
      }),
      http.get(`${API}${rootPath}/:path+`, ({ request, params }) => {
        const path = ([] as string[])
          .concat(params.path as string | string[])
          .join("/");
        hits.push(`GET ${new URL(request.url).pathname}`);
        if (path === ".github/workflows/build-check.yml") {
          return opts.caller == null
            ? new HttpResponse(null, { status: 404 })
            : HttpResponse.json(fileBody(opts.caller));
        }
        const dir = opts.dirs?.[path];
        return dir
          ? HttpResponse.json(dir)
          : new HttpResponse(null, { status: 404 });
      }),
    ];
    server.use(...handlers);
  }

  it("(e) renovate.json hat Vorrang vor .github/renovate.json5", async () => {
    repoContents({
      root: [dirEntry(".github", "dir"), dirEntry("renovate.json", "file")],
      dirs: { ".github": [dirEntry("renovate.json5", "file")] },
    });
    const state = await makeAdapter().getRepositoryState(conn, REPO, HEAD_SHA);
    expect(state.configPath).toBe("renovate.json");
  });

  it("(e) .github/renovate.json5 vor .renovaterc, und .renovaterc.json zuletzt", async () => {
    repoContents({
      root: [
        dirEntry(".github", "dir"),
        dirEntry(".renovaterc", "file"),
        dirEntry(".renovaterc.json", "file"),
      ],
      dirs: { ".github": [dirEntry("renovate.json5", "file")] },
    });
    expect(
      (await makeAdapter().getRepositoryState(conn, REPO, HEAD_SHA)).configPath,
    ).toBe(".github/renovate.json5");

    repoContents({
      root: [
        dirEntry(".renovaterc.json", "file"),
        dirEntry(".renovaterc", "file"),
      ],
    });
    expect(
      (await makeAdapter().getRepositoryState(conn, REPO, HEAD_SHA)).configPath,
    ).toBe(".renovaterc");

    repoContents({ root: [dirEntry(".renovaterc.json", "file")] });
    expect(
      (await makeAdapter().getRepositoryState(conn, REPO, HEAD_SHA)).configPath,
    ).toBe(".renovaterc.json");
  });

  it("(e) ohne Konfiguration null, und ohne .github kein Abruf der Aufrufdatei", async () => {
    repoContents({ root: [dirEntry("README.md", "file")] });
    const state = await makeAdapter().getRepositoryState(conn, REPO, HEAD_SHA);
    expect(state).toEqual({ configPath: null, hasBuildCheck: false });
    expect(hits).toHaveLength(1);
  });

  it("(f) Aufrufdatei aktiv nur mit zentralem Workflow", async () => {
    const root = [dirEntry(".github", "dir")];
    repoContents({
      root,
      caller: `jobs:\n  b:\n    uses: ${BUILD_CHECK_CALLER_MARKER}v1\n`,
    });
    expect(
      (await makeAdapter().getRepositoryState(conn, REPO, HEAD_SHA))
        .hasBuildCheck,
    ).toBe(true);

    repoContents({
      root,
      caller:
        "jobs:\n  b:\n    uses: andere/workflow/.github/workflows/x.yml@v1\n",
    });
    expect(
      (await makeAdapter().getRepositoryState(conn, REPO, HEAD_SHA))
        .hasBuildCheck,
    ).toBe(false);

    repoContents({ root, caller: null });
    expect(
      (await makeAdapter().getRepositoryState(conn, REPO, HEAD_SHA))
        .hasBuildCheck,
    ).toBe(false);
  });
});

describe("Build-Check im Quell-Repo", () => {
  const SELF = "jobs:\n  b:\n    uses: ./.github/workflows/build-check.yml\n";
  const SOURCE = { ...REPO, fullName: "krinke-it-consulting/Renovate" };
  const root = [dirEntry(".github", "dir")];

  function repoContents(opts: { fullName: string; self: string | null }) {
    server.use(
      http.get(`${API}/repos/${opts.fullName}/contents`, () =>
        HttpResponse.json(root),
      ),
      http.get(`${API}/repos/${opts.fullName}/contents/:path+`, ({ params }) => {
        const path = ([] as string[]).concat(params.path as string | string[]).join("/");
        return path === ".github/workflows/build-check-self.yml" && opts.self
          ? HttpResponse.json(fileBody(opts.self))
          : new HttpResponse(null, { status: 404 });
      }),
    );
  }

  it("Quell-Repo mit lokalem Aufruf gilt als aktiv (Name ohne Beachtung der Schreibweise)", async () => {
    repoContents({ fullName: SOURCE.fullName, self: SELF });
    expect(
      (await makeAdapter().getRepositoryState(conn, SOURCE, HEAD_SHA)).hasBuildCheck,
    ).toBe(true);
  });

  it("anderes Repo mit derselben Datei gilt nicht als aktiv", async () => {
    repoContents({ fullName: REPO.fullName, self: SELF });
    expect(
      (await makeAdapter().getRepositoryState(conn, REPO, HEAD_SHA)).hasBuildCheck,
    ).toBe(false);
  });

  it("Quell-Repo ohne build-check-self.yml gilt nicht als aktiv", async () => {
    repoContents({ fullName: SOURCE.fullName, self: null });
    expect(
      (await makeAdapter().getRepositoryState(conn, SOURCE, HEAD_SHA)).hasBuildCheck,
    ).toBe(false);
  });
});

describe("Update-PRs, Status, Dashboard-Issue", () => {
  it("(d) filtert fremde Autoren und falsche Branches heraus und erkennt Automerge", async () => {
    server.use(
      etagged(`/repos/${REPO.fullName}/pulls`, '"p1"', [
        pull({
          number: 1,
          labels: ["update:minor"],
          body: "🚦 **Automerge**: Enabled.",
        }),
        pull({ number: 2, login: "mensch" }),
        pull({ number: 3, ref: "feature/x" }),
        pull({ number: 4, login: "dependabot[bot]" }),
        pull({
          number: 5,
          labels: ["security"],
          body: "🚦 **Automerge**: Disabled by config.",
        }),
        pull({ number: 6, autoMerge: { enabled_by: {} } }),
      ]),
    );
    const prs = await makeAdapter().listUpdatePullRequests(conn, REPO);
    expect(prs.map((p) => [p.number, p.automerge])).toEqual([
      [1, true],
      [5, false],
      [6, true],
    ]);
    expect(prs[0]).toMatchObject({
      title: "Update fixture 1",
      labels: ["update:minor"],
      createdAt: "2026-10-01T08:00:00Z",
      updatedAt: "2026-10-02T08:00:00Z",
    });
  });

  it("liest den Slug per GET /app, wenn er nicht übergeben wurde", async () => {
    server.use(
      etagged("/app", '"a1"', { slug: APP_SLUG }),
      etagged(`/repos/${REPO.fullName}/pulls`, '"p1"', [pull({ number: 1 })]),
    );
    const adapter = new GitHubAdapter({
      appId: "12345",
      privateKey: PRIVATE_KEY,
      cache: new MemoryHttpCache(),
    });
    expect(await adapter.listUpdatePullRequests(conn, REPO)).toHaveLength(1);
  });

  it("liefert den Endzustand eines PR", async () => {
    server.use(
      etagged(`/repos/${REPO.fullName}/pulls/7`, '"m"', {
        ...pull({ number: 7 }),
        state: "closed",
        merged_at: "2026-10-03T10:00:00Z",
      }),
      etagged(`/repos/${REPO.fullName}/pulls/8`, '"c"', {
        ...pull({ number: 8 }),
        state: "closed",
      }),
      etagged(`/repos/${REPO.fullName}/pulls/9`, '"o"', pull({ number: 9 })),
    );
    const adapter = makeAdapter();
    expect(await adapter.getPullRequestState(conn, REPO, 7)).toEqual({
      state: "merged",
      mergedAt: "2026-10-03T10:00:00Z",
    });
    expect(await adapter.getPullRequestState(conn, REPO, 8)).toEqual({
      state: "closed",
      mergedAt: null,
    });
    expect(await adapter.getPullRequestState(conn, REPO, 9)).toEqual({
      state: "open",
      mergedAt: null,
    });
  });

  it("liest Checks und Commit-Status", async () => {
    server.use(
      etagged(`/repos/${REPO.fullName}/commits/${HEAD_SHA}/check-runs`, '"k"', {
        total_count: 2,
        check_runs: [
          { status: "completed", conclusion: "success" },
          { status: "in_progress", conclusion: null },
        ],
      }),
      etagged(`/repos/${REPO.fullName}/commits/${HEAD_SHA}/status`, '"s"', {
        state: "pending",
        statuses: [{ state: "success", context: "x" }],
      }),
    );
    // Ein Check läuft noch -> normalisiert "pending" (die Ableitung liegt im Adapter).
    expect(await makeAdapter().getChangeStatus(conn, REPO, HEAD_SHA)).toEqual({
      ci: "pending",
    });
  });

  it("findet das Dependency-Dashboard des Bots und ignoriert PRs und fremde Issues", async () => {
    const url = `https://github.com/${REPO.fullName}/issues/3`;
    server.use(
      etagged(`/repos/${REPO.fullName}/issues`, '"d"', [
        {
          title: "Dependency Dashboard",
          html_url: "x/pr",
          user: { login: BOT },
          pull_request: {},
        },
        {
          title: "Dependency Dashboard",
          html_url: "x/fremd",
          user: { login: "mensch" },
        },
        { title: "Anderes", html_url: "x/anders", user: { login: BOT } },
        { title: "Dependency Dashboard", html_url: url, user: { login: BOT } },
      ]),
    );
    expect(await makeAdapter().findDependencyDashboard(conn, REPO)).toBe(url);

    server.use(etagged(`/repos/${REPO.fullName}/issues`, '"d2"', []));
    expect(await makeAdapter().findDependencyDashboard(conn, REPO)).toBeNull();
  });
});

describe("Rate-Limit", () => {
  it("(c) pausiert, sobald das Rest-Kontingent unter 20 % fällt", async () => {
    rate = {
      remaining: 900,
      limit: 5000,
      reset: Math.floor(Date.now() / 1000) + 600,
    };
    server.use(
      etagged("/installation/repositories", '"r1"', installationRepositories),
    );
    const adapter = makeAdapter();
    // Die Antwort, die den Wert meldet, wird noch geliefert ...
    await adapter.listRepositories(conn);
    const before = hits.length;
    // ... die nächste Anfrage pausiert, ohne GitHub anzufragen.
    const err = await adapter.getHeadSha(conn, REPO).catch((e) => e);
    expect(err).toBeInstanceOf(RateLimitPause);
    expect(err).toMatchObject({ remaining: 900, limit: 5000 });
    expect(hits).toHaveLength(before);
  });

  it("(c) genau 20 % pausiert noch nicht, danach nach dem Reset wieder normal", async () => {
    let t = Date.now();
    const reset = Math.floor(t / 1000) + 600;
    rate = { remaining: 1000, limit: 5000, reset };
    server.use(
      etagged("/installation/repositories", '"r1"', installationRepositories),
    );
    const adapter = makeAdapter(() => t);
    await adapter.listRepositories(conn);
    await adapter.listRepositories(conn); // 20 %: unter der Schwelle heißt strikt kleiner

    rate = { remaining: 999, limit: 5000, reset };
    server.use(
      etagged("/installation/repositories", '"r2"', installationRepositories),
    );
    await adapter.listRepositories(conn);
    await expect(adapter.listRepositories(conn)).rejects.toBeInstanceOf(
      RateLimitPause,
    );

    t = (reset + 1) * 1000; // Fenster erneuert
    rate = { remaining: 5000, limit: 5000, reset: reset + 3600 };
    await expect(adapter.listRepositories(conn)).resolves.toHaveLength(2);
  });

  it("(c) 403 mit leerem Kontingent wird zur Pause, nicht zum Rechtefehler", async () => {
    server.use(
      http.get(`${API}/installation/repositories`, () =>
        HttpResponse.json(
          { message: "API rate limit exceeded" },
          {
            status: 403,
            headers: {
              "x-ratelimit-remaining": "0",
              "x-ratelimit-limit": "5000",
              "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 600),
            },
          },
        ),
      ),
    );
    await expect(makeAdapter().listRepositories(conn)).rejects.toBeInstanceOf(
      RateLimitPause,
    );
  });
});

describe("(g) Fehler enthalten keine Geheimnisse", () => {
  function assertClean(err: unknown) {
    const dump = [
      String((err as Error).message),
      String((err as Error).stack),
      JSON.stringify(err, Object.getOwnPropertyNames(err as object)),
    ].join("\n");
    expect(dump).not.toContain(KEY_BODY.slice(0, 40));
    expect(dump).not.toContain("BEGIN");
    expect(dump).not.toContain("ghs_fixture_token");
    expect(dump).not.toMatch(/bearer/i);
  }

  it("HTTP-Fehler: nur Status, Methode und Pfad", async () => {
    server.use(
      http.get(`${API}/installation/repositories`, () =>
        HttpResponse.json(
          { message: "Bad credentials ghs_fixture_token" },
          { status: 403 },
        ),
      ),
    );
    const err = await makeAdapter()
      .listRepositories(conn)
      .catch((e) => e);
    expect(err).toBeInstanceOf(PlatformApiError);
    expect(err).toMatchObject({
      status: 403,
      method: "GET",
      path: "/installation/repositories",
    });
    assertClean(err);
  });

  it("Pfad enthält Owner und Repo, aber keine Query", async () => {
    server.use(
      http.get(
        `${API}/repos/${REPO.fullName}/pulls/5`,
        () => new HttpResponse(null, { status: 500 }),
      ),
    );
    const err = await makeAdapter()
      .getPullRequestState(conn, REPO, 5)
      .catch((e) => e);
    expect(err.path).toBe(`/repos/${REPO.fullName}/pulls/5`);
  });

  it("Token-Austausch schlägt fehl", async () => {
    server.use(
      http.post(`${API}/app/installations/:id/access_tokens`, () =>
        HttpResponse.json({ message: "Bad credentials" }, { status: 401 }),
      ),
    );
    const err = await makeAdapter()
      .listRepositories(conn)
      .catch((e) => e);
    expect(err).toBeInstanceOf(PlatformApiError);
    assertClean(err);
  });

  it("ungültiger Schlüssel: Meldung ohne Schlüsselinhalt", async () => {
    const broken = `-----BEGIN PRIVATE KEY-----\n${KEY_BODY.slice(0, 60)}\n-----END PRIVATE KEY-----`;
    const adapter = new GitHubAdapter({
      appId: "12345",
      privateKey: broken,
      appSlug: APP_SLUG,
      cache: new MemoryHttpCache(),
    });
    const err = await adapter.listRepositories(conn).catch((e) => e);
    expect(err).toBeInstanceOf(PlatformApiError);
    expect(err.message).not.toContain(KEY_BODY.slice(0, 40));
    assertClean(err);
  });

  it("akzeptiert einen Schlüssel mit \\n-Text statt Zeilenumbrüchen", async () => {
    server.use(
      etagged("/installation/repositories", '"r1"', installationRepositories),
    );
    const adapter = new GitHubAdapter({
      appId: "12345",
      privateKey: PRIVATE_KEY.replace(/\n/g, "\\n"),
      appSlug: APP_SLUG,
      cache: new MemoryHttpCache(),
    });
    await expect(adapter.listRepositories(conn)).resolves.toHaveLength(2);
  });
});

describe("Review Phase 5: Adapter-Verhalten", () => {
  const commitsPath = `/repos/${REPO.fullName}/commits/main`;
  const rootPath = `/repos/${REPO.fullName}/contents`;

  it("leeres Repo: 409 und 404 auf commits/{ref} liefern null, andere Fehler werfen", async () => {
    server.use(
      http.get(`${API}${commitsPath}`, () =>
        HttpResponse.json({ message: "Git Repository is empty." }, { status: 409 }),
      ),
    );
    expect(await makeAdapter().getHeadSha(conn, REPO)).toBeNull();

    server.use(
      http.get(`${API}${commitsPath}`, () => new HttpResponse(null, { status: 404 })),
    );
    expect(await makeAdapter().getHeadSha(conn, REPO)).toBeNull();

    server.use(
      http.get(`${API}${commitsPath}`, () => new HttpResponse(null, { status: 500 })),
    );
    await expect(makeAdapter().getHeadSha(conn, REPO)).rejects.toMatchObject({
      name: "PlatformApiError",
      status: 500,
    });
  });

  it("404 beim Token-Austausch ist nie ein toleriertes 'nicht gefunden'", async () => {
    server.use(
      http.post(`${API}/app/installations/:id/access_tokens`, () =>
        HttpResponse.json({ message: "Not Found" }, { status: 404 }),
      ),
    );
    // getHeadSha toleriert 404/409 auf dem Commit-Abruf, nicht aber beim Token.
    // Eigene Installations-ID: Tokens früherer Tests liegen im Cache der Auth-Bibliothek.
    const fresh = { ...conn, externalConnectionId: "999001" };
    const err = await makeAdapter().getHeadSha(fresh, REPO).catch((e) => e);
    expect(err).toBeInstanceOf(PlatformApiError);
    expect(err).toMatchObject({ status: 404, path: commitsPath });
  });

  it("404 auf dem Root-Listing ist ein Fehler; fehlende Dateien und Unterordner sind es nicht", async () => {
    server.use(
      http.get(`${API}${rootPath}`, () => new HttpResponse(null, { status: 404 })),
    );
    await expect(
      makeAdapter().getRepositoryState(conn, REPO, HEAD_SHA),
    ).rejects.toMatchObject({ name: "PlatformApiError", status: 404, path: rootPath });

    server.use(
      http.get(`${API}${rootPath}`, () =>
        HttpResponse.json([dirEntry(".github", "dir")]),
      ),
      http.get(`${API}${rootPath}/:path+`, () => new HttpResponse(null, { status: 404 })),
    );
    expect(await makeAdapter().getRepositoryState(conn, REPO, HEAD_SHA)).toEqual({
      configPath: null,
      hasBuildCheck: false,
    });
  });

  it("Inhalte zu festem ref=<sha> werden weder bedingt angefragt noch gecacht", async () => {
    const cache = new MemoryHttpCache();
    const setKeys: string[] = [];
    const origSet = cache.set.bind(cache);
    cache.set = async (key, etag, body) => {
      setKeys.push(key);
      await origSet(key, etag, body);
    };
    const adapter = new GitHubAdapter({
      appId: "12345",
      privateKey: PRIVATE_KEY,
      appSlug: APP_SLUG,
      cache,
    });
    const conditional: (string | null)[] = [];
    server.use(
      http.get(`${API}${rootPath}`, ({ request }) => {
        conditional.push(request.headers.get("if-none-match"));
        return HttpResponse.json([dirEntry("renovate.json", "file")], {
          headers: { etag: '"root"', ...rateHeaders() },
        });
      }),
    );
    await adapter.getRepositoryState(conn, REPO, HEAD_SHA);
    await adapter.getRepositoryState(conn, REPO, HEAD_SHA);
    expect(conditional).toEqual([null, null]);
    expect(setKeys).toEqual([]);
  });

  it("schließt renovate/configure aus; renovate-platform/… ist kein Update-PR; Pakete aus der Listen-Antwort", async () => {
    const table = [
      "| Package | Change |",
      "|---|---|",
      "| [lodash](https://lodash.example/) | `1` -> `2` |",
    ].join("\n");
    server.use(
      etagged(`/repos/${REPO.fullName}/pulls`, '"p-pk"', [
        pull({ number: 1, body: table, title: "Update dependency lodash to v2" }),
        pull({ number: 2, ref: "renovate/configure", title: "Configure Renovate" }),
        pull({ number: 3, ref: "renovate-platform/onboarding" }),
        pull({ number: 4, ref: "renovate-platform/build-check" }),
        pull({ number: 5, title: "Update dependency react to v19", ref: "renovate/react-19.x" }),
        pull({ number: 6, title: "Lock file maintenance", ref: "renovate/lock-file-maintenance" }),
      ]),
    );
    const prs = await makeAdapter().listUpdatePullRequests(conn, REPO);
    expect(prs.map((p) => [p.number, p.packageNames])).toEqual([
      [1, ["lodash"]],
      [5, ["react"]],
      [6, []],
    ]);
  });

  it("Dependency-Dashboard: sort=created&direction=asc, nach dem ersten Treffer kein Weiterblättern", async () => {
    const url = `https://github.com/${REPO.fullName}/issues/1`;
    const queries: URLSearchParams[] = [];
    server.use(
      http.get(`${API}/repos/${REPO.fullName}/issues`, ({ request }) => {
        const q = new URL(request.url).searchParams;
        queries.push(q);
        return HttpResponse.json([
          { title: "Dependency Dashboard", html_url: url, user: { login: BOT } },
          ...Array.from({ length: 99 }, (_, i) => ({
            title: `Anderes ${i}`,
            html_url: `x/${i}`,
            user: { login: BOT },
          })),
        ]);
      }),
    );
    expect(await makeAdapter().findDependencyDashboard(conn, REPO)).toBe(url);
    expect(queries).toHaveLength(1);
    expect(queries[0]!.get("sort")).toBe("created");
    expect(queries[0]!.get("direction")).toBe("asc");
    expect(queries[0]!.get("creator")).toBe(BOT);
  });

  it("Dependency-Dashboard: blättert weiter, solange die Seite voll ist und kein Treffer da ist", async () => {
    const url = `https://github.com/${REPO.fullName}/issues/9`;
    const pages: string[] = [];
    server.use(
      http.get(`${API}/repos/${REPO.fullName}/issues`, ({ request }) => {
        const page = new URL(request.url).searchParams.get("page") ?? "1";
        pages.push(page);
        if (page === "1") {
          return HttpResponse.json(
            Array.from({ length: 100 }, (_, i) => ({
              title: `Anderes ${i}`,
              html_url: `x/${i}`,
              user: { login: BOT },
            })),
          );
        }
        return HttpResponse.json([
          { title: "Dependency Dashboard", html_url: url, user: { login: BOT } },
        ]);
      }),
    );
    expect(await makeAdapter().findDependencyDashboard(conn, REPO)).toBe(url);
    expect(pages).toEqual(["1", "2"]);
  });

  it("Rate-Limit-Untergrenze: Pause unter max(20 % des Limits, 400)", async () => {
    server.use(
      etagged("/installation/repositories", '"r-low"', installationRepositories),
    );
    // Kleines Limit: 20 % wären 200, die Untergrenze 400 greift.
    rate = { remaining: 399, limit: 1000, reset: Math.floor(Date.now() / 1000) + 600 };
    const low = makeAdapter();
    await low.listRepositories(conn);
    await expect(low.listRepositories(conn)).rejects.toBeInstanceOf(RateLimitPause);

    rate = { remaining: 400, limit: 1000, reset: Math.floor(Date.now() / 1000) + 600 };
    const ok = makeAdapter();
    await ok.listRepositories(conn);
    await expect(ok.listRepositories(conn)).resolves.toHaveLength(2);

    // Großes Limit: der Anteil (1000 von 5000) gilt, 999 pausiert.
    rate = { remaining: 999, limit: 5000, reset: Math.floor(Date.now() / 1000) + 600 };
    const big = makeAdapter();
    await big.listRepositories(conn);
    await expect(big.listRepositories(conn)).rejects.toBeInstanceOf(RateLimitPause);
  });
});
