import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  auditLog,
  platformConnections,
  repositories,
  rolloutActions,
} from "@/db/schema";
import {
  PlatformApiError,
  PlatformPermissionError,
  RateLimitPause,
  ROLLOUT_BRANCHES,
  type ChangeRequestRef,
  type ConnectionRef,
  type PlatformAdapter,
  type RepositoryRef,
} from "@/platform";
import { buildPullRequestText, type RolloutFile } from "./pr-text";
import type {
  NotNeededReason,
  RolloutKind,
  RolloutOutcome,
  RolloutRequest,
  RolloutService,
} from "./types";

/**
 * Eine `pending`-RolloutAction, die älter ist, gilt als abgebrochen (Prozess beendet) und blockiert
 * das Repo nicht länger.
 */
export const PENDING_TIMEOUT_MS = 10 * 60_000;

export type RolloutServiceDeps = {
  db: Db;
  adapter: PlatformAdapter;
  now?: () => Date;
};

type RepoRow = typeof repositories.$inferSelect;
type ActionRow = typeof rolloutActions.$inferSelect;

const AUDIT_ACTION: Record<RolloutKind, string> = {
  onboarding: "rollout.onboarding",
  build_check: "rollout.build_check",
};

const RUNNING_MESSAGE = "Für dieses Repo läuft bereits ein Rollout. Bitte kurz warten.";

function notNeeded(reason: NotNeededReason, message: string): RolloutOutcome {
  return { status: "not_needed", reason, message };
}

function isUniqueViolation(e: unknown): boolean {
  return [e, (e as { cause?: unknown } | null)?.cause].some(
    (c) => (c as { code?: unknown } | null)?.code === "23505",
  );
}

/** Verständliche Meldung ohne Token, Header oder Rohantwort der Plattform. */
function failureMessage(e: unknown): string {
  if (e instanceof PlatformPermissionError) return e.userMessage;
  if (e instanceof RateLimitPause) {
    return "Das Kontingent der Plattform ist knapp. Bitte später erneut versuchen.";
  }
  if (e instanceof PlatformApiError) {
    return e.status === 0
      ? "Die Plattform war nicht erreichbar. Bitte später erneut versuchen."
      : `Die Plattform hat die Anfrage abgelehnt (Status ${e.status}).`;
  }
  return "Unerwarteter Fehler beim Anlegen des Pull Requests.";
}

/** Vorprüfung auf Grundlage des gespeicherten Stands; null = der Rollout ist nötig. */
function precheck(kind: RolloutKind, repo: RepoRow): RolloutOutcome | null {
  if (repo.removedAt) return notNeeded("removed", "Das Repo ist auf der Plattform nicht mehr vorhanden.");
  if (repo.archived) return notNeeded("archived", "Das Repo ist archiviert.");
  const hasConfig =
    repo.configPath !== null ||
    repo.onboardingStatus === "onboarded" ||
    repo.onboardingStatus === "disabled";
  if (kind === "onboarding") {
    return hasConfig
      ? notNeeded("config_present", "Das Repo hat bereits eine Renovate-Konfiguration.")
      : null;
  }
  if (repo.buildCheckStatus === "active") {
    return notNeeded("build_check_present", "Der Build-Check ist bereits eingebunden.");
  }
  if (repo.ownCi || repo.buildCheckStatus === "own_ci") {
    return notNeeded("own_ci", "Das Repo ist als „eigene CI“ markiert.");
  }
  if (!hasConfig) {
    return notNeeded("not_onboarded", "Das Repo ist noch nicht onboardet. Zuerst den Onboarding-PR anlegen.");
  }
  return null;
}

/**
 * Rollout-Logik (design.md, Entscheidung 10): Onboarding- und Build-Check-PRs. Idempotent: ein
 * offener PR oder bereits vorhandene Dateien führen nie zu einem zweiten PR. Jede ausgeführte Aktion
 * landet als RolloutAction samt AuditLog-Eintrag (gemeinsame Transaktion beim Abschluss) in der
 * Datenbank. `not_needed` bleibt ohne Eintrag: Es wurde nichts ausgeführt und nichts verändert.
 */
export function createRolloutService(deps: RolloutServiceDeps): RolloutService {
  const { db, adapter } = deps;
  const clock = deps.now ?? (() => new Date());

  async function openAction(repositoryId: string, kind: RolloutKind): Promise<ActionRow | undefined> {
    const [row] = await db
      .select()
      .from(rolloutActions)
      .where(
        and(
          eq(rolloutActions.repositoryId, repositoryId),
          eq(rolloutActions.kind, kind),
          inArray(rolloutActions.status, ["pending", "pr_open"]),
        ),
      )
      .limit(1);
    return row;
  }

  /** Schreibt den Repo-Status nach einem offenen PR und den Audit-Eintrag in derselben Transaktion. */
  async function recordOpenPr(
    request: RolloutRequest,
    repo: RepoRow,
    actionId: string | null,
    pr: ChangeRequestRef,
  ): Promise<void> {
    await db.transaction(async (tx) => {
      const values = { status: "pr_open" as const, prUrl: pr.url, prNumber: pr.number, error: null };
      if (actionId) {
        await tx.update(rolloutActions).set(values).where(eq(rolloutActions.id, actionId));
      } else {
        await tx.insert(rolloutActions).values({
          repositoryId: repo.id,
          kind: request.kind,
          triggeredBy: request.actor,
          ...values,
        });
      }
      await tx
        .update(repositories)
        .set(
          request.kind === "onboarding"
            ? { onboardingStatus: "pr_open" }
            : { buildCheckStatus: "pr_open" },
        )
        .where(eq(repositories.id, repo.id));
      await tx.insert(auditLog).values({
        actor: request.actor,
        action: AUDIT_ACTION[request.kind],
        target: repo.fullName,
      });
    });
  }

  async function recordFailure(
    request: RolloutRequest,
    repo: RepoRow,
    actionId: string,
    message: string,
  ): Promise<void> {
    try {
      await db.transaction(async (tx) => {
        await tx
          .update(rolloutActions)
          .set({ status: "failed", error: message })
          .where(eq(rolloutActions.id, actionId));
        await tx.insert(auditLog).values({
          actor: request.actor,
          action: AUDIT_ACTION[request.kind],
          target: repo.fullName,
        });
      });
    } catch {
      // Datenbank nicht erreichbar: die Aktion bleibt pending und verfällt nach PENDING_TIMEOUT_MS.
      console.error("Rollout: Fehlschlag konnte nicht gespeichert werden.");
    }
  }

  /** Übernimmt einen vorhandenen offenen PR (Scenario „Wiederholter Klick“). */
  async function adopt(
    request: RolloutRequest,
    repo: RepoRow,
    open: ActionRow | undefined,
    pr: ChangeRequestRef,
  ): Promise<RolloutOutcome> {
    try {
      await recordOpenPr(request, repo, open?.id ?? null, pr);
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      // Parallel wurde eine offene Aktion angelegt: diese übernehmen.
      const row = await openAction(repo.id, request.kind);
      await recordOpenPr(request, repo, row?.id ?? null, pr);
    }
    return { status: "existing", prUrl: pr.url, prNumber: pr.number };
  }

  async function files(kind: RolloutKind, repo: RepoRow): Promise<{ list: RolloutFile[]; data: { path: string; content: string }[] }> {
    const list: RolloutFile[] = [];
    const data: { path: string; content: string }[] = [];
    if (kind === "onboarding") {
      const config = await adapter.readTemplate("renovate-config");
      list.push({ path: config.path, role: "config" });
      data.push(config);
    }
    // Die Aufrufdatei kommt nur dazu, wenn sie fehlt und das Repo keine eigene CI hat (Status
    // `missing`); ein offener Build-Check-PR würde sonst mit dem Onboarding-PR kollidieren.
    if (kind === "build_check" || (repo.buildCheckStatus === "missing" && !repo.ownCi)) {
      const caller = await adapter.readTemplate("build-check-caller");
      list.push({ path: caller.path, role: "caller" });
      data.push(caller);
    }
    return { list, data };
  }

  async function run(request: RolloutRequest): Promise<RolloutOutcome> {
    const [found] = await db
      .select({ repo: repositories, conn: platformConnections })
      .from(repositories)
      .innerJoin(platformConnections, eq(repositories.connectionId, platformConnections.id))
      .where(eq(repositories.id, request.repositoryId))
      .limit(1);
    if (!found) return notNeeded("removed", "Das Repo ist nicht bekannt.");
    const { repo, conn } = found;

    const skip = precheck(request.kind, repo);
    if (skip) return skip;
    if (conn.installationId === null) {
      return { status: "failed", message: "Für diesen Owner ist keine Installation der App hinterlegt." };
    }

    const connRef: ConnectionRef = {
      externalConnectionId: String(conn.installationId),
      ownerName: conn.ownerName,
    };
    const ref: RepositoryRef = { fullName: repo.fullName, defaultBranch: repo.defaultBranch };
    const branch = ROLLOUT_BRANCHES[request.kind];

    // Vor jeder Aktion: gibt es schon einen offenen PR? (bedingter Abruf, 304 kostet kein Kontingent)
    let open: ActionRow | undefined;
    try {
      const existing = await adapter.findOpenChangeRequest(connRef, ref, branch);
      open = await openAction(repo.id, request.kind);
      if (existing) return await adopt(request, repo, open, existing);

      if (open?.status === "pr_open" && open.prNumber !== null) {
        // Gespeicherter PR ist auf der Plattform nicht mehr offen: Endzustand nachziehen.
        const end = await adapter.getPullRequestState(connRef, ref, open.prNumber);
        if (end.state === "open" && open.prUrl) {
          return { status: "existing", prUrl: open.prUrl, prNumber: open.prNumber };
        }
        await db
          .update(rolloutActions)
          .set({ status: end.state === "merged" ? "merged" : "closed" })
          .where(eq(rolloutActions.id, open.id));
        if (end.state === "merged") {
          return request.kind === "onboarding"
            ? notNeeded("config_present", "Der Onboarding-PR wurde bereits gemergt.")
            : notNeeded("build_check_present", "Der Build-Check-PR wurde bereits gemergt.");
        }
      } else if (open?.status === "pending") {
        if (clock().getTime() - open.createdAt.getTime() < PENDING_TIMEOUT_MS) {
          return { status: "failed", message: RUNNING_MESSAGE };
        }
        await db
          .update(rolloutActions)
          .set({ status: "failed", error: "Abgebrochen: der Rollout wurde nicht abgeschlossen." })
          .where(eq(rolloutActions.id, open.id));
      }
    } catch (e) {
      // Noch nichts angelegt: keine RolloutAction, damit ein Wiederholen (auch das automatische) möglich bleibt.
      return { status: "failed", message: failureMessage(e) };
    }

    // Zuerst pending: der partielle Unique-Index fängt parallele Doppelklicks ab.
    let actionId: string;
    try {
      const [created] = await db
        .insert(rolloutActions)
        .values({
          repositoryId: repo.id,
          kind: request.kind,
          triggeredBy: request.actor,
          status: "pending",
          createdAt: clock(),
        })
        .returning({ id: rolloutActions.id });
      actionId = created!.id;
    } catch (e) {
      if (!isUniqueViolation(e)) return { status: "failed", message: failureMessage(e) };
      const other = await openAction(repo.id, request.kind);
      if (other?.status === "pr_open" && other.prUrl && other.prNumber !== null) {
        return { status: "existing", prUrl: other.prUrl, prNumber: other.prNumber };
      }
      return { status: "failed", message: RUNNING_MESSAGE };
    }

    try {
      const { list, data } = await files(request.kind, repo);
      const text = buildPullRequestText(request.kind, list);
      // Bei einem Fehler nach dem Anlegen des Branches löscht der Adapter ihn wieder.
      const pr = await adapter.createChangeRequest(connRef, ref, {
        branch,
        baseBranch: repo.defaultBranch,
        title: text.title,
        body: text.body,
        files: data,
      });
      await recordOpenPr(request, repo, actionId, pr);
      return { status: "created", prUrl: pr.url, prNumber: pr.number };
    } catch (e) {
      if (e instanceof RateLimitPause) {
        // Kein Fehlversuch des Repos: ohne Spur zurücknehmen, damit es später erneut drankommt.
        await db.delete(rolloutActions).where(eq(rolloutActions.id, actionId));
        return { status: "failed", message: failureMessage(e) };
      }
      const message = failureMessage(e);
      await recordFailure(request, repo, actionId, message);
      return { status: "failed", message };
    }
  }

  return { run };
}
