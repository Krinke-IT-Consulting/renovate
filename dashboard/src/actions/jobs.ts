"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { requireActor } from "./context";
import { triggerAllRunsCore, triggerRepoRunCore } from "./core/jobs";
import { getCeClientFromEnv } from "./deps";
import { runAction, type ActionState } from "./result";

/**
 * Server Actions für Läufe. Als Formularaktion mit useActionState: `repositoryId` wird per bind
 * vorbelegt; der bisherige Zustand und das (leere) Formular, die React danach übergibt, braucht
 * keine Action. Next prüft dabei die Herkunft der Anfrage (Origin gegen Host).
 */
export async function triggerRepoRun(
  repositoryId: string,
): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requireActor();
    const state = await triggerRepoRunCore({ db: getDb(), ce: getCeClientFromEnv(), actor }, repositoryId);
    revalidatePath("/", "layout");
    return state;
  });
}

export async function triggerAllRuns(): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requireActor();
    const state = await triggerAllRunsCore({ db: getDb(), ce: getCeClientFromEnv(), actor });
    revalidatePath("/", "layout");
    return state;
  });
}
