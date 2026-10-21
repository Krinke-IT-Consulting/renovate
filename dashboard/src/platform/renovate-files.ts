/** Renovate-spezifische Dateikonventionen (plattformneutral, gelten für GitHub wie GitLab). */

/** Konfigurationsdateien in der Reihenfolge, in der Renovate sie sucht (ohne package.json). */
export const RENOVATE_CONFIG_PATHS = [
  "renovate.json",
  "renovate.json5",
  ".github/renovate.json",
  ".github/renovate.json5",
  ".gitlab/renovate.json",
  ".gitlab/renovate.json5",
  ".renovaterc",
  ".renovaterc.json",
  ".renovaterc.json5",
] as const;

export const UPDATE_BRANCH_PREFIX = "renovate/";
/**
 * Branches mit dem Präfix `renovate/`, die keine Update-PRs sind: Renovates eigener
 * Onboarding-PR (`renovate/configure`).
 */
export const NON_UPDATE_BRANCHES = ["renovate/configure"] as const;
/**
 * Präfix der Rollout-Branches des Dashboards (design.md, Entscheidung 10:
 * `renovate-platform/onboarding`, `renovate-platform/build-check`). Er beginnt bewusst nicht mit
 * `renovate/`, damit der Update-PR-Filter diese PRs nie als Updates zählt.
 */
export const ROLLOUT_BRANCH_PREFIX = "renovate-platform/";
export const ROLLOUT_BRANCHES = {
  onboarding: `${ROLLOUT_BRANCH_PREFIX}onboarding`,
  build_check: `${ROLLOUT_BRANCH_PREFIX}build-check`,
} as const;
export const DEPENDENCY_DASHBOARD_TITLE = "Dependency Dashboard";
