import { describe, expect, it } from "vitest";
import {
  deriveBuildCheckStatus,
  deriveOnboardingStatus,
  deriveProblems,
  deriveUpdateType,
  parseUpdatePackages,
  reconcileProblems,
  STALE_PR_DAYS,
  STALE_SECURITY_PR_DAYS,
  type ProblemInput,
} from ".";

describe("deriveUpdateType", () => {
  it("Sicherheitsupdate als Major bleibt security", () => {
    expect(deriveUpdateType(["dependencies", "renovate", "security", "update:major"])).toBe("security");
  });
  it.each([
    [["update:major", "update:minor"], "major"],
    [["update:minor", "update:patch"], "minor"],
    [["update:patch", "update:digest"], "patch"],
    [["update:digest"], "digest"],
    [["lockfile"], "lockfile"],
    [["update:replacement", "dependencies"], "other"],
    [[], "other"],
  ] as const)("%j -> %s", (labels, expected) => {
    expect(deriveUpdateType(labels)).toBe(expected);
  });
  it("ignoriert Groß-/Kleinschreibung", () => expect(deriveUpdateType(["Update:Major"])).toBe("major"));
});

describe("deriveOnboardingStatus", () => {
  it("Konfiguration -> onboarded", () => expect(deriveOnboardingStatus({ hasConfig: true, openOnboardingPr: false, ceStatus: "onboarded" })).toBe("onboarded"));
  it("Konfiguration + CE disabled -> disabled", () => expect(deriveOnboardingStatus({ hasConfig: true, openOnboardingPr: false, ceStatus: "disabled" })).toBe("disabled"));
  it("ohne Konfiguration meldet CE disabled, Status bleibt none", () => expect(deriveOnboardingStatus({ hasConfig: false, openOnboardingPr: false, ceStatus: "disabled" })).toBe("none"));
  it("ohne Konfiguration mit offenem PR -> pr_open", () => expect(deriveOnboardingStatus({ hasConfig: false, openOnboardingPr: true, ceStatus: "disabled" })).toBe("pr_open"));
  it("fehlender CE-Status ist unkritisch", () => expect(deriveOnboardingStatus({ hasConfig: true, openOnboardingPr: false, ceStatus: null })).toBe("onboarded"));
});

describe("deriveBuildCheckStatus", () => {
  it("Rangfolge active > pr_open > own_ci > missing", () => {
    expect(deriveBuildCheckStatus({ hasCallerFile: true, openRolloutPr: true, ownCi: true })).toBe("active");
    expect(deriveBuildCheckStatus({ hasCallerFile: false, openRolloutPr: true, ownCi: true })).toBe("pr_open");
    expect(deriveBuildCheckStatus({ hasCallerFile: false, openRolloutPr: false, ownCi: true })).toBe("own_ci");
    expect(deriveBuildCheckStatus({ hasCallerFile: false, openRolloutPr: false, ownCi: false })).toBe("missing");
  });
});

const now = new Date("2026-10-15T12:00:00Z");
const daysAgo = (d: number, extraMs = 0) => new Date(now.getTime() - d * 86_400_000 - extraMs);
const base = (over: Partial<ProblemInput> = {}): ProblemInput => ({
  repo: { archived: false, onboarding: "onboarded", buildCheck: "active", ceStatus: "onboarded" },
  lastJob: { status: "success" },
  openPrs: [],
  now,
  ...over,
});
const kinds = (i: ProblemInput) => deriveProblems(i).map((p) => p.kind);

describe("deriveProblems", () => {
  it("gesundes Repo -> keine Probleme", () => expect(deriveProblems(base())).toEqual([]));

  it("archiviertes Repo hat keine Probleme", () => {
    const i = base({
      repo: { archived: true, onboarding: "onboarded", buildCheck: "missing", ceStatus: "failed" },
      lastJob: { status: "failed" },
      openPrs: [{ number: 1, updateType: "security", ciStatus: "failure", createdAt: daysAgo(100) }],
    });
    expect(deriveProblems(i)).toEqual([]);
  });

  it("job_failed nur, wenn nichts Spezifischeres vorliegt", () => {
    expect(kinds(base({ lastJob: { status: "failed", error: { name: "Error", message: "boom" } } }))).toEqual(["job_failed"]);
    expect(kinds(base({ lastJob: { status: "failed", error: { message: "Invalid configuration" } } }))).toEqual(["config_error"]);
    expect(kinds(base({ lastJob: { status: "failed", error: { name: "ValidationError" } } }))).toEqual(["config_error"]);
    expect(kinds(base({ lastJob: { status: "failed", artifactErrors: [{ lockFile: "package-lock.json" }] } }))).toEqual(["lockfile_failure"]);
  });

  it("config_error bei CE-Status failed, auch ohne Jobfehler", () => {
    expect(kinds(base({ repo: { archived: false, onboarding: "onboarded", buildCheck: "active", ceStatus: "failed" } }))).toEqual(["config_error"]);
  });

  it("lockfile_failure auch bei erfolgreichem Job mit artifactErrors", () => {
    expect(kinds(base({ lastJob: { status: "success", artifactErrors: [{}] } }))).toEqual(["lockfile_failure"]);
  });

  it("kein letzter Job und laufender Job erzeugen kein job_failed", () => {
    expect(kinds(base({ lastJob: null }))).toEqual([]);
    expect(kinds(base({ lastJob: { status: "running" } }))).toEqual([]);
  });

  it("stale_pr: >14 Tage, Security >7 Tage, dedupeKey = PR-Nummer", () => {
    const pr = (number: number, updateType: "minor" | "security", age: number) => ({ number, updateType, ciStatus: "success" as const, createdAt: daysAgo(age) });
    const result = deriveProblems(base({ openPrs: [pr(1, "minor", STALE_PR_DAYS), pr(2, "minor", STALE_PR_DAYS + 1), pr(3, "security", STALE_SECURITY_PR_DAYS), pr(4, "security", STALE_SECURITY_PR_DAYS + 1)] }));
    expect(result.map((p) => [p.kind, p.dedupeKey])).toEqual([["stale_pr", "2"], ["stale_pr", "4"]]);
  });

  it("stale_pr: Alter wird nicht abgerundet (14,5 Tage sind mehr als 14)", () => {
    const pr = (age: number, updateType: "minor" | "security" = "minor") => ({ number: 9, updateType, ciStatus: "success" as const, createdAt: daysAgo(age) });
    const stale = (age: number, t?: "minor" | "security") => deriveProblems(base({ openPrs: [pr(age, t)] })).filter((p) => p.kind === "stale_pr");
    expect(stale(14.5)).toHaveLength(1);
    expect(stale(14.5)[0]!.message).toContain("15 Tagen");
    expect(stale(14.5)[0]!.message).toContain("Grenze 14 Tage");
    expect(stale(14)).toHaveLength(0);
    expect(deriveProblems(base({ openPrs: [{ ...pr(14), createdAt: daysAgo(14, 1) }] })).some((p) => p.kind === "stale_pr")).toBe(true);
    expect(stale(7.5, "security")).toHaveLength(1);
    expect(stale(7, "security")).toHaveLength(0);
  });

  it("ci_red je PR mit dedupeKey = PR-Nummer", () => {
    const r = deriveProblems(base({ openPrs: [
      { number: 7, updateType: "patch", ciStatus: "failure", createdAt: daysAgo(1) },
      { number: 8, updateType: "patch", ciStatus: "pending", createdAt: daysAgo(1) },
    ] }));
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ kind: "ci_red", dedupeKey: "7" });
    expect(r[0]!.message).toContain("#7");
  });

  it("missing_build_check nur bei onboarded + missing; eigene CI erzeugt keines", () => {
    const repo = (onboarding: ProblemInput["repo"]["onboarding"], buildCheck: ProblemInput["repo"]["buildCheck"]) => ({ archived: false, onboarding, buildCheck, ceStatus: null });
    expect(kinds(base({ repo: repo("onboarded", "missing") }))).toEqual(["missing_build_check"]);
    expect(kinds(base({ repo: repo("onboarded", "own_ci") }))).toEqual([]);
    expect(kinds(base({ repo: repo("onboarded", "pr_open") }))).toEqual([]);
    expect(kinds(base({ repo: repo("none", "missing") }))).toEqual([]);
    expect(kinds(base({ repo: repo("disabled", "missing") }))).toEqual([]);
  });
});

describe("reconcileProblems", () => {
  const t = new Date("2026-10-15T12:05:00Z");
  const d = (kind: "ci_red" | "job_failed", dedupeKey = "") => ({ kind, dedupeKey, message: "m" });

  it("neu -> insert, weiter da -> touch, weg -> resolve (Roter Build behoben)", () => {
    const existing = [{ id: "a", kind: "ci_red" as const, dedupeKey: "7" }, { id: "b", kind: "job_failed" as const, dedupeKey: "" }];
    const r = reconcileProblems(existing, [d("job_failed"), d("ci_red", "9")], t);
    expect(r.insert.map((p) => [p.kind, p.dedupeKey])).toEqual([["ci_red", "9"]]);
    expect(r.insert[0]!.firstSeenAt).toBe(t);
    expect(r.touch.map((p) => p.id)).toEqual(["b"]);
    expect(r.resolve.map((p) => p.id)).toEqual(["a"]);
    expect(r.resolve[0]!.resolvedAt).toBe(t);
  });

  it("gleiche Art mit anderem dedupeKey ist ein anderes Problem", () => {
    const r = reconcileProblems([{ kind: "ci_red" as const, dedupeKey: "1" }], [d("ci_red", "2")], t);
    expect(r.insert).toHaveLength(1);
    expect(r.resolve).toHaveLength(1);
    expect(r.touch).toHaveLength(0);
  });

  it("doppelt abgeleitete Probleme werden nur einmal eingefügt; leere Eingaben sind ok", () => {
    expect(reconcileProblems([], [d("job_failed"), d("job_failed")], t).insert).toHaveLength(1);
    expect(reconcileProblems([], [], t)).toEqual({ insert: [], touch: [], resolve: [] });
  });
});

/**
 * FIXTURES: selbst gebaute PR-Texte im Format von Renovate (verkürzt), keine aufgezeichneten Daten.
 */
const TABLE_HEAD = "| Package | Change | Age | Confidence |\n|---|---|---|---|";
const row = (cell: string) => `| ${cell} | [\`1.0.0\` -> \`1.1.0\`](https://example.test/diff) | age | conf |`;

describe("parseUpdatePackages", () => {
  it("Einzel-PR: Name aus dem Linktext der Tabelle", () => {
    const body = `This PR contains the following updates:\n\n${TABLE_HEAD}\n${row("[lodash](https://lodash.example/) ([source](https://git.example/lodash))")}\n\n---\n\nSome notes`;
    expect(parseUpdatePackages({ body, title: "Update dependency lodash to v1.1.0", branch: "renovate/lodash-1.x" })).toEqual(["lodash"]);
  });

  it("Gruppen-PR mit zwei Tabellen, Duplikaten und Zellen ohne Link", () => {
    const body = [
      "### npm",
      "",
      TABLE_HEAD,
      row("[@types/node](https://types.example/)"),
      row("[eslint](https://eslint.example/)"),
      "",
      "### github-actions",
      "",
      "| Package | Type | Update | Change |",
      "| :--- | :---: | --- | --- |",
      "| actions/checkout (source) | action | major | `v3` -> `v4` |",
      "| `ghcr.io/foo/bar` | docker | digest | x |",
      row("[eslint](https://eslint.example/)"),
      "",
      "Danach kommt wieder Text | mit | Strichen",
    ].join("\n");
    expect(parseUpdatePackages({ body, title: "Update all minor updates (minor)", branch: "renovate/all-minor-updates" })).toEqual([
      "@types/node",
      "eslint",
      "actions/checkout",
      "ghcr.io/foo/bar",
    ]);
  });

  it("Tabelle hat Vorrang vor dem Titel; ohne Package-Kopfzeile zählt sie nicht", () => {
    const body = `${TABLE_HEAD}\n${row("[real](https://x.example/)")}`;
    expect(parseUpdatePackages({ body, title: "Update dependency other to v2", branch: "renovate/other-2.x" })).toEqual(["real"]);
    const noPackageTable = "| Update | Change |\n|---|---|\n| lockFileMaintenance | All locks refreshed |";
    expect(parseUpdatePackages({ body: noPackageTable, title: "Update dependency other to v2", branch: "renovate/other-2.x" })).toEqual(["other"]);
  });

  it("Pin-PR ohne Tabelle: Name aus dem Titel", () => {
    expect(parseUpdatePackages({ body: "Pins the dependency.", title: "Pin dependency react to 19.0.0", branch: "renovate/react-19.x" })).toEqual(["react"]);
    expect(parseUpdatePackages({ body: null, title: "chore(deps): pin dependency @scope/pkg to 1.2.3", branch: "renovate/pin" })).toEqual(["@scope/pkg"]);
  });

  it.each([
    ["Update dependency lodash to v4", "lodash"],
    ["Update actions/checkout action to v4", "actions/checkout"],
    ["fix(deps): Update postgres Docker tag to v17", "postgres"],
    ["chore(deps): update ghcr.io/foo/bar docker tag to v1.2", "ghcr.io/foo/bar"],
    ["chore(deps)!: update dependency typescript to v6", "typescript"],
  ])("Titel \"%s\" -> %s", (title, expected) => {
    expect(parseUpdatePackages({ body: "", title, branch: "renovate/x" })).toEqual([expected]);
  });

  it("Lockfile-Maintenance, Gruppentitel und -branches liefern nie ein Paket", () => {
    const lock = "This PR contains the following updates:\n\n| Update | Change |\n|---|---|\n| lockFileMaintenance | All locks refreshed |";
    expect(parseUpdatePackages({ body: lock, title: "Lock file maintenance", branch: "renovate/lock-file-maintenance" })).toEqual([]);
    expect(parseUpdatePackages({ body: "", title: "chore(deps): lock file maintenance", branch: "renovate/lock-file-maintenance" })).toEqual([]);
    expect(parseUpdatePackages({ body: "", title: "Update dependency minor updates to v1", branch: "renovate/minor-updates" })).toEqual([]);
    expect(parseUpdatePackages({ body: "", title: "Update dependency foo to v1", branch: "renovate/npm-minor-updates" })).toEqual([]);
    expect(parseUpdatePackages({ body: "", title: "Update patch dependencies (patch)", branch: "renovate/all-patch" })).toEqual([]);
    expect(parseUpdatePackages({ body: "", title: "Pin dependencies", branch: "renovate/pin-dependencies" })).toEqual([]);
    expect(parseUpdatePackages({ body: "", title: "Irgendein Titel", branch: "renovate/x" })).toEqual([]);
  });

  it("ein Paket namens patch-package ist keine Gruppe", () => {
    expect(parseUpdatePackages({ body: "", title: "Update dependency patch-package to v8", branch: "renovate/patch-package-8.x" })).toEqual(["patch-package"]);
  });

  it("höchstens 50 Pakete, CRLF-Zeilenenden", () => {
    const rows = Array.from({ length: 60 }, (_, i) => row(`[pkg-${i}](https://x.example/)`));
    const body = [TABLE_HEAD, ...rows].join("\r\n");
    const names = parseUpdatePackages({ body, title: "x", branch: "renovate/x" });
    expect(names).toHaveLength(50);
    expect(names[0]).toBe("pkg-0");
  });
});
