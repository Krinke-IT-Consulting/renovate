import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { problems, repositories, rolloutActions } from "@/db/schema";
import { deriveBuildCheckStatus } from "@/domain/repo-status";
import { writeAudit } from "../audit";
import { ActionError, done, type ActionState } from "../result";

/**
 * Markierung "eigene CI" (Spec dashboard-actions, "Build-Check nachträglich ausrollen"). Der
 * Build-Check-Status wird sofort neu abgeleitet und ein offenes Problem `missing_build_check`
 * sofort behoben; der Abgleich öffnet es danach nicht wieder, weil der Status `own_ci` ist
 * (domain/problems.ts meldet es nur bei `missing`).
 */
export type OwnCiDeps = { db: Db; actor: string; now?: Date };

const idSchema = z.uuid();

export async function setOwnCiCore(deps: OwnCiDeps, repositoryId: string, value: boolean): Promise<ActionState> {
  const id = idSchema.safeParse(repositoryId);
  if (!id.success) throw new ActionError("Unbekanntes Repo.");
  const now = deps.now ?? new Date();

  return deps.db.transaction(async (tx) => {
    const [repo] = await tx
      .select({
        fullName: repositories.fullName,
        ownCi: repositories.ownCi,
        buildCheck: repositories.buildCheckStatus,
        removedAt: repositories.removedAt,
      })
      .from(repositories)
      .where(eq(repositories.id, id.data))
      .for("update");
    if (!repo) throw new ActionError("Unbekanntes Repo.");
    if (repo.removedAt) throw new ActionError("Das Repo ist auf der Plattform nicht mehr erreichbar.");

    if (repo.ownCi === value) {
      return done("neutral", value ? "Das Repo ist bereits als eigene CI markiert." : "Die Markierung ist bereits aufgehoben.");
    }

    const [openRollout] = await tx
      .select({ id: rolloutActions.id })
      .from(rolloutActions)
      .where(
        and(
          eq(rolloutActions.repositoryId, id.data),
          eq(rolloutActions.kind, "build_check"),
          inArray(rolloutActions.status, ["pending", "pr_open"]),
        ),
      )
      .limit(1);

    // Auf vorhandene Felder gestützt: `active` heißt, die Aufrufdatei liegt im Repo.
    const buildCheck = deriveBuildCheckStatus({
      hasCallerFile: repo.buildCheck === "active",
      openRolloutPr: openRollout !== undefined || repo.buildCheck === "pr_open",
      ownCi: value,
    });
    await tx
      .update(repositories)
      .set({ ownCi: value, buildCheckStatus: buildCheck })
      .where(eq(repositories.id, id.data));

    if (value) {
      await tx
        .update(problems)
        .set({ resolvedAt: now })
        .where(
          and(eq(problems.repositoryId, id.data), eq(problems.kind, "missing_build_check"), isNull(problems.resolvedAt)),
        );
    }

    await writeAudit(tx, {
      actor: deps.actor,
      action: "repo.own_ci",
      target: `${repo.fullName}: eigene CI ${value ? "an" : "aus"}`,
    });

    return done(
      "erfolg",
      value
        ? "Als eigene CI markiert. Der Build-Check wird für dieses Repo nicht mehr verlangt."
        : "Markierung aufgehoben. Der Build-Check gilt wieder als fehlend, bis er eingerichtet ist.",
    );
  });
}
