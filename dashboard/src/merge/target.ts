import { preferredMergeMethod, type MergeTarget } from "./types";

/**
 * Was die Oberfläche braucht, um einen PR als Merge-Ziel anzubieten: nur bei grüner CI, bekanntem
 * Head-Commit und mindestens einer erlaubten Methode (Spec dashboard-views, "Mergen in den Ansichten
 * anbieten"). Sonst `null`; dann bleibt der Link zum PR auf der Plattform.
 */
export function mergeTargetOf(pr: {
  id: string;
  ciStatus: string;
  headSha: string | null | undefined;
  mergeMethods: readonly string[] | null | undefined;
}): MergeTarget | null {
  if (pr.ciStatus !== "success" || !pr.headSha) return null;
  const method = preferredMergeMethod(pr.mergeMethods ?? []);
  if (!method) return null;
  return { pullRequestId: pr.id, expectedSha: pr.headSha, expectedMethod: method };
}
