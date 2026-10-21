import type { CeJobReport } from "./types";

export type JobTrigger = "schedule" | "webhook" | "manual";
export type JobOutcome = "success" | "failed";
export type JobState = "queued" | "running" | JobOutcome;

/** schedule: hourly, schedule-*; manual: api-request, web-ui; alles andere webhook. */
export function mapReasonToTrigger(reason: string | null | undefined): JobTrigger {
  const r = (reason ?? "").trim().toLowerCase();
  if (r === "hourly" || r.startsWith("schedule-")) return "schedule";
  if (r === "api-request" || r === "web-ui") return "manual";
  return "webhook";
}

/** Rohwerte der Job-Historie, die keinen Endzustand bedeuten (die Historie enthält auch laufende Jobs). */
const RUNNING_RAW = new Set(["running", "processing", "in-progress"]);
const QUEUED_RAW = new Set(["queued", "pending", "waiting"]);

/**
 * success bleibt success; laufende und wartende Jobs behalten ihren Zustand (sie stehen auch in der
 * Historie, nicht nur in der Queue); alle anderen Werte sind Endzustände und werden failed.
 */
export function mapJobStatus(raw: string | null | undefined): JobState {
  const r = (raw ?? "").trim().toLowerCase();
  if (r === "success") return "success";
  if (RUNNING_RAW.has(r)) return "running";
  if (QUEUED_RAW.has(r)) return "queued";
  return "failed";
}

/** Nur abgeschlossene Jobs zählen für "letzter Lauf" und Probleme. */
export function isFinished(state: JobState): state is JobOutcome {
  return state === "success" || state === "failed";
}

/** Dauer in Millisekunden; null, wenn Zeiten fehlen, ungültig sind oder das Ende vor dem Start liegt. */
export function jobDurationMs(job: Pick<CeJobReport, "startedAt" | "completedAt">): number | null {
  if (!job.startedAt || !job.completedAt) return null;
  const start = Date.parse(job.startedAt);
  const end = Date.parse(job.completedAt);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;
  return end - start;
}
