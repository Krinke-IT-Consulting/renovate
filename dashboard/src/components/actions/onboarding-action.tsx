"use client";

import { createOnboardingPr } from "@/actions/rollout";
import { ConfirmAction } from "./confirm-action";

/** "Onboarding-PR anlegen" mit Bestätigung: im Lagebericht, im Repo-Detail und bei den Schritten. */
export function OnboardingAction({
  repositoryId,
  repoFullName,
  variant = "primary",
  wide = false,
  layout,
}: {
  repositoryId: string;
  repoFullName: string;
  variant?: "primary" | "quiet";
  wide?: boolean;
  layout?: "stack" | "row";
}) {
  return (
    <ConfirmAction
      action={createOnboardingPr.bind(null, repositoryId)}
      label="Onboarding-PR anlegen"
      title="Onboarding-PR anlegen?"
      effect={`Das Dashboard legt für ${repoFullName} einen Pull Request an, der die Renovate-Konfiguration und die Build-Check-Aufrufdatei hinzufügt. Er wird erst durch Sie gemergt.`}
      confirmLabel="Onboarding-PR anlegen"
      variant={variant}
      wide={wide}
      layout={layout}
    />
  );
}
