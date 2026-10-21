import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { rolloutActions } from "@/db/schema";
import { RateLimitPause, type PlatformAdapter, type PlatformConnection } from "@/platform";
import { PENDING_TIMEOUT_MS } from "@/rollout/service";
import { errorCategory, type PartialError } from "./sync-state";

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

/**
 * Zieht offene RolloutActions nach: `pr_open` -> `merged`/`closed`, sobald der PR auf der Plattform
 * nicht mehr offen ist (ein bedingter Abruf je PR, 304 kostet kein Kontingent). `pending` älter als
 * PENDING_TIMEOUT_MS gilt als abgebrochen und wird `failed`. Fehler je PR sind Teilfehler; eine
 * RateLimitPause wird weitergereicht. Aufruf vor `loadOpenRollouts`, damit der Status stimmt.
 */
export async function syncRolloutActions(
  db: Db,
  adapter: PlatformAdapter,
  conn: PlatformConnection,
  repos: readonly { id: string; fullName: string; defaultBranch: string }[],
  now: Date,
): Promise<PartialError[]> {
  const errors: PartialError[] = [];
  if (repos.length === 0) return errors;
  const byId = new Map(repos.map((r) => [r.id, r]));
  const open = await db
    .select()
    .from(rolloutActions)
    .where(
      and(
        inArray(rolloutActions.repositoryId, [...byId.keys()]),
        inArray(rolloutActions.status, ["pending", "pr_open"]),
      ),
    );
  for (const action of open) {
    const repo = byId.get(action.repositoryId);
    if (!repo) continue;
    if (action.status === "pending") {
      if (now.getTime() - action.createdAt.getTime() >= PENDING_TIMEOUT_MS) {
        await db
          .update(rolloutActions)
          .set({ status: "failed", error: "Abgebrochen: der Rollout wurde nicht abgeschlossen." })
          .where(eq(rolloutActions.id, action.id));
      }
      continue;
    }
    if (action.prNumber === null) continue;
    try {
      const end = await adapter.getPullRequestState(
        conn,
        { fullName: repo.fullName, defaultBranch: repo.defaultBranch },
        action.prNumber,
      );
      if (end.state === "open") continue;
      await db
        .update(rolloutActions)
        .set({ status: end.state })
        .where(eq(rolloutActions.id, action.id));
    } catch (e) {
      if (e instanceof RateLimitPause) throw e;
      errors.push({ repository: repo.fullName, message: `Rollout-PR: ${errorCategory(e)}` });
    }
  }
  return errors;
}
