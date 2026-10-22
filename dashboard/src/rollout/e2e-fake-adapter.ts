import { and, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { pullRequests, repositories } from "@/db/schema";
import type { CiStatus } from "@/domain/pull-requests";
import { MERGE_METHODS } from "@/merge/types";
import {
  PlatformHeadChangedError,
  ROLLOUT_BRANCH_PREFIX,
  type ChangeRequestRef,
  type PlatformAdapter,
  type TemplateFile,
  type ConnectionRef,
  type RepositoryRef,
  type TemplateName,
} from "@/platform";

/**
 * Plattform-Ersatz nur für das Playwright-Smoke (e2e/aktionen.spec.ts). Aktiv, wenn
 * `NODE_ENV !== "production"` UND `E2E_FAKE_PLATFORM=1` gesetzt ist; die Variable setzt allein
 * `playwright.config.ts`. In Produktion ist die Weiche wirkungslos, auch bei gesetzter Variable.
 * Bewusst nicht im Env-Schema und nicht in `.env.example`: sie ist kein Betriebswert.
 *
 * Der Ersatz ersetzt nur den Adapter; der echte Rollout-Service mit Datenbank, RolloutAction und
 * AuditLog läuft unverändert. Keine Netzwerkzugriffe, keine Zugangsdaten.
 */
export function e2eFakePlatformEnabled(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.E2E_FAKE_PLATFORM === "1";
}

const TEMPLATES: Record<TemplateName, TemplateFile> = {
  "renovate-config": { path: "renovate.json", content: '{\n  "extends": ["github>example/preset"]\n}\n' },
  "build-check-caller": { path: ".github/workflows/build-check.yml", content: "name: Build-Check\n" },
};

function unsupported(): never {
  throw new Error("Im E2E-Ersatz nicht vorgesehen.");
}

/** Der PR laut Datenbank (Fixtures), samt erlaubten Merge-Methoden seines Repos. */
async function findPullRequest(repo: RepositoryRef, number: number) {
  const [row] = await getDb()
    .select({
      state: pullRequests.state,
      headSha: pullRequests.headSha,
      ci: pullRequests.ciStatus,
      url: pullRequests.url,
      methods: repositories.mergeMethods,
    })
    .from(pullRequests)
    .innerJoin(repositories, eq(repositories.id, pullRequests.repositoryId))
    .where(and(eq(repositories.fullName, repo.fullName), eq(pullRequests.number, number)));
  if (!row) throw new Error("Im E2E-Ersatz unbekannter PR.");
  return row;
}

export function createE2eFakeAdapter(): PlatformAdapter {
  let next = 100;
  const base: Omit<PlatformAdapter, "getMergeReadiness" | "mergeChangeRequest"> = {
    listConnections: unsupported,
    listRepositories: unsupported,
    getHeadSha: unsupported,
    getRepositoryState: unsupported,
    listUpdatePullRequests: unsupported,
    getPullRequestState: unsupported,
    getChangeStatus: unsupported,
    findDependencyDashboard: unsupported,
    async findOpenChangeRequest() {
      return null;
    },
    async createChangeRequest(_conn, repo, request): Promise<ChangeRequestRef> {
      if (!request.branch.startsWith(ROLLOUT_BRANCH_PREFIX)) unsupported();
      const number = next++;
      return { number, url: `https://github.com/${repo.fullName}/pull/${number}` };
    },
    async deleteBranch() {},
    async readTemplate(name) {
      return TEMPLATES[name];
    },
  };
  // Merge-Methoden (design.md, Entscheidung 1), gelesen aus der Datenbank statt von der Plattform.
  const merge: Pick<PlatformAdapter, "getMergeReadiness" | "mergeChangeRequest"> = {
    /**
     * Stand des PR für die Live-Prüfung des Merges, gelesen aus der Datenbank (Fixtures). Immer
     * konfliktfrei; Tests ändern den Stand per SQL (Head-SHA, CI, Zustand), um Abweichungen zu erzeugen.
     */
    async getMergeReadiness(_conn: ConnectionRef, repo: RepositoryRef, number: number) {
      const pr = await findPullRequest(repo, number);
      return {
        state: pr.state,
        headSha: pr.headSha ?? "",
        mergeable: true as boolean | null,
        ci: pr.ci as CiStatus,
        methods: MERGE_METHODS.filter((m) => pr.methods.includes(m)),
      };
    },
    /** Merge ohne Netz: prüft nur die SHA-Bindung wie die Plattform (409 bei Abweichung). */
    async mergeChangeRequest(_conn: ConnectionRef, repo: RepositoryRef, number: number, options: { sha: string }) {
      const pr = await findPullRequest(repo, number);
      if (pr.headSha !== options.sha) throw new PlatformHeadChangedError();
    },
  };
  return { ...base, ...merge };
}
