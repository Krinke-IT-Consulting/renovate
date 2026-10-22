import {
  ROLLOUT_BRANCH_PREFIX,
  type ChangeRequestRef,
  type PlatformAdapter,
  type TemplateFile,
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

export function createE2eFakeAdapter(): PlatformAdapter {
  let next = 100;
  return {
    listConnections: unsupported,
    listRepositories: unsupported,
    getHeadSha: unsupported,
    getRepositoryState: unsupported,
    listUpdatePullRequests: unsupported,
    getPullRequestState: unsupported,
    getChangeStatus: unsupported,
    findDependencyDashboard: unsupported,
    // Platzhalter, damit der Typ passt; Task 4.4 ersetzt sie durch den echten Ersatz.
    getMergeReadiness: unsupported,
    mergeChangeRequest: unsupported,
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
}
