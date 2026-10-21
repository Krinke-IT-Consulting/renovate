import { App } from "@octokit/app";
import { parseUpdatePackages } from "@/domain/pull-requests";
import { PlatformApiError, PlatformPermissionError, RateLimitPause } from "../errors";
import type { HttpCache } from "../http-cache";
import {
  DEPENDENCY_DASHBOARD_TITLE,
  NON_UPDATE_BRANCHES,
  RENOVATE_CONFIG_PATHS,
  UPDATE_BRANCH_PREFIX,
} from "../renovate-files";
import type {
  ChangeRequestRef,
  ChangeRequestState,
  ChangeStatus,
  ConnectionRef,
  NewChangeRequest,
  PlatformAdapter,
  PlatformConnection,
  PlatformRepository,
  RepositoryContentState,
  RepositoryRef,
  TemplateFile,
  TemplateName,
  UpdateChangeRequest,
} from "../types";
import {
  BUILD_CHECK_CALLER_PATH,
  BUILD_CHECK_SELF_PATH,
  BUILD_CHECK_SOURCE_REPO,
  TEMPLATE_SOURCES,
  callsCentralBuildCheck,
  callsLocalBuildCheck,
  isBuildCheckSourceRepo,
} from "./build-check";
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
/** Vorlagen ändern sich selten; ein kurzer Cache im Prozess spart Anfragen bei Serien von Rollouts. */
export const TEMPLATE_CACHE_MS = 5 * 60 * 1000;
const WORKFLOW_PERMISSION_MESSAGE =
  "Der GitHub App fehlt in diesem Repo das Schreibrecht auf Workflows. Bitte in den App-Einstellungen ergänzen.";
const WRITE_PERMISSION_MESSAGE =
  "Der GitHub App fehlen in diesem Repo Schreibrechte (Inhalte, Pull Requests oder Workflows). Bitte in den App-Einstellungen ergänzen.";
const SAFE_BRANCH = /^[A-Za-z0-9._/-]+$/;

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
  message?: unknown;
  response?: { headers?: HeaderBag; data?: { message?: unknown } };
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
interface ApiSha {
  sha: string;
}
interface ApiCommit {
  sha: string;
  tree: { sha: string };
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
  private templateScope: string | undefined;
  private readonly templates = new Map<string, { at: number; file: TemplateFile }>();

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
    // Das Quell-Repo des Build-Checks ruft den Workflow lokal auf (`build-check-self.yml`).
    if (
      !hasCallerFile &&
      rootDirs.has(".github") &&
      isBuildCheckSourceRepo(repo.fullName)
    ) {
      const selfFile = await this.get<ApiFile>(
        scope,
        "GET /repos/{owner}/{repo}/contents/{path}",
        { owner, repo: name, ref: headSha, path: BUILD_CHECK_SELF_PATH },
        { tolerate: [404], noCache: true },
      );
      if (selfFile?.content && selfFile.encoding === "base64") {
        hasCallerFile = callsLocalBuildCheck(
          Buffer.from(selfFile.content, "base64").toString("utf8"),
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
    conn: ConnectionRef,
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


  async findOpenChangeRequest(
    conn: ConnectionRef,
    repo: RepositoryRef,
    branch: string,
  ): Promise<ChangeRequestRef | null> {
    const { owner, name } = split(repo.fullName);
    const pulls = await this.get<ApiPull[]>(
      conn.externalConnectionId,
      "GET /repos/{owner}/{repo}/pulls",
      { owner, repo: name, state: "open", head: `${owner}:${branch}`, per_page: PAGE_SIZE },
    );
    const hit = pulls.find((p) => p.head.ref === branch);
    return hit ? { number: hit.number, url: hit.html_url } : null;
  }

  async deleteBranch(
    conn: ConnectionRef,
    repo: RepositoryRef,
    branch: string,
  ): Promise<void> {
    assertSafeBranch(branch);
    const { owner, name } = split(repo.fullName);
    // Der Branchname steht unkodiert im Pfad (Schrägstriche gehören dazu). GitHub meldet einen
    // fehlenden Ref beim Löschen mit 422, teils 404: beides ist hier kein Fehler.
    await this.write(
      conn.externalConnectionId,
      `DELETE /repos/{owner}/{repo}/git/refs/heads/${branch}`,
      { owner, repo: name },
      { tolerate: [404, 422] },
    );
  }

  /**
   * Ein Commit über die Git-Data-API: Tree auf dem Base-Commit (die Dateiinhalte gehen direkt in den
   * Tree, GitHub legt die Blobs dabei selbst an, das spart je Datei eine Anfrage), Commit, Ref,
   * danach der Pull Request. Scheitert ein Schritt nach dem Anlegen des Refs, wird der Branch
   * gelöscht. Ein Rest-Branch eines früheren, abgebrochenen oder geschlossenen Rollouts (der Name
   * ist eindeutig unserer) wird ersetzt.
   */
  async createChangeRequest(
    conn: ConnectionRef,
    repo: RepositoryRef,
    request: NewChangeRequest,
  ): Promise<ChangeRequestRef> {
    assertSafeBranch(request.branch);
    const { owner, name } = split(repo.fullName);
    const scope = conn.externalConnectionId;
    const base = { owner, repo: name };

    const baseSha = await this.getHeadSha(
      { ...conn, ownerType: "organization" },
      { fullName: repo.fullName, defaultBranch: request.baseBranch },
    );
    if (!baseSha) {
      throw new PlatformApiError(409, "POST", `/repos/${repo.fullName}/git/commits`);
    }
    const baseCommit = await this.get<ApiCommit>(
      scope,
      "GET /repos/{owner}/{repo}/git/commits/{commit_sha}",
      { ...base, commit_sha: baseSha },
      { noCache: true },
    );
    const tree = await this.write<ApiSha>(scope, "POST /repos/{owner}/{repo}/git/trees", {
      ...base,
      base_tree: baseCommit.tree.sha,
      tree: request.files.map((f) => ({
        path: f.path,
        mode: "100644",
        type: "blob",
        content: f.content,
      })),
    });
    const commit = await this.write<ApiSha>(scope, "POST /repos/{owner}/{repo}/git/commits", {
      ...base,
      message: request.title,
      tree: tree.sha,
      parents: [baseSha],
    });

    const createRef = () =>
      this.write<ApiSha>(scope, "POST /repos/{owner}/{repo}/git/refs", {
        ...base,
        ref: `refs/heads/${request.branch}`,
        sha: commit.sha,
      });
    try {
      await createRef();
    } catch (e) {
      if (!(e instanceof PlatformApiError) || e.status !== 422) throw e;
      // Der Branch besteht schon (Rest eines früheren Rollouts): ersetzen und noch einmal anlegen.
      await this.deleteBranch(conn, repo, request.branch);
      await createRef();
    }

    try {
      const pr = await this.write<ApiPull>(scope, "POST /repos/{owner}/{repo}/pulls", {
        ...base,
        title: request.title,
        body: request.body,
        head: request.branch,
        base: request.baseBranch,
      });
      return { number: pr.number, url: pr.html_url };
    } catch (e) {
      try {
        await this.deleteBranch(conn, repo, request.branch);
      } catch {
        // Der ursprüngliche Fehler zählt; ein Rest-Branch wird beim nächsten Rollout ersetzt.
      }
      throw e;
    }
  }

  async readTemplate(name: TemplateName): Promise<TemplateFile> {
    const entry = TEMPLATE_SOURCES[name];
    const cached = this.templates.get(name);
    if (cached && this.now() - cached.at < TEMPLATE_CACHE_MS) return cached.file;

    const [owner = "", repoName = ""] = BUILD_CHECK_SOURCE_REPO.split("/");
    const path = `/repos/${BUILD_CHECK_SOURCE_REPO}/contents/${entry.source}`;
    if (!this.templateScope) {
      const connections = await this.listConnections();
      const hit = connections.find(
        (c) => c.ownerName.toLowerCase() === owner.toLowerCase(),
      );
      // Ohne Installation, die das Vorlagen-Repo enthält, gibt es keine Vorlage.
      if (!hit) throw new PlatformApiError(404, "GET", path);
      this.templateScope = hit.externalConnectionId;
    }
    // Ohne `ref` liest GitHub den Default-Branch. Der Abruf ist bedingt (ETag).
    const file = await this.get<ApiFile>(
      this.templateScope,
      "GET /repos/{owner}/{repo}/contents/{path}",
      { owner, repo: repoName, path: entry.source },
    );
    if (!file.content || file.encoding !== "base64") {
      throw new PlatformApiError(0, "GET", path);
    }
    const result: TemplateFile = {
      path: entry.target,
      content: Buffer.from(file.content, "base64").toString("utf8"),
    };
    this.templates.set(name, { at: this.now(), file: result });
    return result;
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

    const octokit = await this.authenticate(scope, method, route, rest);

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

  /**
   * Token-Beschaffung außerhalb der Statustoleranz: Ein 404 beim Token-Austausch (Installation
   * entfernt) ist immer ein Fehler und darf nie als "Datei fehlt" durchgehen.
   * getInstallationOctokit ist träge: Das Token wird erst bei der ersten Anfrage geholt und ein
   * Fehler käme als gewöhnlicher Status der Anfrage zurück. Deshalb vorab ausdrücklich
   * authentifizieren (das Token wird zwischengespeichert, die Anfrage nutzt es danach).
   */
  private async authenticate(
    scope: string,
    method: string,
    route: string,
    params: Params,
  ): Promise<Pick<App["octokit"], "request">> {
    try {
      if (scope === APP_SCOPE) return this.app.octokit;
      const installation = await this.app.getInstallationOctokit(Number(scope));
      await installation.auth({ type: "installation" });
      return installation;
    } catch (err) {
      const status = (err as ErrorLike | null)?.status;
      // Bewusst ohne Ursache, Header und Meldung des Originals (könnte Anmeldedaten enthalten).
      throw new PlatformApiError(
        typeof status === "number" ? status : 0,
        method,
        expandPath(route, params),
      );
    }
  }

  /**
   * Schreibende Anfrage (kein ETag, kein Cache). Fehlende Rechte (403 ohne Kontingent-Signal, 404,
   * oder eine Meldung zu Workflows) werden zu `PlatformPermissionError`; sonst gilt wie beim Lesen:
   * Fehler tragen nur Status, Methode und Pfad.
   */
  private async write<T>(
    scope: string,
    route: string,
    params: Record<string, unknown>,
    opts?: { tolerate?: readonly number[] },
  ): Promise<T> {
    this.assertNotPaused(scope);
    const method = route.split(" ")[0] ?? "POST";
    const pathParams = params as Params;
    const octokit = await this.authenticate(scope, method, route, pathParams);
    try {
      const res = await octokit.request(route, params);
      this.noteRateLimit(scope, res.headers as HeaderBag);
      return res.data as T;
    } catch (err) {
      const e = err as ErrorLike;
      const status = typeof e?.status === "number" ? e.status : 0;
      const headers = e?.response?.headers;
      if (headers) this.noteRateLimit(scope, headers);
      if (opts?.tolerate?.includes(status)) return undefined as T;
      if ((status === 403 || status === 429) && headers)
        this.throwIfRateLimited(scope, headers);
      // Die Meldung der Plattform wird nur ausgewertet, nie weitergegeben.
      const text = `${String(e?.response?.data?.message ?? "")} ${String(e?.message ?? "")}`;
      if (/workflow/i.test(text) && status >= 400 && status < 500) {
        throw new PlatformPermissionError(WORKFLOW_PERMISSION_MESSAGE);
      }
      if (status === 403 || status === 404) {
        throw new PlatformPermissionError(WRITE_PERMISSION_MESSAGE);
      }
      throw new PlatformApiError(status, method, expandPath(route, pathParams));
    }
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

function assertSafeBranch(branch: string): void {
  if (!SAFE_BRANCH.test(branch) || branch.includes("..")) {
    throw new PlatformApiError(0, "POST", "/git/refs");
  }
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
