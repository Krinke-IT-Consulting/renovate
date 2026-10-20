import { describe, expect, it } from "vitest";
import { buildReport, buildSteps, joinGerman, versionJump, type ReportInput, type ReportPr } from "./report";

const now = new Date("2026-10-20T12:00:00Z");
const DAY = 86_400_000;

function pr(over: Partial<ReportPr> & Pick<ReportPr, "id" | "repoFullName">): ReportPr {
  return {
    number: 1,
    title: "fix(deps): update dependency x to v2.0.1 [SECURITY]",
    url: `https://github.com/${over.repoFullName}/pull/1`,
    updateType: "security",
    packageNames: ["x"],
    ciStatus: "success",
    createdAt: new Date(now.getTime() - 2 * DAY),
    ...over,
  };
}

const onboarded = (fullName: string) => ({ fullName, onboarding: "onboarded" as const, archived: false });

function text(input: ReportInput) {
  const report = buildReport(input, buildSteps(input));
  return { report, plain: report.segments.map((s) => s.text).join("") };
}

describe("Lagebericht", () => {
  it("Scenario: Zwei Sicherheitsupdates offen", () => {
    const input: ReportInput = {
      now,
      repos: [onboarded("Hiwamashi/seatmagic"), onboarded("Krinke-IT-Consulting/lector"), onboarded("Hiwamashi/blog")],
      openPrs: [
        pr({ id: "a", repoFullName: "Hiwamashi/seatmagic" }),
        pr({ id: "b", repoFullName: "Krinke-IT-Consulting/lector", createdAt: new Date(now.getTime() - 3 * DAY) }),
      ],
      openProblems: [],
      hasAnyJob: true,
    };
    const steps = buildSteps(input);
    const { report, plain } = text(input);

    expect(report.kind).toBe("open");
    expect(plain).toBe(
      "Zwei Punkte brauchen Ihre Entscheidung: 2 Sicherheitsupdates in lector und seatmagic. Ein weiteres Repo ist aktuell.",
    );
    const link = report.segments.find((s) => "href" in s && s.text === "2 Sicherheitsupdates");
    expect(link).toEqual({ text: "2 Sicherheitsupdates", href: "/pull-requests?typ=security" });

    expect(steps.map((s) => [s.group, s.repoFullName])).toEqual([
      ["security", "Krinke-IT-Consulting/lector"],
      ["security", "Hiwamashi/seatmagic"],
    ]);
    expect(steps[0].action).toEqual({ label: "Auf GitHub mergen", href: expect.stringContaining("/pull/"), external: true });
  });

  it("Scenario: Alles erledigt", () => {
    const input: ReportInput = { now, repos: [onboarded("a/b")], openPrs: [], openProblems: [], hasAnyJob: true };
    expect(text(input).plain).toBe("Alles aktuell.");
    expect(
      text({ ...input, nextRunAt: new Date("2026-10-21T01:00:00Z") }).plain,
    ).toBe("Alles aktuell. Nächster Lauf um 03:00.");
  });

  it("Scenario: Erster Start führt zum Onboarding", () => {
    const input: ReportInput = {
      now,
      repos: [
        { fullName: "a/eins", onboarding: "none", archived: false },
        { fullName: "a/zwei", onboarding: "none", archived: false },
      ],
      openPrs: [],
      openProblems: [],
      hasAnyJob: false,
    };
    const { report } = text(input);
    expect(report.kind).toBe("first-run");
    expect(report.segments).toContainEqual({ text: "2 Repos warten auf das Onboarding", href: "/repos?onboarding=none" });
  });

  it("Feste Reihenfolge der Gruppen, hängende Sicherheits-PRs nicht doppelt", () => {
    const input: ReportInput = {
      now,
      repos: [onboarded("o/a"), onboarded("o/b"), { fullName: "o/neu", onboarding: "none", archived: false }],
      openPrs: [
        pr({ id: "maj", repoFullName: "o/a", updateType: "major", title: "chore(deps): update dependency next to v16", packageNames: ["next"] }),
        pr({ id: "sec", repoFullName: "o/b", createdAt: new Date(now.getTime() - 9 * DAY) }),
      ],
      openProblems: [
        { id: "p1", kind: "stale_pr", message: "PR #33 hängt", firstSeenAt: now, repoFullName: "o/b", prNumber: 33, prUrl: "u", prIsSecurity: true },
        { id: "p2", kind: "stale_pr", message: "PR #12 hängt", firstSeenAt: now, repoFullName: "o/a", prNumber: 12, prUrl: "u2", prIsSecurity: false },
        { id: "p3", kind: "job_failed", message: "Lauf fehlgeschlagen", firstSeenAt: now, repoFullName: "o/a", prNumber: null, prUrl: null, prIsSecurity: false },
      ],
      hasAnyJob: true,
    };
    const steps = buildSteps(input);
    expect(steps.map((s) => s.group)).toEqual(["security", "failure", "major", "onboarding", "stale"]);
    expect(steps[0].detail[1]).toContain("hängt");
    expect(steps[1].action).toEqual({ label: "Log ansehen", href: "/jobs?repo=o%2Fa&status=failed", external: false });
    expect(steps[2].version).toBe("→ v16");
    expect(text(input).plain).toBe(
      "Fünf Punkte brauchen Ihre Entscheidung: 1 Sicherheitsupdate in b, 1 roter Build oder fehlgeschlagener Lauf in a, 1 Major-Update zur Freigabe in a, 1 Repo ohne Onboarding (neu) und 1 hängender PR in a.",
    );
  });

  it("Hilfen", () => {
    expect(joinGerman(["a", "b", "c"])).toBe("a, b und c");
    expect(versionJump("chore(deps): lock file maintenance")).toBeNull();
    expect(versionJump("update dependency zod to v4.6.8")).toBe("→ v4.6.8");
  });
});
