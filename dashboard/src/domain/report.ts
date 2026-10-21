import { STALE_PR_DAYS, STALE_SECURITY_PR_DAYS, type ProblemKind } from "./problems";
import type { CiStatus, UpdateType } from "./pull-requests";
import { repoDetailHref } from "@/lib/repo-detail-href";
import { CI_STATUS_LABEL, PROBLEM_KIND_LABEL, type StatusTone } from "./status-tone";
import { versionJump } from "./version-jump";

export { versionJump };

/**
 * Lagebericht (Spec dashboard-views, "Lagebericht als Übersicht"): Schritte in fester Reihenfolge
 * und ein Absatz aus festen Textbausteinen, kein frei formulierter Text. Reine Funktionen, damit
 * die Scenarios ohne Datenbank testbar sind.
 */

export const STEP_GROUPS = ["security", "failure", "major", "onboarding", "stale"] as const;
export type StepGroup = (typeof STEP_GROUPS)[number];

export const STEP_GROUP_TITLE: Record<StepGroup, string> = {
  security: "Sicherheitsupdates",
  failure: "Rote Builds und fehlgeschlagene Läufe",
  major: "Major-Updates zur Freigabe",
  onboarding: "Nicht onboardete Repos",
  stale: "Hängende PRs",
};

/** Tonlage je Gruppe (Anzeige der Schritte im Lagebericht und im Repo-Detail). */
export const GROUP_TONE: Record<StepGroup, StatusTone> = {
  security: "fehler",
  failure: "fehler",
  major: "warnung",
  onboarding: "warnung",
  stale: "warnung",
};

/**
 * Schritte für die Anzeige zusammenführen (Auto-Refresh): `seen` ist, was bisher gezeigt wurde,
 * `current` der frische Stand. Bekannte Schritte zeigen die aktuelle Fassung an ihrer Stelle,
 * verschwundene bleiben als Snapshot stehen (der Aufrufer markiert sie als erledigt), neue
 * kommen ans Ende. So springt nichts, und die Nummern bleiben stabil.
 */
export function mergeSteps(seen: readonly Step[], current: readonly Step[]): Step[] {
  const byId = new Map(current.map((s) => [s.id, s]));
  const known = new Set(seen.map((s) => s.id));
  return [...seen.map((s) => byId.get(s.id) ?? s), ...current.filter((s) => !known.has(s.id))];
}

export type ReportPr = {
  id: string;
  number: number;
  title: string;
  url: string;
  updateType: UpdateType;
  packageNames: string[];
  ciStatus: CiStatus;
  createdAt: Date;
  repoFullName: string;
};

export type ReportProblem = {
  id: string;
  kind: ProblemKind;
  message: string;
  firstSeenAt: Date;
  repoFullName: string;
  /** PR-Nummer bei ci_red und stale_pr (dedupe_key), sonst null. */
  prNumber: number | null;
  /** URL des PR, falls er noch offen ist. */
  prUrl: string | null;
  prIsSecurity: boolean;
};

export type ReportRepo = {
  /** Repo-ID; mit ihr ist der Onboarding-Schritt eine Aktion, ohne sie führt er zum Repo. */
  id?: string;
  fullName: string;
  onboarding: "none" | "pr_open" | "onboarded" | "disabled";
  archived: boolean;
};

export type ReportInput = {
  now: Date;
  repos: ReportRepo[];
  openPrs: ReportPr[];
  openProblems: ReportProblem[];
  /** Es gab schon mindestens einen Renovate-Lauf. */
  hasAnyJob: boolean;
  /** Nächster geplanter Lauf, sofern bekannt. */
  nextRunAt?: Date | null;
};

/**
 * Hauptaktion eines Schritts: ein Link (intern oder extern) oder eine Aktion mit Bestätigung. Die
 * Oberfläche rendert "onboarding" als Bestätigungsdialog, der den Onboarding-PR anlegt.
 */
export type StepAction =
  | { kind: "link"; label: string; href: string; external: boolean }
  | { kind: "onboarding"; label: string; repositoryId: string; repoFullName: string };

export type Step = {
  id: string;
  group: StepGroup;
  typeLabel: string;
  title: string;
  /** Versionssprung in Monospace, sofern aus dem Titel ableitbar. */
  version: string | null;
  repoFullName: string;
  detail: string[];
  action: StepAction;
};

const DAY_MS = 86_400_000;

function days(from: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - from.getTime()) / DAY_MS));
}

function ageText(from: Date, now: Date): string {
  const d = days(from, now);
  return d === 0 ? "seit heute offen" : d === 1 ? "seit 1 Tag offen" : `seit ${d} Tagen offen`;
}

/** Paket(e) eines PR für die Anzeige; ohne Paketnamen der Titel. */
function prSubject(pr: ReportPr): string {
  if (pr.packageNames.length === 0) return pr.title;
  if (pr.packageNames.length <= 2) return pr.packageNames.join(", ");
  return `${pr.packageNames[0]} und ${pr.packageNames.length - 1} weitere`;
}

/** Kurzname eines Repos ohne Owner. */
export function shortName(fullName: string): string {
  return fullName.split("/").pop() ?? fullName;
}

function byAgeThenRepo<T extends { createdAt?: Date; firstSeenAt?: Date; repoFullName: string }>(a: T, b: T) {
  const ta = (a.createdAt ?? a.firstSeenAt)!.getTime();
  const tb = (b.createdAt ?? b.firstSeenAt)!.getTime();
  return ta - tb || a.repoFullName.localeCompare(b.repoFullName);
}

/** Titel als Aufgabe formuliert; die gespeicherte Kurzbeschreibung steht in der Detailzeile. */
const FAILURE_TITLE: Partial<Record<ProblemKind, string>> = {
  config_error: "Konfiguration prüfen",
  job_failed: "Fehlgeschlagenen Lauf klären",
  lockfile_failure: "Lockfile reparieren",
  ci_red: "Rote CI klären",
};

const FAILURE_KINDS: readonly ProblemKind[] = ["config_error", "job_failed", "lockfile_failure", "ci_red"];

/** Alle offenen Schritte in fester Gruppenreihenfolge; innerhalb einer Gruppe älteste zuerst. */
export function buildSteps(input: ReportInput): Step[] {
  const { now } = input;
  const steps: Step[] = [];

  const security = input.openPrs.filter((p) => p.updateType === "security").sort(byAgeThenRepo);
  for (const pr of security) {
    const stale = days(pr.createdAt, now) >= STALE_SECURITY_PR_DAYS;
    steps.push({
      id: `pr:${pr.id}`,
      group: "security",
      typeLabel: "Sicherheitsupdate",
      title: prSubject(pr),
      version: versionJump(pr.title),
      repoFullName: pr.repoFullName,
      detail: [CI_STATUS_LABEL[pr.ciStatus], ageText(pr.createdAt, now) + (stale ? ", hängt" : "")],
      action: { kind: "link", label: "Auf GitHub mergen", href: pr.url, external: true },
    });
  }

  const failures = input.openProblems
    .filter((p) => FAILURE_KINDS.includes(p.kind))
    .sort(
      (a, b) =>
        FAILURE_KINDS.indexOf(a.kind) - FAILURE_KINDS.indexOf(b.kind) || byAgeThenRepo(a, b),
    );
  for (const p of failures) {
    const prAction = p.kind === "ci_red" && p.prUrl;
    steps.push({
      id: `problem:${p.id}`,
      group: "failure",
      typeLabel: PROBLEM_KIND_LABEL[p.kind],
      title: p.kind === "ci_red" && p.prNumber !== null ? `PR #${p.prNumber}` : (FAILURE_TITLE[p.kind] ?? p.message),
      version: null,
      repoFullName: p.repoFullName,
      detail: [p.message, `seit ${formatDays(days(p.firstSeenAt, now))}`],
      action: prAction
        ? { kind: "link", label: "PR ansehen", href: p.prUrl!, external: true }
        : {
            kind: "link",
            label: "Log ansehen",
            href: `/jobs?repo=${encodeURIComponent(p.repoFullName)}${p.kind === "lockfile_failure" ? "" : "&status=failed"}`,
            external: false,
          },
    });
  }

  const major = input.openPrs.filter((p) => p.updateType === "major").sort(byAgeThenRepo);
  for (const pr of major) {
    steps.push({
      id: `pr:${pr.id}`,
      group: "major",
      typeLabel: "Major-Update",
      title: prSubject(pr),
      version: versionJump(pr.title),
      repoFullName: pr.repoFullName,
      detail: [CI_STATUS_LABEL[pr.ciStatus], ageText(pr.createdAt, now)],
      action: { kind: "link", label: "Freigeben", href: pr.url, external: true },
    });
  }

  const notOnboarded = input.repos
    .filter((r) => !r.archived && r.onboarding === "none")
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
  for (const r of notOnboarded) {
    steps.push({
      id: `onboarding:${r.fullName}`,
      group: "onboarding",
      typeLabel: "Onboarding",
      title: shortName(r.fullName),
      version: null,
      repoFullName: r.fullName,
      detail: ["Noch keine Renovate-Konfiguration"],
      // Mit Repo-ID legt der Schritt den Onboarding-PR an (nach Bestätigung); sonst führt er zum Repo.
      action: r.id
        ? { kind: "onboarding", label: "Onboarding-PR anlegen", repositoryId: r.id, repoFullName: r.fullName }
        : { kind: "link", label: "Zum Repo", href: repoDetailHref(r.fullName), external: false },
    });
  }

  // Hängende Sicherheits-PRs stehen schon in Schritt 1.
  const stale = input.openProblems.filter((p) => p.kind === "stale_pr" && !p.prIsSecurity).sort(byAgeThenRepo);
  for (const p of stale) {
    steps.push({
      id: `problem:${p.id}`,
      group: "stale",
      typeLabel: "PR hängt",
      title: p.prNumber !== null ? `PR #${p.prNumber}` : p.message,
      version: null,
      repoFullName: p.repoFullName,
      detail: [p.message, `älter als ${STALE_PR_DAYS} Tage`],
      action: p.prUrl
        ? { kind: "link", label: "Auf GitHub öffnen", href: p.prUrl, external: true }
        : { kind: "link", label: "Zum Repo", href: repoDetailHref(p.repoFullName), external: false },
    });
  }

  return steps;
}

function formatDays(d: number): string {
  return d === 0 ? "heute" : d === 1 ? "1 Tag" : `${d} Tagen`;
}

/* ---------- Absatz aus Textbausteinen ---------- */

export type ReportSegment = { text: string } | { text: string; href: string };

const GROUP_LINK: Record<StepGroup, string> = {
  security: "/pull-requests?typ=security",
  failure: "/probleme?art=config_error,job_failed,lockfile_failure,ci_red",
  major: "/pull-requests?typ=major",
  onboarding: "/repos?onboarding=none",
  stale: "/probleme?art=stale_pr",
};

const GROUP_NOUN: Record<StepGroup, [one: string, many: string]> = {
  security: ["Sicherheitsupdate", "Sicherheitsupdates"],
  failure: ["roter Build oder fehlgeschlagener Lauf", "rote Builds und fehlgeschlagene Läufe"],
  major: ["Major-Update zur Freigabe", "Major-Updates zur Freigabe"],
  onboarding: ["Repo ohne Onboarding", "Repos ohne Onboarding"],
  stale: ["hängender PR", "hängende PRs"],
};

/** "a", "a und b", "a, b und c" */
export function joinGerman(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} und ${parts[parts.length - 1]}`;
}

function wherePhrase(repoFullNames: string[]): string {
  const repos = [...new Set(repoFullNames.map(shortName))];
  if (repos.length <= 3) return ` in ${joinGerman(repos)}`;
  return ` in ${repos.length} Repos`;
}

const NUMBER_WORDS = ["Null", "Ein", "Zwei", "Drei", "Vier", "Fünf", "Sechs", "Sieben", "Acht", "Neun", "Zehn", "Elf", "Zwölf"];

export type Report = {
  kind: "first-run" | "all-clear" | "open";
  segments: ReportSegment[];
};

export function buildReport(input: ReportInput, steps: Step[]): Report {
  const active = input.repos.filter((r) => !r.archived);
  const onboarded = active.filter((r) => r.onboarding === "onboarded").length;

  if (onboarded === 0 && !input.hasAnyJob) {
    const waiting = active.filter((r) => r.onboarding === "none").length;
    return {
      kind: "first-run",
      segments: [
        { text: "Noch ist kein Repo onboardet, und Renovate ist noch nicht gelaufen. " },
        waiting > 0
          ? { text: `${waiting} ${waiting === 1 ? "Repo wartet" : "Repos warten"} auf das Onboarding`, href: GROUP_LINK.onboarding }
          : { text: "Sobald die App in einem Repo installiert ist, erscheint es hier" },
        { text: "." },
      ],
    };
  }

  if (steps.length === 0) {
    const segments: ReportSegment[] = [{ text: "Alles aktuell." }];
    if (input.nextRunAt) {
      const t = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" }).format(input.nextRunAt);
      segments.push({ text: ` Nächster Lauf um ${t}.` });
    }
    return { kind: "all-clear", segments };
  }

  const n = steps.length;
  const lead = n <= 12 ? NUMBER_WORDS[n] : String(n);
  const segments: ReportSegment[] = [
    { text: n === 1 ? "Ein Punkt braucht Ihre Entscheidung: " : `${lead} Punkte brauchen Ihre Entscheidung: ` },
  ];

  // Die Zahl "hängende PRs" nennt alle offenen stale_pr-Probleme, denn der Link zeigt sie alle.
  // Die Schritte lassen hängende Sicherheits-PRs aus (sie stehen schon in Schritt 1).
  const stale = input.openProblems.filter((p) => p.kind === "stale_pr").sort(byAgeThenRepo);
  const groups = STEP_GROUPS.map((g) => {
    const items = steps.filter((s) => s.group === g);
    const repoFullNames = g === "stale" ? stale.map((p) => p.repoFullName) : items.map((s) => s.repoFullName);
    return { g, items, count: g === "stale" ? stale.length : items.length, repoFullNames };
  }).filter((x) => x.count > 0);
  groups.forEach(({ g, items, count, repoFullNames }, i) => {
    if (i > 0) segments.push({ text: i === groups.length - 1 ? " und " : ", " });
    const [one, many] = GROUP_NOUN[g];
    segments.push({ text: `${count} ${count === 1 ? one : many}`, href: GROUP_LINK[g] });
    if (g !== "onboarding") segments.push({ text: wherePhrase(repoFullNames) });
    else if (items.length <= 3) segments.push({ text: ` (${joinGerman(items.map((s) => s.title))})` });
  });
  segments.push({ text: "." });

  const affected = new Set(steps.map((s) => s.repoFullName));
  const calm = active.filter((r) => r.onboarding === "onboarded" && !affected.has(r.fullName)).length;
  if (calm > 0) {
    segments.push({ text: ` ${calm === 1 ? "Ein weiteres Repo ist" : `${calm} weitere Repos sind`} aktuell.` });
  }
  return { kind: "open", segments };
}
