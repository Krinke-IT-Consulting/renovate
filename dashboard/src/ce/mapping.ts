import type { CeJobReport } from "./types";

export type JobTrigger = "schedule" | "webhook" | "manual";
export type JobOutcome = "success" | "failed";

/** schedule: hourly, schedule-*; manual: api-request, web-ui; alles andere webhook. */
export function mapReasonToTrigger(reason: string | null | undefined): JobTrigger {
  const r = (reason ?? "").trim().toLowerCase();
  if (r === "hourly" || r.startsWith("schedule-")) return "schedule";
  if (r === "api-request" || r === "web-ui") return "manual";
  return "webhook";
}

/** success bleibt success, alle anderen Endwerte werden failed. Laufend/wartend kommt aus der Queue. */
export function mapJobStatus(raw: string | null | undefined): JobOutcome {
  return raw === "success" ? "success" : "failed";
}

/** Dauer in Millisekunden; null, wenn Zeiten fehlen, ungültig sind oder das Ende vor dem Start liegt. */
export function jobDurationMs(job: Pick<CeJobReport, "startedAt" | "completedAt">): number | null {
  if (!job.startedAt || !job.completedAt) return null;
  const start = Date.parse(job.startedAt);
  const end = Date.parse(job.completedAt);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;
  return end - start;
}
