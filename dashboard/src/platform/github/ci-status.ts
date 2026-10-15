import type { CiStatus } from "@/domain/pull-requests";

/** GitHub-spezifisch: Rohwerte aus Check-Runs und kombiniertem Commit-Status. */
export type CheckRun = { status: string; conclusion?: string | null };
export type CommitStatus = { state: string };

const FAILED_CONCLUSIONS = new Set([
  "failure",
  "timed_out",
  "cancelled",
  "action_required",
  "startup_failure",
]);
const FAILED_STATES = new Set(["failure", "error"]);

/**
 * Normalisiert Checks und Commit-Status eines Commits auf den neutralen CiStatus:
 * `failure`, wenn einer fehlschlägt, `pending`, wenn einer läuft, `success`, wenn alle bestanden
 * sind, `none` ohne Checks (Spec dashboard-sync, "Update-Typ und Status ableiten").
 */
export function deriveCiStatus(
  checks: readonly CheckRun[],
  statuses: readonly CommitStatus[],
): CiStatus {
  if (checks.length === 0 && statuses.length === 0) return "none";
  const failed =
    checks.some((c) => c.status === "completed" && FAILED_CONCLUSIONS.has(c.conclusion ?? "")) ||
    statuses.some((s) => FAILED_STATES.has(s.state));
  if (failed) return "failure";
  const pending =
    checks.some((c) => c.status !== "completed") || statuses.some((s) => s.state === "pending");
  return pending ? "pending" : "success";
}
