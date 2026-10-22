/**
 * Vertrag zwischen Merge-Logik (Server Actions, Plattform) und Oberfläche für den Change
 * `dashboard-pr-merge` (design.md, Entscheidungen 3 bis 6). Die Oberfläche kennt nur diese Typen
 * und die Server Actions aus `src/actions/merge.ts`.
 */

/** Merge-Methoden in Vorzugsreihenfolge; die erste erlaubte wird verwendet. */
export const MERGE_METHODS = ["squash", "merge", "rebase"] as const;
export type MergeMethod = (typeof MERGE_METHODS)[number];

export const MERGE_METHOD_LABEL: Record<MergeMethod, string> = {
  squash: "Squash",
  merge: "Merge-Commit",
  rebase: "Rebase",
};

/** Erste erlaubte Methode in Vorzugsreihenfolge, oder null (dann kein Mergen anbieten). */
export function preferredMergeMethod(allowed: readonly string[]): MergeMethod | null {
  return MERGE_METHODS.find((m) => allowed.includes(m)) ?? null;
}

/**
 * Was die Oberfläche beim Rendern über einen mergebaren PR weiß. Die Server Action mergt nur,
 * wenn die Live-Prüfung genau diesen Stand bestätigt (Head-SHA und Methode).
 */
export type MergeTarget = {
  pullRequestId: string;
  expectedSha: string;
  expectedMethod: MergeMethod;
};

/** Gründe, aus denen ein Merge nach der Live-Prüfung unterbleibt. */
export type MergeSkipReason =
  | "changed" // Head-Commit seit der Anzeige geändert
  | "not_open" // PR nicht mehr offen (gemergt oder geschlossen)
  | "ci" // CI des aktuellen Commits nicht grün
  | "conflict" // nicht konfliktfrei
  | "pending" // Plattform berechnet die Mergebarkeit noch
  | "method_changed" // erlaubte Methode weicht von der angezeigten ab
  | "no_method" // Repo erlaubt keine Methode
  | "rejected"; // Plattform lehnt ab (z. B. Branch-Schutz)

export type MergeOutcome =
  | { status: "merged"; prUrl: string; prNumber: number; repoFullName: string }
  | { status: "skipped"; reason: MergeSkipReason; message: string; prNumber: number; repoFullName: string }
  | { status: "failed"; message: string; prNumber: number | null; repoFullName: string | null };

/** Höchstzahl je Sammel-Merge (Spec dashboard-actions). */
export const BULK_MERGE_LIMIT = 20;

/** Update-Typen, die der Sammel-Merge erfasst. */
export const BULK_MERGE_TYPES = ["patch", "minor"] as const;
