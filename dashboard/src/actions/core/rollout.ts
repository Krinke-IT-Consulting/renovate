import { z } from "zod";
import type { RolloutKind, RolloutOutcome, RolloutService } from "@/rollout/types";
import { ActionError, done, failed, type ActionState } from "../result";

/**
 * Onboarding- und Build-Check-PR anlegen. Die Rollout-Logik legt RolloutAction und AuditLog selbst
 * an (rollout/types.ts); hier wird nur ihr Ergebnis auf die Meldung abgebildet.
 */
export type RolloutDeps = { service: RolloutService; actor: string };

const idSchema = z.uuid();

const KIND_LABEL: Record<RolloutKind, string> = {
  onboarding: "Onboarding-PR",
  build_check: "Build-Check-PR",
};

export function outcomeToState(kind: RolloutKind, outcome: RolloutOutcome): ActionState {
  const label = KIND_LABEL[kind];
  switch (outcome.status) {
    case "created":
      return done("erfolg", `${label} #${outcome.prNumber} angelegt.`, {
        href: outcome.prUrl,
        label: `PR #${outcome.prNumber} auf GitHub ansehen`,
        external: true,
      });
    case "existing":
      return done("neutral", `Es gibt bereits einen offenen ${label} (#${outcome.prNumber}). Es entsteht kein zweiter.`, {
        href: outcome.prUrl,
        label: `PR #${outcome.prNumber} auf GitHub ansehen`,
        external: true,
      });
    case "not_needed":
      return done("neutral", outcome.message);
    case "failed":
      return failed(outcome.message);
  }
}

export async function runRolloutCore(deps: RolloutDeps, repositoryId: string, kind: RolloutKind): Promise<ActionState> {
  const id = idSchema.safeParse(repositoryId);
  if (!id.success) throw new ActionError("Unbekanntes Repo.");
  const outcome = await deps.service.run({ repositoryId: id.data, kind, actor: deps.actor });
  return outcomeToState(kind, outcome);
}
