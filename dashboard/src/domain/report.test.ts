import { describe, expect, it } from "vitest";
import { buildReport, buildSteps, joinGerman, mergeSteps, versionJump, type ReportInput, type ReportPr, type Step } from "./report";

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
    headSha: `sha-${over.id}`,
    mergeMethods: ["squash", "merge"],
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
    // Beide Sicherheits-PRs haben grüne CI und eine erlaubte Methode: Hauptaktion ist "Mergen".
    expect(steps[0].action).toEqual({
      kind: "merge",
      label: "Mergen",
      pullRequestId: "b",
      expectedSha: "sha-b",
      method: "squash",
      repoFullName: "Krinke-IT-Consulting/lector",
      prNumber: 1,
    });
  });

  it("Scenario: Grünes Sicherheitsupdate im Lagebericht", () => {
    const input: ReportInput = {
      now,
      repos: [onboarded("o/r")],
      openPrs: [pr({ id: "s1", repoFullName: "o/r", number: 7, mergeMethods: ["merge"] })],
      openProblems: [],
      hasAnyJob: true,
    };
    const [step] = buildSteps(input);
    expect(step.group).toBe("security");
    expect(step.action).toEqual({
      kind: "merge",
      label: "Mergen",
      pullRequestId: "s1",
      expectedSha: "sha-s1",
      method: "merge",
      repoFullName: "o/r",
      prNumber: 7,
    });
  });

  it("Grünes Major-Update bekommt ebenfalls die Merge-Aktion", () => {
    const input: ReportInput = {
      now,
      repos: [onboarded("o/r")],
      openPrs: [pr({ id: "m1", repoFullName: "o/r", updateType: "major", title: "chore(deps): update dependency x to v3" })],
      openProblems: [],
      hasAnyJob: true,
    };
    expect(buildSteps(input)[0].action).toMatchObject({ kind: "merge", label: "Mergen", method: "squash" });
  });

  it.each([
    ["rote CI", { ciStatus: "failure" as const }, "Auf GitHub mergen"],
    ["laufende CI", { ciStatus: "pending" as const }, "Auf GitHub mergen"],
    ["keine erlaubte Methode", { mergeMethods: [] }, "Auf GitHub mergen"],
    ["unbekannter Head-Commit", { headSha: null }, "Auf GitHub mergen"],
  ])("Scenario: Sicherheitsupdate mit %s bleibt ein Link zur Plattform", (_name, over, label) => {
    const input: ReportInput = {
      now,
      repos: [onboarded("o/r")],
      openPrs: [pr({ id: "s1", repoFullName: "o/r", ...over })],
      openProblems: [],
      hasAnyJob: true,
    };
    expect(buildSteps(input)[0].action).toEqual({ kind: "link", label, href: "https://github.com/o/r/pull/1", external: true });
  });

  it("Major-Update mit roter CI bleibt der Link „Freigeben“", () => {
    const input: ReportInput = {
      now,
      repos: [onboarded("o/r")],
      openPrs: [pr({ id: "m1", repoFullName: "o/r", updateType: "major", ciStatus: "failure" })],
      openProblems: [],
      hasAnyJob: true,
    };
    expect(buildSteps(input)[0].action).toMatchObject({ kind: "link", label: "Freigeben", external: true });
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
    expect(steps[1].action).toEqual({ kind: "link", label: "Log ansehen", href: "/jobs?repo=o%2Fa&status=failed", external: false });
    expect(steps[2].version).toBe("→ v16");
    expect(text(input).plain).toBe(
      "Fünf Punkte brauchen Ihre Entscheidung: 1 Sicherheitsupdate in b, 1 roter Build oder fehlgeschlagener Lauf in a, 1 Major-Update zur Freigabe in a, 1 Repo ohne Onboarding (neu) und 2 hängende PRs in a und b.",
    );
    // Die Zahl nennt alle hängenden PRs (auch den Sicherheits-PR aus Schritt 1), denn der Link zeigt sie alle.
    expect(
      text(input).report.segments.find((s) => "href" in s && s.href === "/probleme?art=stale_pr"),
    ).toEqual({ text: "2 hängende PRs", href: "/probleme?art=stale_pr" });
  });

  it("Hilfen", () => {
    expect(joinGerman(["a", "b", "c"])).toBe("a, b und c");
    expect(versionJump("chore(deps): lock file maintenance")).toBeNull();
    expect(versionJump("update dependency zod to v4.6.8")).toBe("→ v4.6.8");
  });
});

describe("Zahlen und Links im Lagebericht", () => {
  const stale = (id: string, repoFullName: string, prIsSecurity: boolean) => ({
    id,
    kind: "stale_pr" as const,
    message: `PR ${id} hängt`,
    firstSeenAt: now,
    repoFullName,
    prNumber: 1,
    prUrl: "https://github.com/x/y/pull/1",
    prIsSecurity,
  });

  it("hängende PRs: die Zahl im Satz zählt alle stale_pr-Probleme, die Schritte nicht doppelt", () => {
    const input: ReportInput = {
      now,
      repos: [onboarded("o/a"), onboarded("o/b")],
      openPrs: [pr({ id: "sec", repoFullName: "o/b", createdAt: new Date(now.getTime() - 9 * DAY) })],
      openProblems: [stale("p1", "o/b", true), stale("p2", "o/a", false)],
      hasAnyJob: true,
    };
    const steps = buildSteps(input);
    expect(steps.filter((s) => s.group === "stale")).toHaveLength(1);
    const { plain, report } = text(input);
    expect(plain).toBe(
      "Zwei Punkte brauchen Ihre Entscheidung: 1 Sicherheitsupdate in b und 2 hängende PRs in a und b.",
    );
    expect(report.segments).toContainEqual({ text: "2 hängende PRs", href: "/probleme?art=stale_pr" });
  });

  it("hängende PRs: nur Sicherheits-PRs hängen, das Segment erscheint trotzdem", () => {
    const input: ReportInput = {
      now,
      repos: [onboarded("o/b")],
      openPrs: [pr({ id: "sec", repoFullName: "o/b", createdAt: new Date(now.getTime() - 9 * DAY) })],
      openProblems: [stale("p1", "o/b", true)],
      hasAnyJob: true,
    };
    expect(buildSteps(input).map((s) => s.group)).toEqual(["security"]);
    expect(text(input).plain).toBe("Ein Punkt braucht Ihre Entscheidung: 1 Sicherheitsupdate in b und 1 hängender PR in b.");
  });

  it("Onboarding zählt keine archivierten Repos", () => {
    const input: ReportInput = {
      now,
      repos: [
        onboarded("o/a"),
        { fullName: "o/neu", onboarding: "none", archived: false },
        { fullName: "o/alt", onboarding: "none", archived: true },
      ],
      openPrs: [],
      openProblems: [],
      hasAnyJob: true,
    };
    expect(text(input).plain).toContain("1 Repo ohne Onboarding (neu)");
  });

  it("Repo-Links sind kodiert", () => {
    const input: ReportInput = {
      now,
      repos: [{ fullName: "o/a b", onboarding: "none", archived: false }],
      openPrs: [],
      openProblems: [],
      hasAnyJob: true,
    };
    expect(buildSteps(input)[0].action).toMatchObject({ kind: "link", href: "/repos/o/a%20b" });
  });

  it("Der Onboarding-Schritt legt mit Repo-ID den Onboarding-PR an (Aktion statt Link)", () => {
    const input: ReportInput = {
      now,
      repos: [{ id: "r-1", fullName: "o/neu", onboarding: "none", archived: false }],
      openPrs: [],
      openProblems: [],
      hasAnyJob: true,
    };
    expect(buildSteps(input)[0].action).toEqual({
      kind: "onboarding",
      label: "Onboarding-PR anlegen",
      repositoryId: "r-1",
      repoFullName: "o/neu",
    });
  });
});

describe("mergeSteps", () => {
  const step = (id: string, over: Partial<Step> = {}): Step => ({
    id,
    group: "security",
    typeLabel: "Sicherheitsupdate",
    title: id,
    version: null,
    repoFullName: "o/r",
    detail: ["CI grün", "seit 1 Tag offen"],
    action: { kind: "link", label: "Auf GitHub mergen", href: "https://github.com/o/r/pull/1", external: true },
    ...over,
  });

  it("zeigt für bekannte Schritte den aktuellen Stand an der alten Stelle", () => {
    const seen = [step("a"), step("b")];
    const current = [step("b", { detail: ["CI rot", "seit 2 Tagen offen"] }), step("a", { detail: ["CI grün", "seit 2 Tagen offen"] })];
    const merged = mergeSteps(seen, current);
    expect(merged.map((s) => s.id)).toEqual(["a", "b"]);
    expect(merged[0].detail[1]).toBe("seit 2 Tagen offen");
    expect(merged[1].detail[0]).toBe("CI rot");
  });

  it("lässt verschwundene Schritte als Snapshot stehen und hängt neue ans Ende", () => {
    const gone = step("gone", { detail: ["Stand von früher"] });
    const merged = mergeSteps([step("a"), gone], [step("a"), step("neu")]);
    expect(merged.map((s) => s.id)).toEqual(["a", "gone", "neu"]);
    expect(merged[1]).toBe(gone);
  });
});
