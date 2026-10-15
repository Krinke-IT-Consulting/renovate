import { App } from "@octokit/app";
import { parseUpdatePackages } from "@/domain/pull-requests";
import { PlatformApiError, RateLimitPause } from "../errors";
import type { HttpCache } from "../http-cache";
import {
  DEPENDENCY_DASHBOARD_TITLE,
  NON_UPDATE_BRANCHES,
  RENOVATE_CONFIG_PATHS,
  UPDATE_BRANCH_PREFIX,
} from "../renovate-files";
import type {
  ChangeRequestState,
  ChangeStatus,
  PlatformAdapter,
  PlatformConnection,
  PlatformRepository,
  RepositoryContentState,
  RepositoryRef,
  UpdateChangeRequest,
} from "../types";
import { BUILD_CHECK_CALLER_PATH, callsCentralBuildCheck } from "./build-check";
import { deriveCiStatus } from "./ci-status";

/**
 * Der Abgleich pausiert, wenn das Rest-Kontingent unter diesen Anteil des Limits fällt, mindestens
 * aber unter die Untergrenze (design.md, Risiko Rate-Limit): `remaining < max(20 % von limit, 400)`.
 */
export const RATE_LIMIT_PAUSE_FRACTION = 0.2;
export const RATE_LIMIT_PAUSE_FLOOR = 400;
const PAGE_SIZE = 100;
/** Ohne `x-ratelimit-reset` pausieren wir höchstens bis zum nächsten Durchlauf. */
const FALLBACK_PAUSE_MS = 5 * 60 * 1000;
const APP_SCOPE = "app";

export interface GitHubAdapterOptions {
  appId: string;
  /** PEM. Kommt vom Aufrufer (aus dem Env-Schema), nie direkt aus process.env. */
  privateKey: string;
  cache: HttpCache;
  /** Slug der App, z. B. "krinke-it-renovate". Fehlt er, wird er einmal per GET /app gelesen. */
  appSlug?: string;
  /** Nur für Tests: Uhr. */
  now?: () => number;
}

interface RateState {
  remaining: number;
  limit: number;
  resetAtMs: number;
}

type Params = Record<string, string | number | boolean | undefined>;
type HeaderBag = Record<string, string | number | undefined>;

interface ErrorLike {
  status?: unknown;
  response?: { headers?: HeaderBag };
}

// Ausschnitte der GitHub-Antworten, nur die genutzten Felder.
interface ApiInstallation {
  id: number;
  suspended_at?: string | null;
  account: { login: string; type: string } | null;
}
interface ApiRepository {
  id: number;
  full_name: string;
  default_branch: string;
  archived: boolean;
  private: boolean;
}
interface ApiContentEntry {
  name: string;
  type: string;
}
interface ApiFile {
  content?: string;
  encoding?: string;
}
interface ApiPull {
  number: number;
  title: string;
  html_url: string;
  body?: string | null;
  labels: { name: string }[];
  head: { ref: string; sha: string };
  user: { login: string } | null;
  created_at: string;
  updated_at: string;
  auto_merge?: unknown;
  state: string;
  merged_at?: string | null;
}
interface ApiIssue {
  title: string;
  html_url: string;
  user: { login: string } | null;
  pull_request?: unknown;
}

/**
 * GitHub-Implementierung des PlatformAdapter. Alle GitHub-Spezifika bleiben in diesem Ordner.
 *
 * - Anmeldung über die GitHub App (JWT -> Installation-Token, von @octokit/app zwischengespeichert).
 * - Jede Leseanfrage ist bedingt (If-None-Match, ETag aus `HttpCache`); 304 kostet kein Kontingent.
 * - Das Rest-Kontingent wird je Installation aus den Antwort-Headern mitgeführt. Fällt es unter
 *   `max(20 % des Limits, 400)`, wirft die nächste Anfrage `RateLimitPause`.
 * - Fehler tragen nur Status, Methode und Pfad, nie Header, Tokens oder Schlüssel.
 */
export class GitHubAdapter implements PlatformAdapter {
  private readonly app: App;
  private readonly cache: HttpCache;
  private readonly now: () => number;
  private readonly rate = new Map<string, RateState>();
  private appSlug: string | undefined;

  constructor(options: GitHubAdapterOptions) {
    // Env-Werte enthalten Zeilenumbrüche oft als "\n"-Text.
    const privateKey = options.privateKey.replace(/\\n/g, "\n");
    this.app = new App({ appId: options.appId, privateKey });
    this.cache = options.cache;
    this.appSlug = options.appSlug;
    this.now = options.now ?? Date.now;
  }

  async listConnections(): Promise<PlatformConnection[]> {
    const pages = await this.getPaged<ApiInstallation[]>(
      APP_SCOPE,
      "GET /app/installations",
      {},
    );
    return pages
      .flat()
      .filter((i) => i.account && !i.suspended_at)
      .map((i) => ({
        externalConnectionId: String(i.id),
        ownerName: i.account!.login,
        ownerType: i.account!.type === "Organization" ? "organization" : "user",
      }));
  }

  async listRepositories(
    conn: PlatformConnection,
  ): Promise<PlatformRepository[]> {
    const pages = await this.getPaged<{ repositories: ApiRepository[] }>(
      conn.externalConnectionId,
      "GET /installation/repositories",
      {},
      (body) => body.repositories.length,
    );
    return pages
      .flatMap((p) => p.repositories)
      .map((r) => ({
        externalId: String(r.id),
        fullName: r.full_name,
        defaultBranch: r.default_branch,
        archived: r.archived,
        private: r.private,
      }));
  }

  async getHeadSha(
    conn: PlatformConnection,
    repo: RepositoryRef,
  ): Promise<string | null> {
    const { owner, name } = split(repo.fullName);
    // Accept ...sha liefert nur die SHA als Text: kleine Antwort, ETag-fähig.
    // Leeres Repo: GitHub antwortet 409 ("Git Repository is empty"), teils 404 -> kein Inhalt.
    const sha = await this.get<string>(
      conn.externalConnectionId,
      "GET /repos/{owner}/{repo}/commits/{ref}",
      { owner, repo: name, ref: repo.defaultBranch, mediaType: "sha" },
      { tolerate: [404, 409] },
    );
    return sha === null ? null : String(sha).trim();
  }

  async getRepositoryState(
    conn: PlatformConnection,
    repo: RepositoryRef,
    headSha: string,
  ): Promise<RepositoryContentState> {
    const { owner, name } = split(repo.fullName);
    const scope = conn.externalConnectionId;
    const listDir = async (path: string): Promise<ApiContentEntry[] | null> => {
      const route = path
        ? "GET /repos/{owner}/{repo}/contents/{path}"
        : "GET /repos/{owner}/{repo}/contents";
      // Inhalte zu einem festen SHA ändern sich nie und werden je SHA nur einmal gelesen:
      // weder ETag-Anfrage noch Cache-Eintrag. 404 gilt nur für Unterordner, nie fürs Root-Listing
      // (dort wäre es ein echter Fehler, kein "Ordner fehlt").
      const params = { owner, repo: name, ref: headSha, ...(path ? { path } : {}) };
      const body = path
        ? await this.get<ApiContentEntry[] | ApiContentEntry>(scope, route, params, {
            tolerate: [404],
            noCache: true,
          })
        : await this.get<ApiContentEntry[]>(scope, route, params, { noCache: true });
      return Array.isArray(body) ? body : null;
    };

    const root = (await listDir("")) ?? [];
    const rootDirs = new Set(
      root.filter((e) => e.type === "dir").map((e) => e.name),
    );
    const rootFiles = new Set(
      root.filter((e) => e.type === "file").map((e) => e.name),
    );
    const dirCache = new Map<string, Set<string>>();
    const dirFiles = async (dir: string): Promise<Set<string>> => {
      let files = dirCache.get(dir);
      if (!files) {
        const entries = rootDirs.has(dir) ? ((await listDir(dir)) ?? []) : [];
        files = new Set(
          entries.filter((e) => e.type === "file").map((e) => e.name),
        );
        dirCache.set(dir, files);
      }
      return files;
    };

    // Renovates Reihenfolge einhalten; Verzeichnisse nur auflisten, wenn sie existieren.
    let configPath: string | null = null;
    for (const candidate of RENOVATE_CONFIG_PATHS) {
      const slash = candidate.lastIndexOf("/");
      const found =
        slash === -1
          ? rootFiles.has(candidate)
          : (await dirFiles(candidate.slice(0, slash))).has(
              candidate.slice(slash + 1),
            );
      if (found) {
        configPath = candidate;
        break;
      }
    }

    let hasCallerFile = false;
    if (rootDirs.has(".github")) {
      const file = await this.get<ApiFile>(
        scope,
        "GET /repos/{owner}/{repo}/contents/{path}",
        { owner, repo: name, ref: headSha, path: BUILD_CHECK_CALLER_PATH },
        { tolerate: [404], noCache: true },
      );
      if (file?.content && file.encoding === "base64") {
        hasCallerFile = callsCentralBuildCheck(
          Buffer.from(file.content, "base64").toString("utf8"),
        );
      }
    }
    return { configPath, hasBuildCheck: hasCallerFile };
  }

  /**
   * Annahmen zu Automerge: Ein PR gilt als automerge, wenn GitHubs eigenes Auto-Merge gesetzt ist
   * (`auto_merge` != null) oder der von Renovate geschriebene PR-Text die Zeile
   * "**Automerge**: Enabled" enthält. Der Text ist Renovates Fußzeilenformat (Stand 44.x) und
   * ist beim ersten echten Abgleich (Task 5.5) gegen echte PRs zu prüfen.
   */
  async listUpdatePullRequests(
    conn: PlatformConnection,
    repo: RepositoryRef,
  ): Promise<UpdateChangeRequest[]> {
    const { owner, name } = split(repo.fullName);
    const botLogin = `${await this.getAppSlug()}[bot]`;
    const pulls = await this.getPaged<ApiPull[]>(
      conn.externalConnectionId,
      "GET /repos/{owner}/{repo}/pulls",
      { owner, repo: name, state: "open", sort: "updated", direction: "desc" },
      (body) => body.length,
    );
    return pulls
      .flat()
      .filter(
        (p) =>
          // Rollout-PRs des Dashboards (`renovate-platform/…`, siehe ROLLOUT_BRANCH_PREFIX) tragen
          // nicht den Präfix `renovate/` und fallen damit ohnehin heraus; Renovates eigener
          // Onboarding-PR (`renovate/configure`) wird ausdrücklich ausgeschlossen.
          p.head.ref.startsWith(UPDATE_BRANCH_PREFIX) &&
          !(NON_UPDATE_BRANCHES as readonly string[]).includes(p.head.ref) &&
          p.user?.login === botLogin,
      )
      .map((p) => ({
        number: p.number,
        title: p.title,
        url: p.html_url,
        labels: p.labels.map((l) => l.name),
        headSha: p.head.sha,
        createdAt: p.created_at,
        updatedAt: p.updated_at,
        automerge:
          p.auto_merge != null ||
          /\*\*Automerge\*\*:\s*Enabled/i.test(p.body ?? ""),
        packageNames: parseUpdatePackages({
          body: p.body,
          title: p.title,
          branch: p.head.ref,
        }),
      }));
  }

  async getPullRequestState(
    conn: PlatformConnection,
    repo: RepositoryRef,
    number: number,
  ): Promise<ChangeRequestState> {
    const { owner, name } = split(repo.fullName);
    const pr = await this.get<ApiPull>(
      conn.externalConnectionId,
      "GET /repos/{owner}/{repo}/pulls/{pull_number}",
      { owner, repo: name, pull_number: number },
    );
    if (pr.merged_at) return { state: "merged", mergedAt: pr.merged_at };
    return { state: pr.state === "open" ? "open" : "closed", mergedAt: null };
  }

  async getChangeStatus(
    conn: PlatformConnection,
    repo: RepositoryRef,
    sha: string,
  ): Promise<ChangeStatus> {
    const { owner, name } = split(repo.fullName);
    const scope = conn.externalConnectionId;
    const [runs, combined] = await Promise.all([
      this.get<{ check_runs: { status: string; conclusion: string | null }[] }>(
        scope,
        "GET /repos/{owner}/{repo}/commits/{ref}/check-runs",
        { owner, repo: name, ref: sha, per_page: PAGE_SIZE },
      ),
      this.get<{ statuses: { state: string }[] }>(
        scope,
        "GET /repos/{owner}/{repo}/commits/{ref}/status",
        { owner, repo: name, ref: sha, per_page: PAGE_SIZE },
      ),
    ]);
    return {
      ci: deriveCiStatus(
        runs.check_runs.map((c) => ({
          status: c.status,
          conclusion: c.conclusion,
        })),
        combined.statuses.map((s) => ({ state: s.state })),
      ),
    };
  }

  async findDependencyDashboard(
    conn: PlatformConnection,
    repo: RepositoryRef,
  ): Promise<string | null> {
    const { owner, name } = split(repo.fullName);
    const botLogin = `${await this.getAppSlug()}[bot]`;
    // Die Issue-Liste enthält auch PRs (Feld pull_request); die filtern wir heraus. Das Dashboard
    // ist das älteste Issue des Bots: aufsteigend nach Erstellung lesen und nach dem ersten Treffer
    // nicht weiterblättern.
    for (let page = 1; ; page++) {
      const issues = await this.get<ApiIssue[]>(
        conn.externalConnectionId,
        "GET /repos/{owner}/{repo}/issues",
        {
          owner,
          repo: name,
          state: "open",
          creator: botLogin,
          sort: "created",
          direction: "asc",
          per_page: PAGE_SIZE,
          page,
        },
      );
      const hit = issues.find(
        (i) =>
          !i.pull_request &&
          i.title === DEPENDENCY_DASHBOARD_TITLE &&
          i.user?.login === botLogin,
      );
      if (hit) return hit.html_url;
      if (issues.length < PAGE_SIZE) return null;
    }
  }

  // ---------------------------------------------------------------------------------------------

  private async getAppSlug(): Promise<string> {
    if (!this.appSlug) {
      const app = await this.get<{ slug: string }>(APP_SCOPE, "GET /app", {});
      this.appSlug = app.slug;
    }
    return this.appSlug;
  }

  /** Seitenweise lesen, bis eine Seite weniger als PAGE_SIZE Einträge hat. */
  private async getPaged<T>(
    scope: string,
    route: string,
    params: Params,
    count: (body: T) => number = (b) => (Array.isArray(b) ? b.length : 0),
  ): Promise<T[]> {
    const pages: T[] = [];
    for (let page = 1; ; page++) {
      const body = await this.get<T>(scope, route, {
        ...params,
        per_page: PAGE_SIZE,
        page,
      });
      pages.push(body);
      if (count(body) < PAGE_SIZE) return pages;
    }
  }

  private get<T>(scope: string, route: string, params: Params): Promise<T>;
  private get<T>(
    scope: string,
    route: string,
    params: Params,
    opts: { tolerate: readonly number[]; noCache?: boolean },
  ): Promise<T | null>;
  private get<T>(
    scope: string,
    route: string,
    params: Params,
    opts: { noCache: true },
  ): Promise<T>;
  private async get<T>(
    scope: string,
    route: string,
    params: Params,
    opts?: { tolerate?: readonly number[]; noCache?: boolean },
  ): Promise<T | null> {
    this.assertNotPaused(scope);
    const key = cacheKey(scope, route, params);
    const cached = opts?.noCache ? null : await this.cache.get(key);
    const { mediaType, ...rest } = params;
    const request = {
      ...rest,
      headers: {
        ...(cached ? { "if-none-match": cached.etag } : {}),
        ...(mediaType === "sha"
          ? { accept: "application/vnd.github.sha" }
          : {}),
      },
    };
    const method = route.split(" ")[0] ?? "GET";

    // Token-Beschaffung außerhalb der Statustoleranz: Ein 404 beim Token-Austausch (Installation
    // entfernt) ist immer ein Fehler und darf nie als "Datei fehlt" durchgehen.
    // getInstallationOctokit ist träge: Das Token wird erst bei der ersten Anfrage geholt und ein
    // Fehler käme als gewöhnlicher Status der Anfrage zurück. Deshalb vorab ausdrücklich
    // authentifizieren (das Token wird zwischengespeichert, die Anfrage nutzt es danach).
    let octokit: Pick<App["octokit"], "request">;
    try {
      if (scope === APP_SCOPE) {
        octokit = this.app.octokit;
      } else {
        const installation = await this.app.getInstallationOctokit(Number(scope));
        await installation.auth({ type: "installation" });
        octokit = installation;
      }
    } catch (err) {
      const status = (err as ErrorLike | null)?.status;
      // Bewusst ohne Ursache, Header und Meldung des Originals (könnte Anmeldedaten enthalten).
      throw new PlatformApiError(
        typeof status === "number" ? status : 0,
        method,
        expandPath(route, rest),
      );
    }

    let data: unknown;
    let etag: string | undefined;
    try {
      const res = await octokit.request(route, request);
      this.noteRateLimit(scope, res.headers as HeaderBag);
      data = res.data;
      etag = header(res.headers as HeaderBag, "etag");
    } catch (err) {
      const e = err as ErrorLike;
      const status = typeof e?.status === "number" ? e.status : 0;
      const headers = e?.response?.headers;
      if (headers) this.noteRateLimit(scope, headers);
      if (status === 304 && cached) return cached.body as T;
      if (opts?.tolerate?.includes(status)) return null;
      if ((status === 403 || status === 429) && headers)
        this.throwIfRateLimited(scope, headers);
      // Bewusst ohne Ursache, Header und Meldung des Originals (könnte Anmeldedaten enthalten).
      throw new PlatformApiError(status, method, expandPath(route, rest));
    }
    if (etag && !opts?.noCache) await this.cache.set(key, etag, data);
    return data as T;
  }

  private noteRateLimit(scope: string, headers: HeaderBag): void {
    const remaining = Number(header(headers, "x-ratelimit-remaining"));
    const limit = Number(header(headers, "x-ratelimit-limit"));
    if (!Number.isFinite(remaining) || !Number.isFinite(limit) || limit <= 0)
      return;
    const reset = Number(header(headers, "x-ratelimit-reset"));
    const resetAtMs =
      Number.isFinite(reset) && reset > 0
        ? reset * 1000
        : this.now() + FALLBACK_PAUSE_MS;
    this.rate.set(scope, { remaining, limit, resetAtMs });
  }

  private assertNotPaused(scope: string): void {
    const state = this.rate.get(scope);
    if (!state) return;
    if (this.now() >= state.resetAtMs) {
      this.rate.delete(scope);
      return;
    }
    if (
      state.remaining <
      Math.max(state.limit * RATE_LIMIT_PAUSE_FRACTION, RATE_LIMIT_PAUSE_FLOOR)
    ) {
      throw new RateLimitPause(
        state.remaining,
        state.limit,
        new Date(state.resetAtMs),
      );
    }
  }

  /** 403/429 mit leerem Kontingent oder Retry-After sind Rate-Limits, keine Rechtefehler. */
  private throwIfRateLimited(scope: string, headers: HeaderBag): void {
    const remaining = Number(header(headers, "x-ratelimit-remaining"));
    const retryAfter = Number(header(headers, "retry-after"));
    if (remaining === 0 || Number.isFinite(retryAfter)) {
      const state = this.rate.get(scope);
      const resetAtMs = Number.isFinite(retryAfter)
        ? this.now() + retryAfter * 1000
        : (state?.resetAtMs ?? this.now() + FALLBACK_PAUSE_MS);
      const limit =
        state?.limit ?? (Number(header(headers, "x-ratelimit-limit")) || 0);
      this.rate.set(scope, { remaining: 0, limit: limit || 1, resetAtMs });
      throw new RateLimitPause(0, limit, new Date(resetAtMs));
    }
  }
}

function header(headers: HeaderBag, name: string): string | undefined {
  const v = headers[name];
  return v === undefined ? undefined : String(v);
}

function split(fullName: string): { owner: string; name: string } {
  const [owner, name] = fullName.split("/");
  return { owner: owner ?? "", name: name ?? "" };
}

function cacheKey(scope: string, route: string, params: Params): string {
  const sorted = Object.keys(params)
    .sort()
    .map((k) => `${k}=${String(params[k])}`)
    .join("&");
  return `${scope}|${route}|${sorted}`;
}

/** Pfad für Fehlermeldungen: Platzhalter eingesetzt, ohne Query und ohne Header. */
function expandPath(route: string, params: Params): string {
  const path = route.split(" ")[1] ?? route;
  return path.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? k));
}
