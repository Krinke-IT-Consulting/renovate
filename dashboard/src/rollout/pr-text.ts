import type { RolloutKind } from "./types";

/** Datei, die der Rollout-PR anlegt; `role` bestimmt die Erklärung im PR-Text. */
export type RolloutFile = { path: string; role: "config" | "caller" };

export type PullRequestText = { title: string; body: string };

/**
 * Eingaben des zentralen Build-Checks, die ein Repo eventuell braucht. Quelle: `workflow_call`-
 * Eingaben in `.github/workflows/build-check.yml` und `feature-documentation/build-check.md`.
 */
const BUILD_CHECK_INPUTS = [
  "`docker-context`: Build-Kontext der Dockerfiles (`auto`, `dockerfile` oder `repository`). Nötig, wenn ein Dockerfile Dateien außerhalb seines Ordners kopiert und `auto` den Kontext falsch wählt.",
  "`postgres`: startet eine Wegwerf-Postgres für Node- und Python-Projekte (zusätzlich `postgres-version` und `postgres-port`). Nötig, wenn die Tests eine Datenbank brauchen.",
  "`pre-test-command`: Befehl vor den Tests, etwa Datenbank-Migrationen.",
  "`run-tests`: auf `false` setzen, wenn die Tests im Build-Check nicht laufen sollen.",
  "`exclude-paths`: Pfade, die nicht geprüft werden sollen (kommasepariert).",
  "`working-directory`, `ecosystems` und `node-version`: Wurzel der Suche, Einschränkung auf Ökosysteme und Node-Version, wenn das Projekt keine eigene Angabe hat.",
];

function fileLines(files: readonly RolloutFile[]): string[] {
  return files.map((f) =>
    f.role === "config"
      ? `- \`${f.path}\`: bindet das zentrale Preset der Renovate-Plattform ein. Danach legt Renovate Update-Pull-Requests für dieses Repo an.`
      : `- \`${f.path}\`: ruft den zentralen Build-Check auf. Er erkennt die prüfbaren Teile des Repos selbst und liefert den Status-Check, an dem Automerge festmacht.`,
  );
}

/** Deutscher PR-Text: was der PR bewirkt und welche Build-Check-Eingaben das Repo brauchen kann. */
export function buildPullRequestText(
  kind: RolloutKind,
  files: readonly RolloutFile[],
): PullRequestText {
  const hasCaller = files.some((f) => f.role === "caller");
  const title =
    kind === "onboarding"
      ? hasCaller
        ? "Renovate einführen: Konfiguration und Build-Check"
        : "Renovate einführen: Konfiguration"
      : "Build-Check einführen";

  const intro =
    kind === "onboarding"
      ? "Dieser Pull Request führt Renovate für dieses Repo ein. Er wurde vom Renovate-Dashboard angelegt."
      : "Dieser Pull Request führt den zentralen Build-Check für dieses Repo ein. Er wurde vom Renovate-Dashboard angelegt.";

  const parts = [
    intro,
    "",
    "## Was dieser Pull Request bewirkt",
    "",
    ...fileLines(files),
    "",
    "Nach dem Merge ist nichts weiter einzurichten. Wer die Dateien nicht möchte, schließt den Pull Request ungemergt; das Dashboard legt dann keinen neuen an.",
  ];

  if (hasCaller) {
    parts.push(
      "",
      "## Eingaben des Build-Checks",
      "",
      "Der Build-Check läuft ohne Angaben. Je nach Repo sind diese Eingaben in der Aufrufdatei unter `with` sinnvoll:",
      "",
      ...BUILD_CHECK_INPUTS.map((l) => `- ${l}`),
      "",
      "Alle Eingaben stehen in `feature-documentation/build-check.md` im Repo der Renovate-Plattform. Schlägt der erste Lauf fehl, liegt es meist an einer dieser Eingaben.",
    );
  }
  return { title, body: parts.join("\n") + "\n" };
}
