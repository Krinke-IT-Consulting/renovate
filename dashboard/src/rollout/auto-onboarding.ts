import { and, asc, eq, gt, isNotNull, isNull, notExists, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  auditLog,
  platformConnections,
  repositories,
  rolloutActions,
} from "@/db/schema";
import type { RolloutService } from "./types";

/** Höchstens so viele automatische Onboarding-PRs je Connection und Durchlauf (design.md, Entscheidung 10). */
export const AUTO_ONBOARDING_LIMIT = 5;

/** Auslöser im AuditLog und `triggered_by` der RolloutAction. */
export const AUTO_ACTOR = "auto";

/**
 * Schalter „automatisches Onboarding“ je Owner (Connection). Beim Einschalten wird
 * `auto_onboarding_enabled_at` auf `now` gesetzt: Repos, die davor bekannt waren, bekommen nie einen
 * automatischen PR. Beim Ausschalten bleibt der Zeitpunkt stehen. Schreibt den AuditLog-Eintrag
 * `settings.auto_onboarding` in derselben Transaktion. Gibt false zurück, wenn der Schalter schon so
 * stand (kein Eintrag, der Zeitpunkt bleibt unverändert).
 */
export async function setAutoOnboarding(
  db: Db,
  connectionId: string,
  enabled: boolean,
  actor: string,
  now: Date = new Date(),
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [conn] = await tx
      .select({
        ownerName: platformConnections.ownerName,
        autoOnboarding: platformConnections.autoOnboarding,
      })
      .from(platformConnections)
      .where(eq(platformConnections.id, connectionId))
      .for("update");
    if (!conn) throw new Error("Verbindung nicht gefunden");
    if (conn.autoOnboarding === enabled) return false;
    await tx
      .update(platformConnections)
      .set(
        enabled
          ? { autoOnboarding: true, autoOnboardingEnabledAt: now }
          : { autoOnboarding: false },
      )
      .where(eq(platformConnections.id, connectionId));
    await tx.insert(auditLog).values({
      actor,
      action: "settings.auto_onboarding",
      target: `${conn.ownerName}: ${enabled ? "an" : "aus"}`,
    });
    return true;
  });
}

export type AutoOnboardingResult = {
  /** Repos, für die ein Rollout angestoßen wurde (auch fehlgeschlagene). */
  attempted: number;
  created: number;
  partialErrors: { repository: string; message: string }[];
};

/**
 * Automatisches Onboarding im Plattform-Abgleich. Ausgewählt werden Repos mit eingeschaltetem Schalter,
 * die nach dem Einschalten zum ersten Mal gesehen wurden, nicht archiviert, nicht entfernt und ohne
 * Konfiguration sind und für die es noch nie eine Onboarding-RolloutAction gab (egal in welchem
 * Status: ein geschlossener Auto-PR oder ein Fehlschlag wird so nie wiederholt; danach ist ein manueller
 * Klick nötig). Das Limit gilt je Connection. Der Inhalt muss gelesen sein
 * (`head_sha` gesetzt), sonst gälte "keine Konfiguration" nur aus Unwissen. Fehler je Repo sind
 * Teilfehler, kein Abbruch.
 */
export async function runAutoOnboarding(options: {
  db: Db;
  rollout: RolloutService;
  limit?: number;
}): Promise<AutoOnboardingResult> {
  const { db, rollout } = options;
  const result: AutoOnboardingResult = { attempted: 0, created: 0, partialErrors: [] };
  const connections = await db
    .select({ id: platformConnections.id })
    .from(platformConnections)
    .where(
      and(eq(platformConnections.autoOnboarding, true), isNotNull(platformConnections.autoOnboardingEnabledAt)),
    )
    .orderBy(asc(platformConnections.ownerName));

  // Das Limit gilt je Connection: ein Owner mit hartnäckigen Fehlern verdrängt keinen anderen.
  for (const connection of connections) {
    const candidates = await db
      .select({ id: repositories.id, fullName: repositories.fullName })
      .from(repositories)
      .innerJoin(platformConnections, eq(repositories.connectionId, platformConnections.id))
      .where(
        and(
          eq(repositories.connectionId, connection.id),
          gt(repositories.firstSeenAt, platformConnections.autoOnboardingEnabledAt),
          eq(repositories.archived, false),
          isNull(repositories.removedAt),
          isNull(repositories.configPath),
          eq(repositories.onboardingStatus, "none"),
          isNotNull(repositories.headSha),
          notExists(
            db
              .select({ one: sql`1` })
              .from(rolloutActions)
              .where(
                and(
                  eq(rolloutActions.repositoryId, repositories.id),
                  eq(rolloutActions.kind, "onboarding"),
                ),
              ),
          ),
        ),
      )
      .orderBy(asc(repositories.firstSeenAt))
      .limit(options.limit ?? AUTO_ONBOARDING_LIMIT);

    for (const repo of candidates) {
      result.attempted++;
      try {
        const outcome = await rollout.run({
          repositoryId: repo.id,
          kind: "onboarding",
          actor: AUTO_ACTOR,
          recordEarlyFailure: true,
        });
        if (outcome.status === "created") result.created++;
        if (outcome.status === "failed") {
          result.partialErrors.push({
            repository: repo.fullName,
            message: `Automatisches Onboarding: ${outcome.message}`,
          });
        }
      } catch {
        result.partialErrors.push({
          repository: repo.fullName,
          message: "Automatisches Onboarding: Unerwarteter Fehler",
        });
      }
    }
  }
  return result;
}
