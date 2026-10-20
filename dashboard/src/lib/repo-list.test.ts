import { describe, expect, it } from "vitest";
import type { StatusTone } from "@/domain/status-tone";
import { sortByAttention, summarizeRepos, type RepoListItem } from "./repo-list";

const repo = (fullName: string, tone: StatusTone, onboarding: RepoListItem["onboarding"] = "onboarded"): RepoListItem => ({
  fullName,
  onboarding,
  health: { tone, label: tone },
});

describe("sortByAttention", () => {
  it("sortiert nach Handlungsbedarf, danach nach Name", () => {
    const rows = [
      repo("o/zeta", "erfolg"),
      repo("o/beta", "warnung"),
      repo("o/Alpha", "erfolg"),
      repo("o/gamma", "fehler"),
      repo("o/archiv", "neutral"),
      repo("o/laeuft", "laeuft"),
      repo("o/alpha-fehler", "fehler"),
    ];
    expect(sortByAttention(rows).map((r) => r.fullName)).toEqual([
      "o/alpha-fehler",
      "o/gamma",
      "o/beta",
      "o/laeuft",
      "o/Alpha",
      "o/zeta",
      "o/archiv",
    ]);
  });

  it("verändert die Eingabe nicht", () => {
    const rows = [repo("o/b", "erfolg"), repo("o/a", "fehler")];
    sortByAttention(rows);
    expect(rows[0].fullName).toBe("o/b");
  });
});

describe("summarizeRepos", () => {
  it("nennt Repos, onboardete und Entscheidungen", () => {
    const rows = [
      ...Array.from({ length: 9 }, (_, i) => repo(`o/ok${i}`, "erfolg")),
      repo("o/a", "fehler", "none"),
      repo("o/b", "warnung", "none"),
      repo("o/c", "warnung", "pr_open"),
      repo("o/d", "fehler"),
    ];
    // 13 Repos, 10 onboardet (9 + d), 4 Entscheidungen
    expect(summarizeRepos(rows)).toBe("13 Repos, 10 onboardet, 4 brauchen eine Entscheidung");
  });

  it("Einzahl und Null", () => {
    expect(summarizeRepos([repo("o/a", "fehler")])).toBe("1 Repo, 1 onboardet, 1 braucht eine Entscheidung");
    expect(summarizeRepos([repo("o/a", "erfolg")], true)).toBe(
      "1 Repo (gefiltert), 1 onboardet, keines braucht eine Entscheidung",
    );
  });

  it("leere Liste", () => {
    expect(summarizeRepos([])).toBe("Noch keine Repos.");
    expect(summarizeRepos([], true)).toBe("Keine Treffer für diese Filter.");
  });
});
