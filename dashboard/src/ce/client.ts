import { CeApiError } from "./errors";
import type {
  CeAddJobResult,
  CeJobReport,
  CeOrg,
  CeQueue,
  CeRepo,
  CeStatus,
} from "./types";

export const DEFAULT_TIMEOUT_MS = 10_000;
const PAGE_LIMIT = 100;
const MAX_PAGES = 50;

export type CeClientOptions = {
  baseUrl: string;
  secret: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
};

export type CeClient = ReturnType<typeof createCeClient>;

/** `{org}/{repo}` mit echtem Slash, Segmente einzeln kodiert. */
function repoPath(fullName: string): string {
  return fullName.split("/").map(encodeURIComponent).join("/");
}

function asArray<T>(body: unknown, ...keys: string[]): T[] {
  if (Array.isArray(body)) return body as T[];
  if (body && typeof body === "object") {
    for (const k of keys) {
      const v = (body as Record<string, unknown>)[k];
      if (Array.isArray(v)) return v as T[];
    }
  }
  return [];
}

export function createCeClient(options: CeClientOptions) {
  const base = options.baseUrl.replace(/\/+$/, "");
  const doFetch = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  /** Gibt die Antwort zurück; Fehlermeldungen nennen nur Pfad und Statuscode. */
  async function request(path: string, init: RequestInit = {}): Promise<Response> {
    const logPath = path.split("?")[0]!;
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, {
        ...init,
        headers: {
          ...(init.headers as Record<string, string> | undefined),
          Authorization: `Bearer ${options.secret}`,
          Accept: "application/json, text/plain",
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
      throw new CeApiError(
        timedOut
          ? `CE-Anfrage ${logPath} nach ${timeoutMs} ms abgebrochen`
          : `CE-Anfrage ${logPath} fehlgeschlagen`,
        logPath,
      );
    }
    if (!res.ok) {
      throw new CeApiError(`CE-Anfrage ${logPath} lieferte Status ${res.status}`, logPath, res.status);
    }
    return res;
  }

  async function json<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await request(path, init);
    try {
      return (await res.json()) as T;
    } catch {
      throw new CeApiError(`CE-Antwort von ${path.split("?")[0]} ist kein gültiges JSON`, path.split("?")[0]!, res.status);
    }
  }

  /** Nächster Cursor aus `x-next-cursor` oder `Link: <...cursor=...>; rel="next"`. */
  function nextCursor(res: Response): string | null {
    const header = res.headers.get("x-next-cursor");
    if (header) return header;
    const link = res.headers.get("link");
    if (!link) return null;
    for (const part of link.split(",")) {
      if (!/rel="?next"?/.test(part)) continue;
      const m = /<([^>]+)>/.exec(part);
      if (!m) continue;
      try {
        const cursor = new URL(m[1]!, "http://x").searchParams.get("cursor");
        if (cursor) return cursor;
      } catch {
        /* ignorieren */
      }
    }
    return null;
  }

  async function paginated<T>(path: string, ...keys: string[]): Promise<T[]> {
    const items: T[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const query = new URLSearchParams({ limit: String(PAGE_LIMIT) });
      if (cursor) query.set("cursor", cursor);
      const res = await request(`${path}?${query.toString()}`);
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        throw new CeApiError(`CE-Antwort von ${path} ist kein gültiges JSON`, path, res.status);
      }
      items.push(...asArray<T>(body, ...keys));
      const next = nextCursor(res);
      if (!next || next === cursor) break;
      cursor = next;
    }
    return items;
  }

  return {
    getStatus: () => json<CeStatus>("/system/v1/status"),

    async getQueue(): Promise<CeQueue> {
      const q = await json<Partial<CeQueue>>("/system/v1/jobs/queue");
      return { running: q.running ?? [], pending: q.pending ?? [] };
    },

    async listOrgs(): Promise<CeOrg[]> {
      const raw = await paginated<CeOrg | string>("/api/v1/orgs", "orgs", "items");
      return raw.map((o) => (typeof o === "string" ? { name: o } : o));
    },

    listOrgRepos: (org: string) =>
      paginated<CeRepo>(`/api/v1/orgs/${encodeURIComponent(org)}/-/repos`, "repos", "items"),

    listRepoJobs: async (fullName: string, limit = 20): Promise<CeJobReport[]> =>
      asArray<CeJobReport>(
        await json<unknown>(`/api/v1/repos/${repoPath(fullName)}/-/jobs?limit=${limit}`),
        "jobs",
        "items",
      ),

    async getJobLog(jobId: string): Promise<string> {
      const res = await request(`/system/v1/jobs/logs/${encodeURIComponent(jobId)}`);
      return res.text();
    },

    async addJob(fullName: string): Promise<CeAddJobResult> {
      const body = await json<{ jobId: string; status: string; change?: string }>(
        "/system/v1/jobs/add",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ repository: fullName }),
        },
      );
      return { jobId: body.jobId, status: body.status, change: body.change ?? "" };
    },
  };
}
