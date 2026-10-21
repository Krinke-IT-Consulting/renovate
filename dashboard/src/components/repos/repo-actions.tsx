import { triggerRepoRun } from "@/actions/jobs";
import { setOwnCi } from "@/actions/repos";
import { createBuildCheckPr } from "@/actions/rollout";
import { ConfirmAction } from "@/components/actions/confirm-action";
import { OnboardingAction } from "@/components/actions/onboarding-action";
import type { RepoDetail } from "@/queries/repo-detail";

/**
 * Aktionen eines Repos unter dem Kopf der Detailseite. Jede verlangt eine Bestätigung, die ihre
 * Wirkung nennt. Welche Knöpfe erscheinen, folgt dem Zustand des Repos (Spec dashboard-actions).
 */
export function RepoActions({ repo }: { repo: RepoDetail }) {
  if (repo.removedAt) return null;
  const active = !repo.archived;
  const canRun = active && repo.onboarding === "onboarded";
  const canOnboard = active && repo.onboarding === "none";
  const canBuildCheck = active && repo.onboarding === "onboarded" && repo.buildCheck === "missing";

  return (
    <section aria-label="Aktionen" className="mt-5 flex flex-wrap items-start gap-x-3">
      {canRun ? (
        <ConfirmAction
          layout="row"
          action={triggerRepoRun.bind(null, repo.id)}
          label="Lauf starten"
          title="Lauf starten?"
          effect={`Renovate CE reiht für ${repo.fullName} einen Lauf ein.`}
          confirmLabel="Lauf starten"
        />
      ) : null}
      {canOnboard ? <OnboardingAction repositoryId={repo.id} repoFullName={repo.fullName} layout="row" /> : null}
      {canBuildCheck ? (
        <ConfirmAction
          layout="row"
          action={createBuildCheckPr.bind(null, repo.id)}
          label="Build-Check ausrollen"
          title="Build-Check ausrollen?"
          effect={`Das Dashboard legt für ${repo.fullName} einen Pull Request an, der nur die Build-Check-Aufrufdatei hinzufügt. Er wird erst durch Sie gemergt.`}
          confirmLabel="Build-Check-PR anlegen"
          variant="quiet"
        />
      ) : null}
      {repo.ownCi ? (
        <ConfirmAction
          layout="row"
          action={setOwnCi.bind(null, repo.id, false)}
          label="Markierung ‚eigene CI‘ aufheben"
          title="Markierung aufheben?"
          effect={`Die Markierung für ${repo.fullName} wird aufgehoben. Der Build-Check gilt wieder als fehlend, bis er eingerichtet ist.`}
          confirmLabel="Markierung aufheben"
          variant="quiet"
        />
      ) : (
        <ConfirmAction
          layout="row"
          action={setOwnCi.bind(null, repo.id, true)}
          label="Als eigene CI markieren"
          title="Als eigene CI markieren?"
          effect={`${repo.fullName} gilt dann als Repo mit eigener CI. Der Build-Check wird dort nicht mehr verlangt, ein offenes Problem „Build-Check fehlt“ gilt als behoben.`}
          confirmLabel="Als eigene CI markieren"
          variant="quiet"
        />
      )}
    </section>
  );
}
