import { asc } from "drizzle-orm";
import type { Db } from "@/db/client";
import { platformConnections } from "@/db/schema";

export type OwnerSetting = {
  connectionId: string;
  owner: string;
  autoOnboarding: boolean;
  /** Seit wann der Schalter an ist; bleibt nach dem Ausschalten stehen. */
  autoOnboardingEnabledAt: Date | null;
};

/** Owner mit Schalter für automatisches Onboarding (Seite Repos). */
export async function listOwnerSettings(db: Db): Promise<OwnerSetting[]> {
  const rows = await db
    .select({
      connectionId: platformConnections.id,
      owner: platformConnections.ownerName,
      autoOnboarding: platformConnections.autoOnboarding,
      autoOnboardingEnabledAt: platformConnections.autoOnboardingEnabledAt,
    })
    .from(platformConnections)
    .orderBy(asc(platformConnections.ownerName));
  return rows;
}
