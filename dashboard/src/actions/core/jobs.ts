import { eq } from "drizzle-orm";
import { z } from "zod";
import { CeApiError, type CeClient } from "@/ce";
import type { Db } from "@/db/client";
import { repositories } from "@/db/schema";
import { plural } from "@/lib/format";
import { listRunnableRepos } from "@/queries/runnable-repos";
import { writeAudit } from "../audit";
import { ActionError, done, failed, type ActionState } from "../result";

/**
 * Läufe anstoßen (Spec dashboard-actions, "Renovate-Lauf anstoßen"). Reine Logik mit eingespritztem
 * CE-Client und Datenbank; die Server Actions in ../jobs.ts sind dünne Hüllen darum.
 */
export type JobDeps = { db: Db; ce: Pick<CeClient, "addJob">; actor: string };

/** Gleichzeitige Anfragen an CE beim Sammellauf. */
const CONCURRENCY = 4;

const idSchema = z.uuid();

type AddOutcome = "inserted" | "unchanged";

/** CE meldet "inserted" für einen neuen Job, "unchanged" bei vorhandenem wartendem oder laufendem. */
async function addJob(ce: JobDeps["ce"], fullName: string): Promise<AddOutcome> {
  const res = await ce.addJob(fullName);
  return res.change === "unchanged" ? "unchanged" : "inserted";
}

function ceFailure(e: unknown): ActionError {
  if (e instanceof CeApiError && e.status !== null) {
    return new ActionError(`Renovate CE hat die Anfrage abgelehnt (Status ${e.status}).`);
  }
  return new ActionError("Renovate CE ist nicht erreichbar.");
}

export async function triggerRepoRunCore(deps: JobDeps, repositoryId: string): Promise<ActionState> {
  const id = idSchema.safeParse(repositoryId);
  if (!id.success) throw new ActionError("Unbekanntes Repo.");

  const [repo] = await deps.db
    .select({
      fullName: repositories.fullName,
      onboarding: repositories.onboardingStatus,
      archived: repositories.archived,
      removedAt: repositories.removedAt,
    })
    .from(repositories)
    .where(eq(repositories.id, id.data));
  if (!repo) throw new ActionError("Unbekanntes Repo.");
  if (repo.removedAt) throw new ActionError("Das Repo ist auf der Plattform nicht mehr erreichbar.");
  if (repo.archived) throw new ActionError("Für archivierte Repos läuft kein Renovate.");
  if (repo.onboarding !== "onboarded") throw new ActionError("Das Repo ist noch nicht onboardet.");

  let outcome: AddOutcome;
  try {
    outcome = await addJob(deps.ce, repo.fullName);
  } catch (e) {
    throw ceFailure(e);
  }
  await writeAudit(deps.db, { actor: deps.actor, action: "job.trigger", target: repo.fullName });

  if (outcome === "unchanged") {
    return done("neutral", "Für dieses Repo wartet oder läuft bereits ein Lauf.", {
      href: `/jobs?${new URLSearchParams({ repo: repo.fullName }).toString()}`,
      label: "Läufe des Repos ansehen",
      external: false,
    });
  }
  return done("erfolg", "Lauf eingereiht.", {
    href: `/jobs?${new URLSearchParams({ repo: repo.fullName }).toString()}`,
    label: "Läufe des Repos ansehen",
    external: false,
  });
}

export async function triggerAllRunsCore(deps: JobDeps): Promise<ActionState> {
  const repos = await listRunnableRepos(deps.db);
  if (repos.length === 0) return done("neutral", "Es gibt keine onboardeten Repos, für die ein Lauf nötig wäre.");

  const counts = { inserted: 0, unchanged: 0, failed: 0 };
  const queue = [...repos];
  const worker = async () => {
    for (let repo = queue.shift(); repo; repo = queue.shift()) {
      try {
        counts[await addJob(deps.ce, repo.fullName)] += 1;
      } catch {
        counts.failed += 1;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, repos.length) }, worker));

  // Ziel ist die Anzahl der betrachteten Repos; das Ergebnis je Repo steht in der Meldung.
  await writeAudit(deps.db, { actor: deps.actor, action: "job.trigger_all", target: `${repos.length} Repos` });

  if (counts.failed === repos.length) {
    return failed("Renovate CE ist nicht erreichbar oder hat alle Anfragen abgelehnt. Es wurde kein Lauf eingereiht.");
  }
  const parts = [
    `${plural(counts.inserted, "Lauf", "Läufe")} eingereiht`,
    ...(counts.unchanged > 0 ? [`${counts.unchanged} unverändert (Lauf wartet oder läuft bereits)`] : []),
    ...(counts.failed > 0 ? [`${plural(counts.failed, "Fehler", "Fehler")} bei der Anfrage`] : []),
  ];
  return done(counts.failed > 0 ? "warnung" : "erfolg", `${parts.join(", ")}.`, {
    href: "/jobs",
    label: "Läufe ansehen",
    external: false,
  });
}
