"use server";

/**
 * Server Actions für das Mergen (Change dashboard-pr-merge): dünne Hüllen um die Logik in
 * `core/merge.ts`. Beide Funktionen sind für `bind` + `useActionState` gedacht; die Oberfläche
 * übergibt genau die Ziele, die sie beim Rendern kannte (Head-SHA und Methode).
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db/client";
import { getMergePlatform } from "@/merge/runtime";
import { BULK_MERGE_LIMIT, MERGE_METHODS, type MergeTarget } from "@/merge/types";
import { requireActor } from "./context";
import { bulkResultToState, mergeAllGreenCore, mergeOutcomeToState, mergePullRequestCore } from "./core/merge";
import { ActionError, runAction, type ActionState } from "./result";

const targetSchema = z.object({
  pullRequestId: z.uuid(),
  expectedSha: z.string().regex(/^[0-9a-f]{7,64}$/i),
  expectedMethod: z.enum(MERGE_METHODS),
});

/** Einen PR mergen, wenn die Live-Prüfung den angezeigten Stand bestätigt. */
export async function mergePullRequest(target: MergeTarget): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requireActor();
    const parsed = targetSchema.safeParse(target);
    if (!parsed.success) throw new ActionError("Ungültige Angaben zum Pull Request.");
    const outcome = await mergePullRequestCore(
      { db: getDb(), platform: getMergePlatform() },
      { ...parsed.data, actor },
    );
    revalidatePath("/", "layout");
    return mergeOutcomeToState(outcome, parsed.data.expectedMethod);
  });
}

/** Sammel-Merge: genau die beim Rendern übergebenen Ziele, nacheinander, höchstens 20. */
export async function mergeAllGreen(targets: MergeTarget[]): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requireActor();
    // Der Kern bearbeitet höchstens BULK_MERGE_LIMIT und meldet den Rest; absurd lange Listen lehnt
    // schon die Prüfung ab.
    const parsed = z.array(targetSchema).max(BULK_MERGE_LIMIT * 5).safeParse(targets);
    if (!parsed.success) throw new ActionError("Ungültige Angaben zu den Pull Requests.");
    const result = await mergeAllGreenCore(
      { db: getDb(), platform: getMergePlatform() },
      { targets: parsed.data, actor },
    );
    revalidatePath("/", "layout");
    return bulkResultToState(result);
  });
}
