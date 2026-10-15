import { and, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { rolloutActions } from "@/db/schema";

export type OpenRollouts = { onboarding: boolean; buildCheck: boolean };

/** Offene Rollouts (pending/pr_open) je Repo; fehlt ein Eintrag, ist nichts offen. */
export async function loadOpenRollouts(
  db: Db,
  repositoryIds: readonly string[],
): Promise<Map<string, OpenRollouts>> {
  const out = new Map<string, OpenRollouts>();
  if (repositoryIds.length === 0) return out;
  const rows = await db
    .select({ repositoryId: rolloutActions.repositoryId, kind: rolloutActions.kind })
    .from(rolloutActions)
    .where(
      and(
        inArray(rolloutActions.repositoryId, [...repositoryIds]),
        inArray(rolloutActions.status, ["pending", "pr_open"]),
      ),
    );
  for (const r of rows) {
    const cur = out.get(r.repositoryId) ?? { onboarding: false, buildCheck: false };
    if (r.kind === "onboarding") cur.onboarding = true;
    else cur.buildCheck = true;
    out.set(r.repositoryId, cur);
  }
  return out;
}
