"use server";

import { revalidatePath } from "next/cache";
import { getRolloutServiceForActions } from "@/rollout/registry";
import type { RolloutKind } from "@/rollout/types";
import { requireActor } from "./context";
import { runRolloutCore } from "./core/rollout";
import { runAction, type ActionState } from "./result";

async function run(repositoryId: string, kind: RolloutKind): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requireActor();
    const state = await runRolloutCore({ service: getRolloutServiceForActions(), actor }, repositoryId, kind);
    revalidatePath("/", "layout");
    return state;
  });
}

/** Onboarding-PR anlegen; `repositoryId` per bind vorbelegt. */
export async function createOnboardingPr(
  repositoryId: string,
): Promise<ActionState> {
  return run(repositoryId, "onboarding");
}

/** Build-Check-PR anlegen (nur die Aufrufdatei); `repositoryId` per bind vorbelegt. */
export async function createBuildCheckPr(
  repositoryId: string,
): Promise<ActionState> {
  return run(repositoryId, "build_check");
}
