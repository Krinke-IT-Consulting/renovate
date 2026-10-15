import { describe, expect, it } from "vitest";
import { deriveCiStatus } from "./ci-status";

describe("deriveCiStatus", () => {
  const ok = { status: "completed", conclusion: "success" };
  it("Repo ohne Checks -> none", () => expect(deriveCiStatus([], [])).toBe("none"));
  it("alle bestanden (neutral/skipped zählen) -> success", () => {
    expect(deriveCiStatus([ok, { status: "completed", conclusion: "neutral" }, { status: "completed", conclusion: "skipped" }], [{ state: "success" }])).toBe("success");
  });
  it.each(["failure", "timed_out", "cancelled", "action_required", "startup_failure"])("Check %s -> failure", (c) => {
    expect(deriveCiStatus([ok, { status: "completed", conclusion: c }], [])).toBe("failure");
  });
  it.each(["failure", "error"])("Status %s -> failure", (state) => {
    expect(deriveCiStatus([], [{ state }])).toBe("failure");
  });
  it("laufend -> pending, Fehler schlägt pending", () => {
    expect(deriveCiStatus([{ status: "in_progress", conclusion: null }], [])).toBe("pending");
    expect(deriveCiStatus([], [{ state: "pending" }])).toBe("pending");
    expect(deriveCiStatus([{ status: "queued" }, { status: "completed", conclusion: "failure" }], [])).toBe("failure");
  });
});

