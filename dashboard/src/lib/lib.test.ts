import { describe, expect, it } from "vitest";
import { ageInDays, formatDuration, formatRelative, formatTime, plural } from "./format";
import { parseFlag, parseList, parseOne, parsePage, parseSort, parseText, toggle, withParams } from "./search-params";
import { deriveRepoHealth, type RepoHealthInput } from "@/domain/status-tone";

describe("format", () => {
  const now = new Date("2026-10-20T12:00:00Z");

  it("relative Zeiten", () => {
    expect(formatRelative(new Date("2026-10-20T11:59:30Z"), now)).toBe("gerade eben");
    expect(formatRelative(new Date("2026-10-20T11:55:00Z"), now)).toBe("vor 5 Min.");
    expect(formatRelative(new Date("2026-10-20T09:00:00Z"), now)).toBe("vor 3 Std.");
    expect(formatRelative(new Date("2026-10-19T11:00:00Z"), now)).toBe("vor 1 Tag");
    expect(formatRelative(new Date("2026-10-08T12:00:00Z"), now)).toBe("vor 12 Tagen");
  });

  it("Uhrzeit in Europe/Berlin", () => {
    expect(formatTime(now)).toBe("14:00");
  });

  it("Dauer und Alter", () => {
    expect(formatDuration(42_000)).toBe("42 s");
    expect(formatDuration(185_000)).toBe("3 Min. 05 s");
    expect(formatDuration(3_720_000)).toBe("1 Std. 02 Min.");
    expect(formatDuration(null)).toBe("–");
    expect(ageInDays(new Date("2026-10-06T13:00:00Z"), now)).toBe(13);
  });

  it("Einzahl und Mehrzahl", () => {
    expect(plural(1, "offener PR", "offene PRs")).toBe("1 offener PR");
    expect(plural(3, "offener PR", "offene PRs")).toBe("3 offene PRs");
  });
});

describe("search-params", () => {
  it("Listen nur mit erlaubten Werten", () => {
    expect(parseList({ typ: "major,foo,security" }, "typ", ["security", "major", "minor"] as const)).toEqual([
      "security",
      "major",
    ]);
    expect(parseList({}, "typ", ["a"] as const)).toEqual([]);
  });

  it("Einzelwerte, Schalter, Seite, Text", () => {
    expect(parseOne({ ansicht: "behoben" }, "ansicht", ["offen", "behoben"] as const, "offen")).toBe("behoben");
    expect(parseOne({ ansicht: "x" }, "ansicht", ["offen", "behoben"] as const, "offen")).toBe("offen");
    expect(parseFlag({ entfernt: "1" }, "entfernt")).toBe(true);
    expect(parseFlag({}, "entfernt")).toBe(false);
    expect(parsePage({ seite: "3" })).toBe(3);
    expect(parsePage({ seite: "-1" })).toBe(1);
    expect(parseText({ q: "  lector " }, "q")).toBe("lector");
    expect(parseText({ q: "   " }, "q")).toBeUndefined();
    // Steuerzeichen (Nullbyte, Zeilenumbruch, Tab, DEL) fallen weg.
    expect(parseText({ q: "la\u0000ger\n-\tsync\u007f" }, "q")).toBe("lager-sync");
    expect(parseText({ q: "\u0001\u001f \u007f" }, "q")).toBeUndefined();
  });

  it("Sortierung", () => {
    expect(parseSort({ sort: "alter", dir: "asc" }, ["alter", "repo"] as const)).toEqual({ key: "alter", dir: "asc" });
    expect(parseSort({ sort: "alter" }, ["alter"] as const)).toEqual({ key: "alter", dir: "desc" });
    expect(parseSort({ sort: "x" }, ["alter"] as const)).toBeNull();
  });

  it("Adresse ändern setzt die Seite zurück", () => {
    expect(withParams("/pull-requests", { typ: "major", seite: "2" }, { ci: ["failure"] })).toBe(
      "/pull-requests?typ=major&ci=failure",
    );
    expect(withParams("/pull-requests", { typ: "major" }, { typ: [] })).toBe("/pull-requests");
    expect(withParams("/jobs", { status: "failed" }, { seite: "2" })).toBe("/jobs?status=failed&seite=2");
  });

  it("toggle", () => {
    expect(toggle(["a", "b"], "a")).toEqual(["b"]);
    expect(toggle(["a"], "b")).toEqual(["a", "b"]);
  });
});

describe("deriveRepoHealth", () => {
  const base: RepoHealthInput = {
    archived: false,
    removed: false,
    onboarding: "onboarded",
    openProblemKinds: [],
    openSecurityPrs: 0,
    openMajorPrs: 0,
    jobActive: false,
  };

  it("Aktuell ohne Befund", () => {
    expect(deriveRepoHealth(base)).toEqual({ tone: "erfolg", label: "Aktuell" });
  });

  it("Sicherheitsupdates vor Fehlern", () => {
    expect(deriveRepoHealth({ ...base, openSecurityPrs: 2, openProblemKinds: ["ci_red"] })).toEqual({
      tone: "fehler",
      label: "2 Sicherheitsupdates",
    });
  });

  it("Fehler in fester Reihenfolge", () => {
    expect(deriveRepoHealth({ ...base, openProblemKinds: ["ci_red", "config_error"] }).label).toBe(
      "Konfigurationsfehler",
    );
  });

  it("Warnungen und Läuft", () => {
    expect(deriveRepoHealth({ ...base, onboarding: "none" })).toEqual({ tone: "warnung", label: "Nicht onboardet" });
    expect(deriveRepoHealth({ ...base, openMajorPrs: 1 }).label).toBe("Major zur Freigabe");
    expect(deriveRepoHealth({ ...base, jobActive: true }).tone).toBe("laeuft");
  });

  it("Entfernt und archiviert sind neutral", () => {
    expect(deriveRepoHealth({ ...base, removed: true, openSecurityPrs: 1 }).label).toBe("Entfernt");
    expect(deriveRepoHealth({ ...base, archived: true }).label).toBe("Archiviert");
  });
});
