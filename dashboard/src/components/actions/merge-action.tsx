"use client";

import { mergeAllGreen, mergePullRequest } from "@/actions/merge";
import { MERGE_METHOD_LABEL, type MergeTarget } from "@/merge/types";
import { plural } from "@/lib/format";
import { ConfirmAction } from "./confirm-action";

/**
 * Schlüssel der Merge-Meldungen einer Seite. Nach einem Erfolg verschwindet der PR (und mit ihm der
 * Knopf) aus der Liste; ein dauerhaft eingehängtes `ActionResult` mit diesem Schlüssel zeigt die
 * Meldung weiter an (PR-Liste, Repo-Detail, Lagebericht).
 */
export const MERGE_RESULT_KEY = "merge";

/** "Mergen" mit Bestätigung für einen PR: Dialog nennt Repo, Nummer und Methode. */
export function MergeAction({
  target,
  repoFullName,
  prNumber,
  variant = "quiet",
  wide = false,
}: {
  target: MergeTarget;
  repoFullName: string;
  prNumber: number;
  /** Tabelle: ruhig. Hauptaktion des Lageberichts: primary. */
  variant?: "primary" | "quiet";
  wide?: boolean;
}) {
  const name = `${repoFullName} #${prNumber}`;
  return (
    <ConfirmAction
      action={mergePullRequest.bind(null, target)}
      label={
        <span className="relative">
          Mergen<span className="sr-only"> {name}</span>
        </span>
      }
      title={`${name} mergen?`}
      effect={`${name} wird per ${MERGE_METHOD_LABEL[target.expectedMethod]} gemergt. Vorher prüft das Dashboard, ob CI und Commit noch stimmen.`}
      confirmLabel="Mergen"
      variant={variant}
      wide={wide}
      resultKey={MERGE_RESULT_KEY}
    />
  );
}

/** Sammel-Merge im Seitenkopf der PR-Liste; die Ziele stammen vom Server und stehen beim Rendern fest. */
export function BulkMergeAction({ targets, repoCount }: { targets: MergeTarget[]; repoCount: number }) {
  const n = targets.length;
  const effect =
    n === 1
      ? "1 PR wird gemergt. Sicherheits- und Major-Updates sind ausgenommen. Der PR wird vorher geprüft."
      : `${n} PRs in ${plural(repoCount, "Repo", "Repos")} werden nacheinander gemergt. Sicherheits- und Major-Updates sind ausgenommen. Jeder PR wird vorher geprüft.`;
  return (
    <ConfirmAction
      action={mergeAllGreen.bind(null, targets)}
      label={`Alle grünen Patch- und Minor-PRs mergen (${n})`}
      title="Alle grünen Patch- und Minor-PRs mergen?"
      effect={effect}
      confirmLabel="Alle mergen"
      resultKey={MERGE_RESULT_KEY}
    />
  );
}
