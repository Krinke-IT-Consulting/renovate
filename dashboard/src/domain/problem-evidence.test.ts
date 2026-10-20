import { describe, expect, it } from "vitest";
import { problemEvidence } from "./problem-evidence";

const repo = "beispiel-firma/kasse";

describe("problemEvidence", () => {
  it("PR-Probleme verlinken auf den PR (extern)", () => {
    const url = "https://github.com/beispiel-firma/kasse/pull/57";
    for (const kind of ["ci_red", "stale_pr"] as const) {
      expect(problemEvidence({ kind, dedupeKey: "57", repoFullName: repo, prUrl: url })).toEqual({
        label: "PR #57 öffnen",
        href: url,
        external: true,
      });
    }
  });

  it("fehlender PR oder Schlüssel ohne Nummer führt zum Repo-Detail", () => {
    const detail = { label: "Repo-Details", href: "/repos/beispiel-firma/kasse", external: false };
    expect(problemEvidence({ kind: "ci_red", dedupeKey: "57", repoFullName: repo, prUrl: null })).toEqual(detail);
    expect(problemEvidence({ kind: "stale_pr", dedupeKey: "", repoFullName: repo, prUrl: "https://x/pull/1" })).toEqual(detail);
    expect(problemEvidence({ kind: "stale_pr", dedupeKey: "5a", repoFullName: repo, prUrl: "https://x/pull/5" })).toEqual(detail);
  });

  it("Lauf- und Konfigurationsfehler führen zu den fehlgeschlagenen Läufen", () => {
    for (const kind of ["job_failed", "config_error"] as const) {
      const e = problemEvidence({ kind, dedupeKey: "", repoFullName: repo });
      expect(e.external).toBe(false);
      const url = new URL(e.href, "http://x");
      expect(url.pathname).toBe("/jobs");
      expect(url.searchParams.get("repo")).toBe(repo);
      expect(url.searchParams.get("status")).toBe("failed");
    }
  });

  it("Lockfile-Fehler führen zu den Läufen ohne Statusfilter", () => {
    const url = new URL(problemEvidence({ kind: "lockfile_failure", dedupeKey: "", repoFullName: repo }).href, "http://x");
    expect(url.pathname).toBe("/jobs");
    expect(url.searchParams.get("repo")).toBe(repo);
    expect(url.searchParams.has("status")).toBe(false);
  });

  it("fehlender Build-Check führt zum Repo-Detail", () => {
    expect(problemEvidence({ kind: "missing_build_check", dedupeKey: "", repoFullName: repo })).toEqual({
      label: "Repo-Details",
      href: "/repos/beispiel-firma/kasse",
      external: false,
    });
  });
});
