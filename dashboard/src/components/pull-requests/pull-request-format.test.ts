import { describe, expect, it } from "vitest";
import { ageLabel, isStale, parseTargetVersion, sortPullRequests, versionJump } from "./pull-request-format";

describe("parseTargetVersion", () => {
  it.each([
    ["chore(deps): update dependency next to v16", "v16"],
    ["fix(deps): update dependency lodash to v4.17.21 [SECURITY]", "v4.17.21"],
    ["chore(deps): update actions/checkout digest to 11bd719", "11bd719"],
    ["chore(deps): update dependency requests to v2.33.0", "v2.33.0"],
    ["chore(deps): update dependency x to 1.2.3.", "1.2.3"],
  ])("%s -> %s", (title, expected) => {
    expect(parseTargetVersion(title)).toBe(expected);
  });

  it.each(["chore(deps): update expo monorepo", "chore(deps): lock file maintenance", "update to latest"])(
    "ohne Version: %s",
    (title) => {
      expect(parseTargetVersion(title)).toBeNull();
      expect(versionJump(title)).toBeNull();
    },
  );

  it("formatiert den Sprung", () => {
    expect(versionJump("update dependency next to v16")).toBe("→ v16");
  });
});

describe("isStale", () => {
  it("14 Tage, bei Sicherheit 7", () => {
    expect(isStale("minor", 13)).toBe(false);
    expect(isStale("minor", 14)).toBe(true);
    expect(isStale("security", 6)).toBe(false);
    expect(isStale("security", 7)).toBe(true);
  });
});

describe("ageLabel", () => {
  it("heute, 1 Tag, n Tagen", () => {
    expect(ageLabel(0)).toBe("heute");
    expect(ageLabel(1)).toBe("vor 1 Tag");
    expect(ageLabel(9)).toBe("vor 9 Tagen");
  });
});

describe("sortPullRequests", () => {
  const now = new Date("2026-10-20T12:00:00Z");
  const day = 86_400_000;
  const row = (repoFullName: string, updateType: "security" | "major" | "minor", ageDays: number) => ({
    repoFullName,
    updateType,
    createdAt: new Date(now.getTime() - ageDays * day),
  });
  const rows = [row("o/b", "minor", 2), row("o/a", "security", 9), row("o/c", "major", 20)];
  const names = (r: typeof rows) => r.map((x) => x.repoFullName);

  it("Alter absteigend: älteste zuerst", () => {
    expect(names(sortPullRequests(rows, { key: "alter", dir: "desc" }, now))).toEqual(["o/c", "o/a", "o/b"]);
    expect(names(sortPullRequests(rows, { key: "alter", dir: "asc" }, now))).toEqual(["o/b", "o/a", "o/c"]);
  });

  it("Typ absteigend: dringendster zuerst", () => {
    expect(names(sortPullRequests(rows, { key: "typ", dir: "desc" }, now))).toEqual(["o/a", "o/c", "o/b"]);
  });

  it("Repo nach Name, ohne die Eingabe zu verändern", () => {
    expect(names(sortPullRequests(rows, { key: "repo", dir: "asc" }, now))).toEqual(["o/a", "o/b", "o/c"]);
    expect(names(rows)).toEqual(["o/b", "o/a", "o/c"]);
  });
});
