import { eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { platformConnections, pullRequests, repositories } from "@/db/schema";
import {
  BULK_MERGE_LIMIT,
  BULK_MERGE_TYPES,
  MERGE_METHOD_LABEL,
  preferredMergeMethod,
  type MergeMethod,
  type MergeOutcome,
  type MergeSkipReason,
  type MergeTarget,
} from "@/merge/types";
import {
  PlatformApiError,
  PlatformHeadChangedError,
  PlatformPermissionError,
  PlatformRejectedError,
  RateLimitPause,
  type PlatformAdapter,
} from "@/platform";
import { formatTime, plural } from "@/lib/format";
import { writeAudit } from "../audit";
import { done, failed, type ActionState } from "../result";

/**
 * Mergen im Dashboard (Change dashboard-pr-merge, design.md Entscheidungen 4 und 5). Reine Logik
 * mit eingespritzter Plattform und Datenbank; die Server Actions in ../merge.ts sind dünne Hüllen.
 */
export type MergePlatform = Pick<PlatformAdapter, "getMergeReadiness" | "mergeChangeRequest">;

export type MergeDeps = {
  db: Db;
  platform: MergePlatform;
  now?: () => Date;
  /** Nur für Tests: Wartefunktion für die Pause zwischen zwei Merges im selben Repo. */
  sleep?: (ms: number) => Promise<void>;
  /** Nur für Tests: Uhr in Millisekunden für die Zeitgrenze des Sammel-Merges. */
  clockMs?: () => number;
  /** Zeitgrenze des Sammel-Merges in Millisekunden; Standard {@link BULK_TIME_LIMIT_MS}. */
  timeLimitMs?: number;
};

export type MergeRequestInput = MergeTarget & { actor: string };

/** Pause zwischen zwei Merges im selben Repo (Mergebarkeit neu berechnen, sekundäres Rate-Limit). */
export const BULK_PAUSE_MS = 1000;

/** Zeitgrenze des Sammel-Merges: danach werden die übrigen Ziele nicht mehr versucht. */
export const BULK_TIME_LIMIT_MS = 45_000;

const BULK_TYPES: readonly string[] = BULK_MERGE_TYPES;

type Row = {
  prId: string;
  number: number;
  url: string;
  state: "open" | "merged" | "closed";
  updateType: string;
  ciStatus: string;
  repoId: string;
  fullName: string;
  defaultBranch: string;
  archived: boolean;
  removedAt: Date | null;
  installationId: number | null;
  ownerName: string;
};

async function loadRows(db: Db, ids: string[]): Promise<Map<string, Row>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({
      prId: pullRequests.id,
      number: pullRequests.number,
      url: pullRequests.url,
      state: pullRequests.state,
      updateType: pullRequests.updateType,
      ciStatus: pullRequests.ciStatus,
      repoId: repositories.id,
      fullName: repositories.fullName,
      defaultBranch: repositories.defaultBranch,
      archived: repositories.archived,
      removedAt: repositories.removedAt,
      installationId: platformConnections.installationId,
      ownerName: platformConnections.ownerName,
    })
    .from(pullRequests)
    .innerJoin(repositories, eq(pullRequests.repositoryId, repositories.id))
    .innerJoin(platformConnections, eq(repositories.connectionId, platformConnections.id))
    .where(inArray(pullRequests.id, ids));
  return new Map(rows.map((r) => [r.prId, r]));
}

const CI_LABEL: Record<string, string> = {
  failure: "fehlgeschlagen",
  pending: "läuft noch",
  none: "keine CI",
  success: "grün",
};

function skipMessage(reason: MergeSkipReason, detail?: string): string {
  switch (reason) {
    case "changed":
      return "Der PR hat sich seit der Anzeige geändert (neuer Commit). Bitte die Ansicht neu laden und erneut prüfen.";
    case "not_open":
      return detail ?? "Der PR ist nicht mehr offen.";
    case "ci":
      return `Die CI des aktuellen Commits ist nicht grün (${detail ?? "unbekannt"}).`;
    case "conflict":
      return "Der PR hat Konflikte mit dem Ziel-Branch.";
    case "pending":
      return "Die Plattform prüft noch, ob der PR konfliktfrei ist. Bitte gleich erneut versuchen.";
    case "method_changed":
      return detail ?? "Die erlaubte Merge-Methode hat sich geändert. Bitte erneut bestätigen.";
    case "no_method":
      return detail ?? "Das Repo erlaubt keine Merge-Methode (Squash, Merge-Commit oder Rebase).";
    case "rejected":
      return detail ?? "Die Plattform lehnt den Merge ab.";
  }
}

/** Meldung zur Kontingent-Pause; mit Uhrzeit (Europe/Berlin), sobald das Reset-Datum bekannt ist. */
function pauseMessage(e: RateLimitPause): string {
  return e.resetAt
    ? `Kontingent knapp, wieder möglich ab ${formatTime(e.resetAt)}.`
    : "Das Kontingent der Plattform ist knapp. Bitte später erneut versuchen.";
}

/** Verständliche Meldung ohne Token, Header oder Rohantwort der Plattform. */
function failureMessage(e: unknown): string {
  if (e instanceof PlatformPermissionError || e instanceof PlatformRejectedError) return e.userMessage;
  if (e instanceof RateLimitPause) return pauseMessage(e);
  if (e instanceof PlatformApiError) {
    return e.status === 0
      ? "Die Plattform war nicht erreichbar. Bitte später erneut versuchen."
      : `Die Plattform hat die Anfrage abgelehnt (Status ${e.status}).`;
  }
  return "Unerwarteter Fehler beim Mergen.";
}

/** Audit-Eintrag eines Fehlschlags oder einer Auslassung; scheitert er, bleibt das Ergebnis gültig. */
async function auditQuietly(db: Db, entry: { actor: string; action: string; target: string }): Promise<void> {
  try {
    await writeAudit(db, entry);
  } catch {
    console.error(`Audit-Eintrag ${entry.action} konnte nicht geschrieben werden.`);
  }
}

async function skip(
  deps: MergeDeps,
  row: Row,
  actor: string,
  reason: MergeSkipReason,
  detail?: string,
): Promise<MergeOutcome> {
  await auditQuietly(deps.db, {
    actor,
    action: "pr.merge.skipped",
    target: `${row.fullName} #${row.number} (${reason})`,
  });
  return {
    status: "skipped",
    reason,
    message: skipMessage(reason, detail),
    prNumber: row.number,
    repoFullName: row.fullName,
  };
}

async function fail(deps: MergeDeps, row: Row, actor: string, message: string): Promise<MergeOutcome> {
  await auditQuietly(deps.db, { actor, action: "pr.merge.failed", target: `${row.fullName} #${row.number}` });
  return { status: "failed", message, prNumber: row.number, repoFullName: row.fullName };
}

/** Ergebnis von {@link attempt}, wenn das Kontingent der Plattform knapp ist (nur im Sammel-Merge). */
type Paused = { paused: RateLimitPause };

/** Einzel-Merge: eine Kontingent-Pause ist ein Fehlschlag mit Uhrzeit. */
async function attemptSingle(deps: MergeDeps, row: Row, input: MergeRequestInput): Promise<MergeOutcome> {
  const result = await attempt(deps, row, input, false);
  if ("paused" in result) return fail(deps, row, input.actor, pauseMessage(result.paused));
  return result;
}

/**
 * Live-Prüfung, Merge und Protokoll für einen geladenen PR. Mit `stopOnPause` (Sammel-Merge) wird
 * eine Kontingent-Pause nicht als Fehlschlag protokolliert, sondern an den Aufrufer gemeldet.
 */
async function attempt(
  deps: MergeDeps,
  row: Row,
  input: MergeRequestInput,
  stopOnPause = true,
): Promise<MergeOutcome | Paused> {
  const { actor } = input;
  const clock = deps.now ?? (() => new Date());
  if (row.removedAt) return fail(deps, row, actor, "Das Repo ist auf der Plattform nicht mehr vorhanden.");
  if (row.archived) return fail(deps, row, actor, "Das Repo ist archiviert; dort lässt sich nichts mergen.");
  if (row.installationId === null) {
    return fail(deps, row, actor, "Für diesen Owner ist keine Installation der App hinterlegt.");
  }
  if (row.state !== "open") return skip(deps, row, actor, "not_open");

  const conn = { externalConnectionId: String(row.installationId), ownerName: row.ownerName };
  const ref = { fullName: row.fullName, defaultBranch: row.defaultBranch };

  let readiness;
  try {
    readiness = await deps.platform.getMergeReadiness(conn, ref, row.number);
  } catch (e) {
    if (e instanceof RateLimitPause) return { paused: e };
    return fail(deps, row, actor, failureMessage(e));
  }

  if (readiness.state !== "open") return skip(deps, row, actor, "not_open");
  if (readiness.headSha !== input.expectedSha) return skip(deps, row, actor, "changed");
  if (readiness.blockedReason === "draft") {
    return skip(deps, row, actor, "rejected", "Der PR ist ein Entwurf.");
  }
  if (readiness.ci !== "success") {
    return skip(deps, row, actor, "ci", CI_LABEL[readiness.ci] ?? readiness.ci);
  }
  if (readiness.mergeable === false) return skip(deps, row, actor, "conflict");
  if (readiness.mergeable === null) return skip(deps, row, actor, "pending");
  if (readiness.blockedReason === "protection") {
    return skip(deps, row, actor, "rejected", "Branch-Schutz oder fehlende Freigaben verhindern den Merge.");
  }
  // "Unbekannt" (null) ist etwas anderes als "keine Methode erlaubt": die App kann sie nicht lesen.
  if (readiness.methods === null) {
    return skip(
      deps,
      row,
      actor,
      "no_method",
      "Die erlaubten Merge-Methoden sind nicht lesbar (Rechte der App prüfen).",
    );
  }
  const method = preferredMergeMethod(readiness.methods);
  if (!method) return skip(deps, row, actor, "no_method");
  if (method !== input.expectedMethod) {
    return skip(
      deps,
      row,
      actor,
      "method_changed",
      `Das Repo erlaubt jetzt ${MERGE_METHOD_LABEL[method]} statt ${MERGE_METHOD_LABEL[input.expectedMethod]}. Bitte erneut bestätigen.`,
    );
  }

  try {
    await deps.platform.mergeChangeRequest(conn, ref, row.number, { sha: input.expectedSha, method });
  } catch (e) {
    if (e instanceof PlatformHeadChangedError) return skip(deps, row, actor, "changed");
    if (e instanceof RateLimitPause && stopOnPause) return { paused: e };
    if (e instanceof PlatformRejectedError) {
      // Ein paralleler Merge desselben PRs (zweiter Tab) endet hier mit einer Ablehnung, obwohl der
      // PR gemergt ist: einmal neu lesen, bevor "lehnt ab" gemeldet wird.
      const again = await readAgain(deps, conn, ref, row.number);
      if (again === "merged") {
        await markMerged(deps, row, clock);
        return skip(deps, row, actor, "not_open", "Der PR ist bereits gemergt.");
      }
      if (again === "closed") return skip(deps, row, actor, "not_open");
      return skip(deps, row, actor, "rejected", e.userMessage);
    }
    return fail(deps, row, actor, failureMessage(e));
  }

  // Gemergt: ein Fehler beim Speichern darf das nicht als "fehlgeschlagen" melden (ein Wiederholen
  // wäre sinnlos). Der nächste Abgleich zieht den Stand ohnehin nach.
  try {
    await deps.db.transaction(async (tx) => {
      await tx
        .update(pullRequests)
        .set({ state: "merged", mergedAt: clock() })
        .where(eq(pullRequests.id, row.prId));
      await writeAudit(tx, { actor, action: "pr.merge", target: `${row.fullName} #${row.number}` });
    });
  } catch {
    console.error("Merge: Ergebnis konnte nicht gespeichert werden (der PR ist gemergt).");
    // Die Transaktion ist zurückgerollt, der Merge aber geschehen: das AuditLog trotzdem versuchen.
    await auditQuietly(deps.db, { actor, action: "pr.merge", target: `${row.fullName} #${row.number}` });
  }
  return { status: "merged", prUrl: row.url, prNumber: row.number, repoFullName: row.fullName };
}

/** Liest den Stand nach einer Ablehnung einmal neu; scheitert das Lesen, bleibt es bei der Ablehnung. */
async function readAgain(
  deps: MergeDeps,
  conn: { externalConnectionId: string; ownerName: string },
  ref: { fullName: string; defaultBranch: string },
  number: number,
): Promise<"merged" | "closed" | "open"> {
  try {
    const r = await deps.platform.getMergeReadiness(conn, ref, number);
    return r.state;
  } catch {
    return "open";
  }
}

async function markMerged(deps: MergeDeps, row: Row, clock: () => Date): Promise<void> {
  try {
    await deps.db
      .update(pullRequests)
      .set({ state: "merged", mergedAt: clock() })
      .where(eq(pullRequests.id, row.prId));
  } catch {
    console.error("Merge: Stand konnte nicht gespeichert werden (der PR ist gemergt).");
  }
}

const UNKNOWN_PR: MergeOutcome = {
  status: "failed",
  message: "Unbekannter Pull Request.",
  prNumber: null,
  repoFullName: null,
};

/** Einen PR mergen, wenn die Live-Prüfung genau den angezeigten Stand (Head-SHA, Methode) bestätigt. */
export async function mergePullRequestCore(deps: MergeDeps, input: MergeRequestInput): Promise<MergeOutcome> {
  const row = (await loadRows(deps.db, [input.pullRequestId])).get(input.pullRequestId);
  if (!row) return UNKNOWN_PR;
  return attemptSingle(deps, row, input);
}

export type BulkMergeResult = {
  outcomes: MergeOutcome[];
  /** Ziele über dem Limit, die nicht bearbeitet wurden. */
  ignored: number;
  /** Ziele, die wegen Zeitgrenze oder Kontingent-Pause nicht versucht wurden (kein Audit je Ziel). */
  notAttempted: number;
  /** Warum der Lauf vorzeitig endete. */
  stopped: "time" | "pause" | null;
  /** Bei `stopped === "pause"`: Zeitpunkt, ab dem das Kontingent wieder reicht, falls bekannt. */
  pauseResetAt: Date | null;
};

/**
 * Sammel-Merge: nur die übergebenen Ziele (höchstens BULK_MERGE_LIMIT), nacheinander. Jedes Ziel
 * muss serverseitig erneut ein offener Patch-/Minor-PR mit grüner CI sein, sonst wird es
 * übersprungen; danach folgt dieselbe Live-Prüfung wie beim Einzel-Merge.
 */
export async function mergeAllGreenCore(
  deps: MergeDeps,
  input: { targets: MergeTarget[]; actor: string },
): Promise<BulkMergeResult> {
  const unique = [...new Map(input.targets.map((t) => [t.pullRequestId, t])).values()];
  const targets = unique.slice(0, BULK_MERGE_LIMIT);
  const ignored = unique.length - targets.length;
  if (targets.length === 0) {
    return { outcomes: [], ignored, notAttempted: 0, stopped: null, pauseResetAt: null };
  }

  const rows = await loadRows(deps.db, targets.map((t) => t.pullRequestId));
  const repoCount = new Set([...rows.values()].map((r) => r.repoId)).size;
  // Zuerst protokollieren: scheitert das AuditLog, wird kein einziger PR ohne Spur gemergt.
  await writeAudit(deps.db, {
    actor: input.actor,
    action: "pr.merge_bulk",
    target: `${plural(targets.length, "PR", "PRs")} in ${plural(repoCount, "Repo", "Repos")}`,
  });

  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const clockMs = deps.clockMs ?? Date.now;
  const limitMs = deps.timeLimitMs ?? BULK_TIME_LIMIT_MS;
  const startedAt = clockMs();
  const outcomes: MergeOutcome[] = [];
  let lastMergedRepo: string | null = null;
  let stopped: BulkMergeResult["stopped"] = null;
  let pauseResetAt: Date | null = null;
  let handled = 0;
  for (const target of targets) {
    // Eine Server Action darf nicht beliebig lang laufen: danach wird nichts mehr versucht.
    if (clockMs() - startedAt >= limitMs) {
      stopped = "time";
      break;
    }
    handled++;
    const row = rows.get(target.pullRequestId);
    if (!row) {
      outcomes.push(UNKNOWN_PR);
      continue;
    }
    const request: MergeRequestInput = { ...target, actor: input.actor };
    let outcome: MergeOutcome;
    if (row.state !== "open") {
      outcome = await skip(deps, row, input.actor, "not_open");
    } else if (!BULK_TYPES.includes(row.updateType)) {
      outcome = await skip(deps, row, input.actor, "rejected", "Nur Patch- und Minor-Updates gehören zum Sammel-Merge.");
    } else if (row.ciStatus !== "success") {
      outcome = await skip(deps, row, input.actor, "ci", CI_LABEL[row.ciStatus] ?? row.ciStatus);
    } else {
      if (lastMergedRepo === row.repoId) await sleep(BULK_PAUSE_MS);
      const result = await attempt(deps, row, request);
      if ("paused" in result) {
        // Kontingent knapp: Weitermachen hilft nicht. Dieses und alle weiteren Ziele gelten als
        // nicht versucht und erhalten keinen pr.merge.failed.
        stopped = "pause";
        pauseResetAt = result.paused.resetAt;
        handled--;
        break;
      }
      outcome = result;
    }
    if (outcome.status === "merged") lastMergedRepo = row.repoId;
    outcomes.push(outcome);
  }
  return { outcomes, ignored, notAttempted: targets.length - handled, stopped, pauseResetAt };
}

const label = (o: { prNumber: number | null; repoFullName: string | null }) =>
  o.repoFullName && o.prNumber !== null ? `${o.repoFullName} #${o.prNumber}` : "PR";

export function mergeOutcomeToState(outcome: MergeOutcome, method?: MergeMethod): ActionState {
  switch (outcome.status) {
    case "merged":
      return done(
        "erfolg",
        `${label(outcome)} ist gemergt${method ? ` (${MERGE_METHOD_LABEL[method]})` : ""}.`,
        { href: outcome.prUrl, label: `PR #${outcome.prNumber} auf GitHub ansehen`, external: true },
      );
    case "skipped":
      return done("warnung", `${label(outcome)} wurde nicht gemergt: ${outcome.message}`);
    case "failed":
      return failed(outcome.message);
  }
}

export function bulkResultToState(result: BulkMergeResult): ActionState {
  const { outcomes, ignored, notAttempted, stopped, pauseResetAt } = result;
  if (outcomes.length === 0 && notAttempted === 0) return done("neutral", "Es gab keine PRs zum Mergen.");
  const merged = outcomes.filter((o) => o.status === "merged").length;
  const problems = outcomes.flatMap((o) =>
    o.status === "merged" ? [] : [`${label(o)}: ${o.message}`],
  );
  const skipped = problems.length;
  const head = `${plural(merged, "PR", "PRs")} gemergt, ${skipped} übersprungen`;
  const parts: string[] = [];
  if (stopped === "pause") {
    parts.push(
      pauseResetAt
        ? `Kontingent knapp, wieder möglich ab ${formatTime(pauseResetAt)}.`
        : "Das Kontingent der Plattform ist knapp. Bitte später erneut versuchen.",
    );
  }
  if (notAttempted > 0) {
    const why = stopped === "time" ? " (Zeitgrenze erreicht)" : "";
    parts.push(
      `${plural(notAttempted, "PR wurde", "PRs wurden")} nicht versucht${why}, bitte erneut auslösen.`,
    );
  }
  if (ignored > 0) {
    parts.push(
      `${plural(ignored, "weiterer PR blieb", "weitere PRs blieben")} wegen der Obergrenze von ${BULK_MERGE_LIMIT} unberührt.`,
    );
  }
  const tail = parts.length > 0 ? ` ${parts.join(" ")}` : "";
  const problemText = skipped > 0 ? ` ${problems.join(" ")}` : "";
  if (merged === 0 && skipped > 0 && notAttempted === 0 && outcomes.every((o) => o.status === "failed")) {
    return failed(`${head}.${problemText}${tail}`);
  }
  const warn = skipped > 0 || notAttempted > 0;
  return done(warn ? "warnung" : "erfolg", `${head}.${problemText}${tail}`);
}
