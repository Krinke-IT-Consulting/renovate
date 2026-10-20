import { describe, expect, it } from "vitest";
import type { ProblemRow } from "@/queries/problems";
import type { PullRequestRow } from "@/queries/pull-requests";
import { repoSteps } from "./repo-detail";

const NOW = new Date("2026-10-20T12:00:00Z");
const DAY = 86_400_000;

const pr = (number: number, over: Partial<PullRequestRow> = {}): PullRequestRow => ({
  id: `pr-${number}`,
  number,
  title: `chore(deps): update dependency x to v${number}`,
  url: `https://example.test/pull/${number}`,
  updateType: "minor",
  packageNames: ["x"],
  ciStatus: "success",
  automerge: false,
  createdAt: new Date(NOW.getTime() - 2 * DAY),
  repoId: "r1",
  repoFullName: "o/r",
  ...over,
});

const problem = (id: string, kind: ProblemRow["kind"], dedupeKey = ""): ProblemRow => ({
  id,
  kind,
  message: `Problem ${id}`,
  firstSeenAt: new Date(NOW.getTime() - DAY),
  resolvedAt: null,
  repoId: "r1",
  repoFullName: "o/r",
  dedupeKey,
  evidence: { label: "Repo-Details", href: "/repos/o/r", external: false },
});

const repo = { fullName: "o/r", onboarding: "onboarded" as const, archived: false, removed: false };

describe("repoSteps", () => {
  it("ordnet wie der Lagebericht: Sicherheit, Fehler, Major", () => {
    const steps = repoSteps(
      repo,
      [pr(1, { updateType: "major" }), pr(2, { updateType: "security" }), pr(3)],
      [problem("a", "job_failed"), problem("b", "ci_red", "1")],
      NOW,
    );
    expect(steps.map((s) => s.group)).toEqual(["security", "failure", "failure", "major"]);
    // Rote CI verlinkt auf den offenen PR.
    const ciRed = steps.find((s) => s.typeLabel === "CI rot");
    expect(ciRed?.action.href).toBe("https://example.test/pull/1");
  });

  it("ohne Probleme und Entscheidungs-PRs gibt es nichts zu tun", () => {
    expect(repoSteps(repo, [pr(3), pr(4, { updateType: "patch" })], [], NOW)).toEqual([]);
  });

  it("nicht onboardetes Repo bekommt den Onboarding-Schritt", () => {
    const steps = repoSteps({ ...repo, onboarding: "none" }, [], [], NOW);
    expect(steps.map((s) => s.group)).toEqual(["onboarding"]);
  });

  it("archivierte und entfernte Repos haben keinen Onboarding-Schritt; entfernte gar keinen", () => {
    expect(repoSteps({ ...repo, onboarding: "none", archived: true }, [], [], NOW)).toEqual([]);
    expect(repoSteps({ ...repo, removed: true }, [pr(1, { updateType: "security" })], [], NOW)).toEqual([]);
  });
});
