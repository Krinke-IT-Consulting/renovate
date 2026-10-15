/** Reine Ableitung von Onboarding- und Build-Check-Status (Spec dashboard-sync). */

export type OnboardingStatus = "none" | "pr_open" | "onboarded" | "disabled";
export type BuildCheckStatus = "missing" | "pr_open" | "active" | "own_ci";

export function deriveOnboardingStatus(input: {
  hasConfig: boolean;
  openOnboardingPr: boolean;
  /** Rohwert der CE-Reporting-API. `disabled` zählt nur bei vorhandener Konfiguration. */
  ceStatus: string | null | undefined;
}): OnboardingStatus {
  if (input.hasConfig) return input.ceStatus === "disabled" ? "disabled" : "onboarded";
  return input.openOnboardingPr ? "pr_open" : "none";
}

export function deriveBuildCheckStatus(input: {
  hasCallerFile: boolean;
  openRolloutPr: boolean;
  ownCi: boolean;
}): BuildCheckStatus {
  if (input.hasCallerFile) return "active";
  if (input.openRolloutPr) return "pr_open";
  if (input.ownCi) return "own_ci";
  return "missing";
}
