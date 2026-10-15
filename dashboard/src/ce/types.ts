/** Antworttypen der Renovate-CE-API (aufgezeichnet am 2026-10-15, siehe __fixtures__). */

export type CeRepoStatus =
  | "activated"
  | "disabled"
  | "onboarded"
  | "onboarding"
  | "unknown"
  | "failed"
  | "resource-limit"
  | "timeout";

/** Endwerte eines Jobs; unbekannte Werte bleiben als string erhalten. */
export type CeJobStatusKnown =
  | "success"
  | "cli-error"
  | "unknown-error"
  | "timeout"
  | "worker-failure"
  | "error-fetching-new-job"
  | "access-token-error"
  | "purged";

export type CeJobError = { name?: string; message?: string };

export type CeJobReport = {
  jobId: string;
  reason: string;
  addedAt?: string;
  startedAt?: string;
  completedAt?: string;
  logLocation?: string;
  queueName?: string;
  status: CeJobStatusKnown | (string & {});
  error?: CeJobError;
  artifactErrors?: unknown[];
};

export type CeQueueJob = {
  jobId: string;
  reason: string;
  addedAt?: string;
  startedAt?: string;
  repository?: string;
  organizationName?: string;
  queueName?: string;
  status?: string;
  [key: string]: unknown;
};

export type CeQueue = { running: CeQueueJob[]; pending: CeQueueJob[] };

export type CeStatus = {
  bootTime?: string;
  endpoint?: string;
  platform?: string;
  renovateVersion?: string;
  app?: { organizationCount?: number; repositoryCount?: number };
  jobs?: {
    history?: { processed?: number; lastDispatchDate?: string; lastFinished?: CeQueueJob };
    queue?: { inProgress?: unknown[]; size?: number };
  };
  scheduler?: Record<string, { cron?: string; lastScheduling?: string }>;
  webhooks?: { lastValidWebhookReceived?: string };
  [key: string]: unknown;
};

export type CeOrg = { name: string; [key: string]: unknown };

export type CeRepo = {
  name: string;
  fullName: string;
  enabled?: boolean;
  queueName?: string;
  installedAt?: string;
  status: CeRepoStatus | (string & {});
};

export type CeAddJobResult = {
  jobId: string;
  status: string;
  /** Rohwert der Antwort: etwa "inserted" bzw. "unchanged". */
  change: string;
};
