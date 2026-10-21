"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { requireActor } from "./context";
import { setAutoOnboardingCore } from "./core/settings";
import { runAction, type ActionState } from "./result";

/**
 * Schalter für automatisches Onboarding je Owner (platform_connections.id), per bind vorbelegt.
 * Bewusst hier und nicht in rollout/auto-onboarding.ts: Diese Datei setzt nur Flag und Zeitpunkt.
 */
export async function setAutoOnboarding(
  connectionId: string,
  enabled: boolean,
): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requireActor();
    const state = await setAutoOnboardingCore({ db: getDb(), actor }, connectionId, enabled === true);
    revalidatePath("/", "layout");
    return state;
  });
}
