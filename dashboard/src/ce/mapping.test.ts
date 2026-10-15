import { describe, expect, it } from "vitest";
import { jobDurationMs, mapJobStatus, mapReasonToTrigger } from "./mapping";

describe("mapReasonToTrigger", () => {
  it.each([
    ["hourly", "schedule"],
    ["schedule-all", "schedule"],
    ["schedule-sync", "schedule"],
    ["api-request", "manual"],
    ["web-ui", "manual"],
    ["main-commit", "webhook"],
    ["dependency-dashboard", "webhook"],
    ["pr-update", "webhook"],
    ["", "webhook"],
  ])("%s -> %s", (reason, expected) => {
    expect(mapReasonToTrigger(reason)).toBe(expected);
  });
  it("behandelt null/undefined als webhook", () => {
    expect(mapReasonToTrigger(undefined)).toBe("webhook");
    expect(mapReasonToTrigger(null)).toBe("webhook");
  });
});

describe("mapJobStatus", () => {
  it("success bleibt success", () => expect(mapJobStatus("success")).toBe("success"));
  it.each([
    "cli-error", "unknown-error", "timeout", "worker-failure",
    "error-fetching-new-job", "access-token-error", "purged", "etwas-neues",
  ])("%s -> failed", (s) => expect(mapJobStatus(s)).toBe("failed"));
});

describe("jobDurationMs", () => {
  it("berechnet die Dauer", () => {
    expect(jobDurationMs({ startedAt: "2026-10-15T07:00:12.482Z", completedAt: "2026-10-15T07:00:40.764Z" })).toBe(28282);
  });
  it("null bei fehlenden, ungültigen oder umgekehrten Zeiten", () => {
    expect(jobDurationMs({ startedAt: "2026-10-15T07:00:00Z" })).toBeNull();
    expect(jobDurationMs({ startedAt: "x", completedAt: "y" })).toBeNull();
    expect(jobDurationMs({ startedAt: "2026-10-15T08:00:00Z", completedAt: "2026-10-15T07:00:00Z" })).toBeNull();
  });
});
