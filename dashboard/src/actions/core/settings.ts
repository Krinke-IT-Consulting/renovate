import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { platformConnections } from "@/db/schema";
import { writeAudit } from "../audit";
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
  const now = deps.now ?? new Date();

  return deps.db.transaction(async (tx) => {
    const [conn] = await tx
      .select({ ownerName: platformConnections.ownerName, on: platformConnections.autoOnboarding })
      .from(platformConnections)
      .where(eq(platformConnections.id, id.data))
      .for("update");
    if (!conn) throw new ActionError("Unbekannter Owner.");
    if (conn.on === enabled) {
      return done("neutral", `Das automatische Onboarding für ${conn.ownerName} ist bereits ${enabled ? "an" : "aus"}.`);
    }

    await tx
      .update(platformConnections)
      .set(enabled ? { autoOnboarding: true, autoOnboardingEnabledAt: now } : { autoOnboarding: false })
      .where(eq(platformConnections.id, id.data));
    await writeAudit(tx, {
      actor: deps.actor,
      action: "settings.auto_onboarding",
      target: `${conn.ownerName}: ${enabled ? "an" : "aus"}`,
    });

    return done(
      "erfolg",
      enabled
        ? `Automatisches Onboarding für ${conn.ownerName} ist an. Es gilt für Repos, die ab jetzt neu hinzukommen.`
        : `Automatisches Onboarding für ${conn.ownerName} ist aus.`,
    );
  });
}
