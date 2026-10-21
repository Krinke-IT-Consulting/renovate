import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { platformConnections } from "@/db/schema";
import { setAutoOnboarding } from "@/rollout/auto-onboarding";
import { ActionError, done, type ActionState } from "../result";

/**
 * Schalter "Automatisches Onboarding" je Owner (Spec dashboard-actions). Dieser Teil setzt nur das
 * Flag und den Zeitpunkt; die Wirkung (PRs für neu entdeckte Repos) liegt im Abgleich.
 * Beim Einschalten wird `auto_onboarding_enabled_at` gesetzt, beim Ausschalten bleibt der
 * Zeitpunkt stehen.
 */
export type AutoOnboardingDeps = { db: Db; actor: string; now?: Date };

const idSchema = z.uuid();

export async function setAutoOnboardingCore(
  deps: AutoOnboardingDeps,
  connectionId: string,
  enabled: boolean,
): Promise<ActionState> {
  const id = idSchema.safeParse(connectionId);
  if (!id.success) throw new ActionError("Unbekannter Owner.");
  const [conn] = await deps.db
    .select({ ownerName: platformConnections.ownerName })
    .from(platformConnections)
    .where(eq(platformConnections.id, id.data));
  if (!conn) throw new ActionError("Unbekannter Owner.");

  // Flag, Zeitpunkt und AuditLog setzt die Rollout-Logik in einer Transaktion (eine Quelle).
  const changed = await setAutoOnboarding(deps.db, id.data, enabled, deps.actor, deps.now ?? new Date());
  if (!changed) {
    return done("neutral", `Das automatische Onboarding für ${conn.ownerName} ist bereits ${enabled ? "an" : "aus"}.`);
  }
  return done(
    "erfolg",
    enabled
      ? `Automatisches Onboarding für ${conn.ownerName} ist an. Es gilt für Repos, die ab jetzt neu hinzukommen.`
      : `Automatisches Onboarding für ${conn.ownerName} ist aus.`,
  );
}
