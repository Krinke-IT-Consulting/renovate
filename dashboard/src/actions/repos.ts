"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { requireActor } from "./context";
import { setOwnCiCore } from "./core/repos";
import { runAction, type ActionState } from "./result";

/** Markierung "eigene CI" setzen (`value` true) oder aufheben (false); per bind vorbelegt. */
export async function setOwnCi(
  repositoryId: string,
  value: boolean,
): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requireActor();
    const state = await setOwnCiCore({ db: getDb(), actor }, repositoryId, value === true);
    revalidatePath("/", "layout");
    return state;
  });
}
