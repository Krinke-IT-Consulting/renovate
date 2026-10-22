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
import {
  PlatformApiError,
  PlatformFilesExistError,
  PlatformHeadChangedError,
  PlatformLeftoverBranchError,
  PlatformPermissionError,
  PlatformRejectedError,
  RateLimitPause,
} from "../errors";
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
        mergeMethods: ["squash", "merge"],
      },
      {
        externalId: "1002",
        fullName: "Krinke-IT-Consulting/fixture-old",
        defaultBranch: "master",
        archived: true,
        private: false,
        mergeMethods: [],
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

describe("Rollout: Schreibzugriffe und Vorlagen", () => {
  const base = `${API}/repos/${REPO.fullName}`;

  it("findOpenChangeRequest filtert über den Head-Branch und liefert null ohne Treffer", async () => {
    let head = "";
    server.use(
      http.get(`${base}/pulls`, ({ request }) => {
        head = new URL(request.url).searchParams.get("head") ?? "";
        return HttpResponse.json([
          {
            number: 4,
            html_url: "https://example.test/pull/4",
            head: { ref: "renovate-platform/onboarding", sha: "x" },
          },
        ]);
      }),
    );
    const adapter = makeAdapter();
    expect(
      await adapter.findOpenChangeRequest(conn, REPO, "renovate-platform/onboarding"),
    ).toEqual({ number: 4, url: "https://example.test/pull/4" });
    expect(head).toBe("Krinke-IT-Consulting:renovate-platform/onboarding");
    expect(await adapter.findOpenChangeRequest(conn, REPO, "anderer-branch")).toBeNull();
  });

  it("deleteBranch löscht den Ref; ein fehlender Branch (404 oder 422) ist kein Fehler", async () => {
    let status = 204;
    server.use(
      http.delete(`${base}/git/refs/heads/renovate-platform/onboarding`, () =>
        status === 204
          ? new HttpResponse(null, { status })
          : HttpResponse.json({ message: "Reference does not exist" }, { status }),
      ),
    );
    const adapter = makeAdapter();
    for (status of [204, 422, 404]) {
      await expect(
        adapter.deleteBranch(conn, REPO, "renovate-platform/onboarding"),
      ).resolves.toBeUndefined();
    }
  });

  it("deleteBranch lehnt unsichere Branchnamen ab, ohne etwas anzufragen", async () => {
    await expect(
      makeAdapter().deleteBranch(conn, REPO, "../../orgs/x"),
    ).rejects.toBeInstanceOf(PlatformApiError);
  });

  it("readTemplate liest die Vorlage aus dem Quell-Repo (Default-Branch), mit kurzem Cache", async () => {
    server.use(http.get(`${API}/app/installations`, () => HttpResponse.json(installations)));
    let reads = 0;
    let ref: string | null = "unset";
    server.use(
      http.get(
        `${API}/repos/Krinke-IT-Consulting/renovate/contents/templates/renovate.json`,
        ({ request }) => {
          reads++;
          ref = new URL(request.url).searchParams.get("ref");
          return HttpResponse.json(fileBody('{"extends":[]}'));
        },
      ),
    );
    let now = 1_000_000;
    const adapter = makeAdapter(() => now);
    const file = await adapter.readTemplate("renovate-config");
    expect(file).toEqual({ path: "renovate.json", content: '{"extends":[]}' });
    expect(ref).toBeNull();
    await adapter.readTemplate("renovate-config");
    expect(reads).toBe(1);
    now += 6 * 60 * 1000;
    await adapter.readTemplate("renovate-config");
    expect(reads).toBe(2);
  });

  it("readTemplate ohne Installation des Quell-Repos wirft einen Plattform-Fehler", async () => {
    server.use(http.get(`${API}/app/installations`, () => HttpResponse.json([])));
    await expect(makeAdapter().readTemplate("build-check-caller")).rejects.toMatchObject({
      name: "PlatformRejectedError",
      userMessage: "Das Vorlagen-Repo Krinke-IT-Consulting/renovate ist für die GitHub App nicht lesbar.",
    });
  });

  it("createChangeRequest: Fehlermeldungen tragen weder Token noch Antworttext", async () => {
    server.use(
      http.get(`${base}/commits/main`, () => new HttpResponse(HEAD_SHA)),
      http.get(`${base}/git/commits/${HEAD_SHA}`, () =>
        HttpResponse.json({ sha: HEAD_SHA, tree: { sha: "t0" } }),
      ),
      http.get(`${base}/contents/*`, () => HttpResponse.json({ message: "Not Found" }, { status: 404 })),
      http.post(`${base}/git/trees`, () =>
        HttpResponse.json({ message: "Geheimtext ghs_fixture_token" }, { status: 500 }),
      ),
    );
    const err = await makeAdapter()
      .createChangeRequest(conn, REPO, {
        branch: "renovate-platform/onboarding",
        baseBranch: "main",
        title: "t",
        body: "b",
        files: [{ path: "renovate.json", content: "{}" }],
      })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PlatformApiError);
    expect(String((err as Error).message)).not.toMatch(/ghs_|Geheimtext/);
  });
});

describe("Review Phase 7: Rollout-Adapter", () => {
  const base = `${API}/repos/${REPO.fullName}`;
  const BRANCH = "renovate-platform/onboarding";
  const request = {
    branch: BRANCH,
    baseBranch: "main",
    title: "t",
    body: "b",
    files: [
      { path: "renovate.json", content: "{}" },
      { path: ".github/workflows/build-check.yml", content: "name: x\n" },
    ],
  };

  type Hooks = {
    existing?: Record<string, string>;
    refStatuses?: number[];
    openPulls?: () => { number: number; html_url: string; head: { ref: string; sha: string } }[];
    pr?: () => Response;
    deleteRef?: () => Response;
    commitsMain?: () => Response;
    tree?: () => Response;
  };
  let seen: string[];
  let contentRefs: string[];
  let refCalls: number;

  function setup(h: Hooks = {}) {
    seen = [];
    contentRefs = [];
    refCalls = 0;
    const note = (r: Request) => seen.push(`${r.method} ${decodeURIComponent(new URL(r.url).pathname).slice(`/repos/${REPO.fullName}`.length)}`);
    server.use(
      http.get(`${base}/commits/main`, ({ request: r }) => {
        note(r);
        return h.commitsMain?.() ?? new HttpResponse(HEAD_SHA);
      }),
      http.get(`${base}/git/commits/${HEAD_SHA}`, () => HttpResponse.json({ sha: HEAD_SHA, tree: { sha: "t0" } })),
      http.get(`${base}/contents/*`, ({ request: r }) => {
        note(r);
        contentRefs.push(new URL(r.url).searchParams.get("ref") ?? "");
        const path = decodeURIComponent(new URL(r.url).pathname.slice(`/repos/${REPO.fullName}/contents/`.length));
        const content = h.existing?.[path];
        return content === undefined
          ? HttpResponse.json({ message: "Not Found" }, { status: 404 })
          : HttpResponse.json(fileBody(content));
      }),
      http.post(`${base}/git/trees`, ({ request: r }) => {
        note(r);
        return h.tree?.() ?? HttpResponse.json({ sha: "t1" }, { status: 201 });
      }),
      http.post(`${base}/git/commits`, () => HttpResponse.json({ sha: "c1" }, { status: 201 })),
      http.post(`${base}/git/refs`, ({ request: r }) => {
        note(r);
        const status = h.refStatuses?.[refCalls++] ?? 201;
        return HttpResponse.json(status === 201 ? { ref: "x" } : { message: "Reference already exists" }, { status });
      }),
      http.get(`${base}/pulls`, ({ request: r }) => {
        note(r);
        return HttpResponse.json(h.openPulls?.() ?? []);
      }),
      http.post(`${base}/pulls`, ({ request: r }) => {
        note(r);
        return h.pr?.() ?? HttpResponse.json({ number: 9, html_url: "https://example.test/pull/9" }, { status: 201 });
      }),
      http.delete(`${base}/git/refs/heads/${BRANCH}`, ({ request: r }) => {
        note(r);
        return h.deleteRef?.() ?? new HttpResponse(null, { status: 204 });
      }),
    );
  }
  const count = (entry: string) => seen.filter((x) => x === entry).length;
  const openPull = (n: number) => [{ number: n, html_url: `https://example.test/pull/${n}`, head: { ref: BRANCH, sha: "x" } }];

  describe("G1: sekundäres Rate-Limit", () => {
    const secondary = () =>
      HttpResponse.json({ message: "You have exceeded a secondary rate limit. Please wait a few minutes." }, { status: 403 });

    it("403 mit Rate-Limit-Text ohne Retry-After ist eine Pause von mindestens 60 s, kein Rechtefehler", async () => {
      server.use(http.get(`${API}/installation/repositories`, secondary));
      let now = 5_000_000;
      const adapter = makeAdapter(() => now);
      const err = await adapter.listRepositories(conn).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(RateLimitPause);
      expect((err as RateLimitPause).resetAt!.getTime()).toBeGreaterThanOrEqual(now + 60_000);
      // Folgeaufrufe pausieren, bis die Zeit um ist.
      await expect(adapter.listRepositories(conn)).rejects.toBeInstanceOf(RateLimitPause);
      now += 61_000;
      server.use(http.get(`${API}/installation/repositories`, () => HttpResponse.json(installationRepositories)));
      await expect(adapter.listRepositories(conn)).resolves.toHaveLength(2);
    });

    it("auch 429 und auch beim Schreiben (kein PlatformPermissionError)", async () => {
      setup({ tree: () => HttpResponse.json({ message: "You have exceeded a secondary rate limit" }, { status: 429 }) });
      await expect(makeAdapter().createChangeRequest(conn, REPO, request)).rejects.toBeInstanceOf(RateLimitPause);
    });

    it("403 ohne Rate-Limit-Text bleibt ein Rechtefehler", async () => {
      setup({ tree: () => HttpResponse.json({ message: "Resource not accessible by integration" }, { status: 403 }) });
      await expect(makeAdapter().createChangeRequest(conn, REPO, request)).rejects.toBeInstanceOf(PlatformPermissionError);
    });
  });

  describe("G2: Aufräumen nach dem Ref", () => {
    it("der Cleanup läuft an der Kontingent-Pause vorbei, genau ein Aufruf", async () => {
      // Die Antwort des PR-Aufrufs meldet fast leeres Kontingent: Lesen pausiert danach, das Aufräumen nicht.
      setup({
        pr: () =>
          HttpResponse.json(
            { message: "Resource not accessible by integration" },
            {
              status: 403,
              headers: { "x-ratelimit-remaining": "5", "x-ratelimit-limit": "5000", "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 3600) },
            },
          ),
      });
      const adapter = makeAdapter();
      await expect(adapter.createChangeRequest(conn, REPO, request)).rejects.toBeInstanceOf(PlatformPermissionError);
      expect(count(`DELETE /git/refs/heads/${BRANCH}`)).toBe(1);
      // Der Adapter pausiert weiterhin für normale Aufrufe.
      await expect(adapter.findOpenChangeRequest(conn, REPO, BRANCH)).rejects.toBeInstanceOf(RateLimitPause);
    });

    it("scheitert das Löschen, nennt der Fehler den Rest-Branch und trägt die Ursache", async () => {
      setup({
        pr: () => HttpResponse.json({ message: "Resource not accessible by integration" }, { status: 403 }),
        deleteRef: () => HttpResponse.json({ message: "Geheimtext ghs_fixture_token" }, { status: 500 }),
      });
      const err = await makeAdapter().createChangeRequest(conn, REPO, request).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(PlatformLeftoverBranchError);
      expect((err as PlatformLeftoverBranchError).branch).toBe(BRANCH);
      expect((err as PlatformLeftoverBranchError).original).toBeInstanceOf(PlatformPermissionError);
      expect(count(`DELETE /git/refs/heads/${BRANCH}`)).toBe(1);
      expect(String((err as Error).message)).not.toMatch(/ghs_|Geheimtext/);
    });
  });

  describe("G3: nur Rollout-Branches", () => {
    it("deleteBranch und createChangeRequest lehnen fremde Branches ab, ohne etwas anzufragen", async () => {
      setup();
      const adapter = makeAdapter();
      for (const branch of ["main", "renovate/lodash-4.x", "feature/x", "renovate-platform/", "renovate-platform/../main"]) {
        await expect(adapter.deleteBranch(conn, REPO, branch)).rejects.toBeInstanceOf(PlatformApiError);
        await expect(adapter.createChangeRequest(conn, REPO, { ...request, branch })).rejects.toBeInstanceOf(PlatformApiError);
      }
      expect(seen).toEqual([]);
    });

    it("Ref-422 mit offenem PR: PR zurückgeben, Branch nicht löschen", async () => {
      setup({ refStatuses: [422], openPulls: () => openPull(5) });
      const pr = await makeAdapter().createChangeRequest(conn, REPO, request);
      expect(pr).toEqual({ number: 5, url: "https://example.test/pull/5" });
      expect(count(`DELETE /git/refs/heads/${BRANCH}`)).toBe(0);
      expect(count("POST /pulls")).toBe(0);
    });

    it("Ref-422 ohne offenen PR: Rest ersetzen (löschen, neu anlegen, PR)", async () => {
      setup({ refStatuses: [422, 201] });
      const pr = await makeAdapter().createChangeRequest(conn, REPO, request);
      expect(pr.number).toBe(9);
      expect(count(`DELETE /git/refs/heads/${BRANCH}`)).toBe(1);
      expect(count("POST /git/refs")).toBe(2);
    });
  });

  describe("G4: mehrdeutiger Fehler beim PR-Anlegen", () => {
    for (const status of [500, 502, 422]) {
      it(`Status ${status}: gibt es den PR trotzdem, wird er zurückgegeben und der Branch nicht gelöscht`, async () => {
        let created = false;
        setup({
          pr: () => {
            created = true;
            return HttpResponse.json({ message: "x" }, { status });
          },
          openPulls: () => (created ? openPull(12) : []),
        });
        expect(await makeAdapter().createChangeRequest(conn, REPO, request)).toEqual({
          number: 12,
          url: "https://example.test/pull/12",
        });
        expect(count(`DELETE /git/refs/heads/${BRANCH}`)).toBe(0);
      });
    }

    it("ohne PR: genau eine Suche, dann Cleanup und der ursprüngliche Fehler", async () => {
      setup({ pr: () => HttpResponse.json({ message: "x" }, { status: 500 }) });
      const err = await makeAdapter().createChangeRequest(conn, REPO, request).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(PlatformApiError);
      expect((err as PlatformApiError).status).toBe(500);
      expect(count("GET /pulls")).toBe(1);
      expect(count(`DELETE /git/refs/heads/${BRANCH}`)).toBe(1);
    });

    it("scheitert die Suche selbst, bleibt der Branch (Zustand unklar) und der Fehler nennt ihn", async () => {
      let posted = false;
      setup({ pr: () => ((posted = true), HttpResponse.json({ message: "x" }, { status: 500 })) });
      server.use(http.get(`${base}/pulls`, () => HttpResponse.json({ message: "x" }, { status: 500 })));
      const err = await makeAdapter().createChangeRequest(conn, REPO, request).catch((e: unknown) => e);
      expect(posted).toBe(true);
      expect(err).toBeInstanceOf(PlatformLeftoverBranchError);
      expect(count(`DELETE /git/refs/heads/${BRANCH}`)).toBe(0);
    });

    it("eindeutige Ablehnung (403): keine Suche, direkt Cleanup", async () => {
      setup({ pr: () => HttpResponse.json({ message: "Resource not accessible by integration" }, { status: 403 }) });
      await expect(makeAdapter().createChangeRequest(conn, REPO, request)).rejects.toBeInstanceOf(PlatformPermissionError);
      expect(count("GET /pulls")).toBe(0);
      expect(count(`DELETE /git/refs/heads/${BRANCH}`)).toBe(1);
    });
  });

  describe("G5: vorhandene Dateien live prüfen", () => {
    it("liest jede Datei zum Base-Commit (404 zulässig) und schreibt alles, wenn nichts da ist", async () => {
      setup();
      await makeAdapter().createChangeRequest(conn, REPO, request);
      expect(contentRefs).toEqual([HEAD_SHA, HEAD_SHA]);
      expect(seen.filter((x) => x.startsWith("GET /contents/"))).toEqual([
        "GET /contents/renovate.json",
        "GET /contents/.github/workflows/build-check.yml",
      ]);
    });

    it("gleicher Inhalt wird übersprungen", async () => {
      let treeBody: { tree: { path: string }[] } | undefined;
      setup({ existing: { "renovate.json": "{}" } });
      server.use(
        http.post(`${base}/git/trees`, async ({ request: r }) => {
          treeBody = (await r.clone().json()) as { tree: { path: string }[] };
          return HttpResponse.json({ sha: "t1" }, { status: 201 });
        }),
      );
      await makeAdapter().createChangeRequest(conn, REPO, request);
      expect(treeBody!.tree.map((t) => t.path)).toEqual([".github/workflows/build-check.yml"]);
    });

    it("alles schon gleich: PlatformFilesExistError ohne Schreibaufruf", async () => {
      setup({ existing: { "renovate.json": "{}", ".github/workflows/build-check.yml": "name: x\n" } });
      const err = await makeAdapter().createChangeRequest(conn, REPO, request).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(PlatformFilesExistError);
      expect(err).toMatchObject({ identical: ["renovate.json", ".github/workflows/build-check.yml"], differing: [] });
      expect(seen.filter((x) => x.startsWith("POST"))).toEqual([]);
    });

    it("abweichender Inhalt: PlatformFilesExistError, nichts wird überschrieben", async () => {
      setup({ existing: { ".github/workflows/build-check.yml": "name: eigene CI\n" } });
      const err = await makeAdapter().createChangeRequest(conn, REPO, request).catch((e: unknown) => e);
      expect(err).toMatchObject({ identical: [], differing: [".github/workflows/build-check.yml"] });
      expect(seen.filter((x) => x.startsWith("POST"))).toEqual([]);
    });
  });

  describe("G6: Vorlagen", () => {
    const templatePath = `${API}/repos/Krinke-IT-Consulting/renovate/contents/templates/renovate.json`;
    const message = "Das Vorlagen-Repo Krinke-IT-Consulting/renovate ist für die GitHub App nicht lesbar.";

    it("404 mit gemerkter Installation: Scope verwerfen und einmal neu auflösen", async () => {
      let listings = 0;
      let reads = 0;
      server.use(
        http.get(`${API}/app/installations`, () => {
          listings++;
          return HttpResponse.json(installations);
        }),
        // Zweiter Abruf: 404 (die gemerkte Installation enthält das Repo nicht mehr), danach wieder lesbar.
        http.get(templatePath, () =>
          ++reads === 2 ? HttpResponse.json({ message: "Not Found" }, { status: 404 }) : HttpResponse.json(fileBody("{}")),
        ),
      );
      let now = 1_000_000;
      const adapter = makeAdapter(() => now);
      await adapter.readTemplate("renovate-config");
      expect(listings).toBe(1);
      now += 6 * 60_000;
      await expect(adapter.readTemplate("renovate-config")).resolves.toEqual({ path: "renovate.json", content: "{}" });
      expect(listings).toBe(2);
      expect(reads).toBe(3);
    });

    it("bleibt es bei 404, gibt es den eigenen Text und genau eine neue Auflösung", async () => {
      let listings = 0;
      server.use(
        http.get(`${API}/app/installations`, () => {
          listings++;
          return HttpResponse.json(installations);
        }),
        http.get(templatePath, () => HttpResponse.json({ message: "Not Found" }, { status: 404 })),
      );
      const adapter = makeAdapter();
      await expect(adapter.readTemplate("renovate-config")).rejects.toMatchObject({ userMessage: message });
      expect(listings).toBe(1);
      await expect(adapter.readTemplate("renovate-config")).rejects.toBeInstanceOf(PlatformRejectedError);
      expect(listings).toBe(2);
    });

    it("gemerkter Scope, Repo plötzlich 404: einmal neu auflösen, dann der eigene Text", async () => {
      let listings = 0;
      let readable = true;
      server.use(
        http.get(`${API}/app/installations`, () => {
          listings++;
          return HttpResponse.json(installations);
        }),
        http.get(templatePath, () => (readable ? HttpResponse.json(fileBody("{}")) : HttpResponse.json({ message: "Not Found" }, { status: 404 }))),
      );
      let now = 1_000_000;
      const adapter = makeAdapter(() => now);
      await adapter.readTemplate("renovate-config");
      readable = false;
      now += 6 * 60_000;
      await expect(adapter.readTemplate("renovate-config")).rejects.toMatchObject({ userMessage: message });
      expect(listings).toBe(2);
    });
  });

  describe("G8: Meldungen", () => {
    it("leeres Repo: eigener Text statt Status 409", async () => {
      setup({ commitsMain: () => HttpResponse.json({ message: "Git Repository is empty." }, { status: 409 }) });
      await expect(makeAdapter().createChangeRequest(conn, REPO, request)).rejects.toMatchObject({
        name: "PlatformRejectedError",
        userMessage: "Das Repo hat noch keinen Commit; ein Onboarding-PR ist erst danach möglich.",
      });
    });

    it("404 beim Schreiben: Repo nicht gefunden oder nicht in der Installation, kein Rechtefehler", async () => {
      setup({ tree: () => HttpResponse.json({ message: "Not Found" }, { status: 404 }) });
      const err = await makeAdapter().createChangeRequest(conn, REPO, request).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(PlatformRejectedError);
      expect(err).not.toBeInstanceOf(PlatformPermissionError);
      expect((err as PlatformRejectedError).userMessage).toBe("Repo nicht gefunden oder nicht in der Installation.");
    });

    it("403 mit Ruleset- oder Branch-Schutz-Text: Meldung zur Branch-Regel", async () => {
      for (const text of [
        "Repository rule violations found\n\nCannot create ref due to creations being restricted.",
        "Protected branch update failed",
      ]) {
        setup({ refStatuses: [403], tree: undefined });
        server.use(http.post(`${base}/git/refs`, () => HttpResponse.json({ message: text }, { status: 403 })));
        await expect(makeAdapter().createChangeRequest(conn, REPO, request)).rejects.toMatchObject({
          userMessage: "Eine Branch-Regel verhindert das Anlegen von `renovate-platform/…`.",
        });
      }
    });

    it("akzeptiert eine ConnectionRef (ohne Owner-Typ) für getHeadSha", async () => {
      setup();
      const ref = { externalConnectionId: String(INSTALLATION_ID), ownerName: "Krinke-IT-Consulting" };
      await expect(makeAdapter().getHeadSha(ref, REPO)).resolves.toBe(HEAD_SHA);
    });
  });
});

describe("Merge: Voraussetzungen, Merge, Methoden", () => {
  const base = `${API}/repos/${REPO.fullName}`;
  const PR_NUMBER = 7;
  const SHA = "7".padStart(40, "a");
  const sleeps: number[] = [];

  function adapterWithSleep() {
    sleeps.length = 0;
    return new GitHubAdapter({
      appId: "12345",
      privateKey: PRIVATE_KEY,
      appSlug: APP_SLUG,
      cache: new MemoryHttpCache(),
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
  }

  function pullBody(over: { mergeable?: boolean | null; state?: string; merged_at?: string | null } = {}) {
    return {
      number: PR_NUMBER,
      state: over.state ?? "open",
      merged_at: over.merged_at ?? null,
      mergeable: over.mergeable === undefined ? true : over.mergeable,
      head: { ref: "renovate/x", sha: SHA },
    };
  }

  /** Antworten für Check-Runs, Commit-Status und Repo-Einstellungen am Head-Commit. */
  function useChecks(
    repoBody: Record<string, unknown> = { allow_squash_merge: true, allow_merge_commit: true, allow_rebase_merge: false },
  ) {
    server.use(
      http.get(`${base}/commits/${SHA}/check-runs`, () =>
        HttpResponse.json({ total_count: 1, check_runs: [{ status: "completed", conclusion: "success" }] }),
      ),
      http.get(`${base}/commits/${SHA}/status`, () => HttpResponse.json({ state: "success", statuses: [] })),
      http.get(base, () => HttpResponse.json(repoBody)),
    );
  }

  describe("getMergeReadiness", () => {
    it("liest PR, CI und erlaubte Methoden in Vorzugsreihenfolge, ohne ETag-Anfrage", async () => {
      const seen: (string | null)[] = [];
      server.use(
        http.get(`${base}/pulls/${PR_NUMBER}`, ({ request }) => {
          seen.push(request.headers.get("if-none-match"));
          return HttpResponse.json(pullBody(), { headers: { etag: '"p"' } });
        }),
      );
      useChecks({ allow_squash_merge: false, allow_merge_commit: true, allow_rebase_merge: true });
      const adapter = adapterWithSleep();
      const first = await adapter.getMergeReadiness(conn, REPO, PR_NUMBER);
      await adapter.getMergeReadiness(conn, REPO, PR_NUMBER);
      expect(first).toEqual({ state: "open", headSha: SHA, mergeable: true, ci: "success", methods: ["merge", "rebase"], blockedReason: null });
      expect(seen).toEqual([null, null]);
      expect(sleeps).toEqual([]);
    });

    it("mergeable null, danach true: wartet einmal 2 s und liest neu", async () => {
      const answers = [null, true];
      server.use(http.get(`${base}/pulls/${PR_NUMBER}`, () => HttpResponse.json(pullBody({ mergeable: answers.shift() }))));
      useChecks();
      const readiness = await adapterWithSleep().getMergeReadiness(conn, REPO, PR_NUMBER);
      expect(readiness.mergeable).toBe(true);
      expect(sleeps).toEqual([2000]);
      expect(answers).toEqual([]);
    });

    it("mergeable bleibt null: genau ein zweites Lesen, Ergebnis null", async () => {
      let reads = 0;
      server.use(
        http.get(`${base}/pulls/${PR_NUMBER}`, () => {
          reads++;
          return HttpResponse.json(pullBody({ mergeable: null }));
        }),
      );
      useChecks();
      const readiness = await adapterWithSleep().getMergeReadiness(conn, REPO, PR_NUMBER);
      expect(readiness.mergeable).toBeNull();
      expect(reads).toBe(2);
      expect(sleeps).toEqual([2000]);
    });

    it("nicht offener PR: kein CI- und kein Repo-Abruf, gemergt wird erkannt", async () => {
      server.use(
        http.get(`${base}/pulls/${PR_NUMBER}`, () =>
          HttpResponse.json(pullBody({ state: "closed", merged_at: "2026-10-03T08:00:00Z", mergeable: null })),
        ),
      );
      const readiness = await adapterWithSleep().getMergeReadiness(conn, REPO, PR_NUMBER);
      expect(readiness).toMatchObject({ state: "merged", ci: "none", methods: [] });
      expect(sleeps).toEqual([]);
    });

    it("Repo ohne Auskunft zu Methoden (Recht fehlt): unbekannt (null), nicht leer", async () => {
      server.use(http.get(`${base}/pulls/${PR_NUMBER}`, () => HttpResponse.json(pullBody())));
      useChecks({});
      expect((await adapterWithSleep().getMergeReadiness(conn, REPO, PR_NUMBER)).methods).toBeNull();
    });

    it.each([
      ["blocked", undefined, "protection"],
      ["draft", undefined, "draft"],
      ["clean", true, null],
      ["behind", undefined, null],
      ["unstable", undefined, null],
    ])("mergeable_state %s (draft=%s) -> blockedReason %s, ohne Zusatzanfrage", async (mergeableState, draft, expected) => {
      let pullReads = 0;
      server.use(
        http.get(`${base}/pulls/${PR_NUMBER}`, () => {
          pullReads++;
          return HttpResponse.json({ ...pullBody(), mergeable_state: mergeableState, draft: draft === true && mergeableState === "draft" });
        }),
      );
      useChecks();
      expect((await adapterWithSleep().getMergeReadiness(conn, REPO, PR_NUMBER)).blockedReason).toBe(expected);
      expect(pullReads).toBe(1);
    });

    it("draft=true im PR gilt als Entwurf, auch ohne mergeable_state", async () => {
      server.use(http.get(`${base}/pulls/${PR_NUMBER}`, () => HttpResponse.json({ ...pullBody(), draft: true })));
      useChecks();
      expect((await adapterWithSleep().getMergeReadiness(conn, REPO, PR_NUMBER)).blockedReason).toBe("draft");
    });
  });

  describe("mergeChangeRequest", () => {
    const request = { sha: SHA, method: "squash" as const };
    const mergeUrl = `${base}/pulls/${PR_NUMBER}/merge`;

    it("200: PUT mit sha und merge_method", async () => {
      let body: unknown;
      server.use(
        http.put(mergeUrl, async ({ request: r }) => {
          body = await r.json();
          return HttpResponse.json({ sha: "m", merged: true, message: "Pull Request successfully merged" });
        }),
      );
      await expect(adapterWithSleep().mergeChangeRequest(conn, REPO, PR_NUMBER, request)).resolves.toBeUndefined();
      expect(body).toEqual({ sha: SHA, merge_method: "squash" });
    });

    it("405: abgelehnt mit fester Meldung, ohne Text der Plattform", async () => {
      server.use(http.put(mergeUrl, () => HttpResponse.json({ message: 'Required status check "x" is expected.' }, { status: 405 })));
      const err = await adapterWithSleep().mergeChangeRequest(conn, REPO, PR_NUMBER, request).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(PlatformRejectedError);
      expect((err as PlatformRejectedError).userMessage).toContain("lehnt den Merge ab");
      expect(String((err as Error).message)).not.toContain("status check");
    });

    it("409: PlatformHeadChangedError", async () => {
      server.use(http.put(mergeUrl, () => HttpResponse.json({ message: "Head branch was modified." }, { status: 409 })));
      await expect(adapterWithSleep().mergeChangeRequest(conn, REPO, PR_NUMBER, request)).rejects.toBeInstanceOf(PlatformHeadChangedError);
    });

    it("422: abgelehnt mit festem Text", async () => {
      server.use(http.put(mergeUrl, () => HttpResponse.json({ message: "Validation Failed" }, { status: 422 })));
      const err = await adapterWithSleep().mergeChangeRequest(conn, REPO, PR_NUMBER, request).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(PlatformRejectedError);
      expect((err as PlatformRejectedError).userMessage).toContain("ungültig");
    });

    it.each([
      [405, "Base branch was modified. Review and try the merge again.", "Ziel-Branch hat sich gerade geändert"],
      [405, "Head branch is not up to date with the base branch.", "Branch muss erst aktualisiert werden"],
      [405, "Draft pull requests are not mergeable.", "ein Entwurf"],
      [405, "Merge commits are not allowed on this repository.", "Merge-Methode ist im Repo nicht erlaubt"],
      [422, "Squash merges are not allowed on this repository.", "Merge-Methode ist im Repo nicht erlaubt"],
    ])("%i %s: eigene Meldung ohne Text der Plattform", async (status, message, expected) => {
      server.use(http.put(mergeUrl, () => HttpResponse.json({ message }, { status })));
      const err = await adapterWithSleep().mergeChangeRequest(conn, REPO, PR_NUMBER, request).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(PlatformRejectedError);
      expect((err as PlatformRejectedError).userMessage).toContain(expected);
      expect((err as Error).message).not.toContain(message);
    });

    it("fehlendes Workflow-Recht wird vor 405, 409 und 422 erkannt", async () => {
      const message =
        "refusing to allow a GitHub App to create or update workflow `.github/workflows/x.yml` without `workflows` permission";
      for (const status of [403, 405, 409, 422]) {
        server.use(http.put(mergeUrl, () => HttpResponse.json({ message }, { status })));
        const err = await adapterWithSleep().mergeChangeRequest(conn, REPO, PR_NUMBER, request).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(PlatformPermissionError);
        expect((err as PlatformPermissionError).userMessage).toContain("Workflows");
        expect((err as Error).message).not.toContain("x.yml");
      }
    });

    it("ein Check namens workflow in einer 405-Meldung ist kein Rechtefehler", async () => {
      server.use(
        http.put(mergeUrl, () =>
          HttpResponse.json({ message: 'Required status check "workflow / build" is expected.' }, { status: 405 }),
        ),
      );
      await expect(adapterWithSleep().mergeChangeRequest(conn, REPO, PR_NUMBER, request)).rejects.toBeInstanceOf(PlatformRejectedError);
    });

    it("403: Branch-Schutz-Text abgelehnt, sonst fehlende Schreibrechte, sekundäres Limit eine Pause", async () => {
      server.use(http.put(mergeUrl, () => HttpResponse.json({ message: "Protected branch update failed" }, { status: 403 })));
      await expect(adapterWithSleep().mergeChangeRequest(conn, REPO, PR_NUMBER, request)).rejects.toBeInstanceOf(PlatformRejectedError);
      server.use(http.put(mergeUrl, () => HttpResponse.json({ message: "Resource not accessible by integration" }, { status: 403 })));
      await expect(adapterWithSleep().mergeChangeRequest(conn, REPO, PR_NUMBER, request)).rejects.toBeInstanceOf(PlatformPermissionError);
      server.use(
        http.put(mergeUrl, () =>
          HttpResponse.json({ message: "You have exceeded a secondary rate limit." }, { status: 403, headers: { "retry-after": "30" } }),
        ),
      );
      await expect(adapterWithSleep().mergeChangeRequest(conn, REPO, PR_NUMBER, request)).rejects.toBeInstanceOf(RateLimitPause);
    });

    it("pausiert bei knappem Kontingent, ohne den nächsten Merge zu senden", async () => {
      let puts = 0;
      server.use(
        http.put(mergeUrl, () => {
          puts++;
          return HttpResponse.json({ merged: true }, { headers: rateHeaders() });
        }),
      );
      const adapter = adapterWithSleep();
      rate.remaining = 100;
      await adapter.mergeChangeRequest(conn, REPO, PR_NUMBER, request);
      await expect(adapter.mergeChangeRequest(conn, REPO, PR_NUMBER, request)).rejects.toBeInstanceOf(RateLimitPause);
      expect(puts).toBe(1);
    });
  });

  describe("Methoden im Repo-Abgleich", () => {
    it("übernimmt allow_*-Felder der Listenantwort ohne Zusatzabruf", async () => {
      server.use(
        etagged("/installation/repositories", '"m1"', {
          total_count: 1,
          repositories: [
            {
              id: 1,
              full_name: REPO.fullName,
              default_branch: "main",
              archived: false,
              private: true,
              allow_squash_merge: false,
              allow_merge_commit: true,
              allow_rebase_merge: true,
            },
          ],
        }),
      );
      const repos = await adapterWithSleep().listRepositories(conn);
      expect(repos[0]?.mergeMethods).toEqual(["merge", "rebase"]);
      expect(hits).toEqual(["GET /installation/repositories"]);
    });

    it("readMergeMethods entscheidet je Repo über den Einzelabruf", async () => {
      server.use(
        etagged("/installation/repositories", '"m3"', {
          total_count: 2,
          repositories: [
            { id: 1, full_name: REPO.fullName, default_branch: "main", archived: false, private: true },
            { id: 2, full_name: "Krinke-IT-Consulting/ruhig", default_branch: "main", archived: false, private: true },
          ],
        }),
        etagged(`/repos/${REPO.fullName}`, '"d2"', { allow_squash_merge: true, allow_merge_commit: true, allow_rebase_merge: true }),
      );
      const repos = await adapterWithSleep().listRepositories(conn, {
        readMergeMethods: (r) => r.fullName === REPO.fullName,
      });
      expect(repos.map((r) => r.mergeMethods)).toEqual([["squash", "merge", "rebase"], undefined]);
      expect(hits.filter((h) => h.includes("/ruhig"))).toEqual([]);
    });

    it("fehlen die Felder, liest er GET repos/{o}/{r}; archivierte Repos und Fehler bleiben unbestimmt", async () => {
      server.use(
        etagged("/installation/repositories", '"m2"', {
          total_count: 3,
          repositories: [
            { id: 1, full_name: REPO.fullName, default_branch: "main", archived: false, private: true },
            { id: 2, full_name: "Krinke-IT-Consulting/old", default_branch: "main", archived: true, private: true },
            { id: 3, full_name: "Krinke-IT-Consulting/kaputt", default_branch: "main", archived: false, private: true },
          ],
        }),
        etagged(`/repos/${REPO.fullName}`, '"d1"', { allow_squash_merge: true, allow_merge_commit: false, allow_rebase_merge: false }),
        http.get(`${API}/repos/Krinke-IT-Consulting/kaputt`, () => HttpResponse.json({ message: "boom" }, { status: 500 })),
      );
      const repos = await adapterWithSleep().listRepositories(conn);
      expect(repos.map((r) => r.mergeMethods)).toEqual([["squash"], undefined, undefined]);
      expect(hits.filter((h) => h.includes("/old"))).toEqual([]);
    });
  });
});
