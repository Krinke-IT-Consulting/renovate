/** GitHub-spezifisch: Aufrufdatei des zentralen Build-Check-Workflows. */

export const BUILD_CHECK_CALLER_PATH = ".github/workflows/build-check.yml";

/** Die Aufrufdatei gilt als aktiv, wenn sie den zentralen Workflow aufruft. */
export const BUILD_CHECK_CALLER_MARKER =
  "Krinke-IT-Consulting/renovate/.github/workflows/build-check.yml@";

export function callsCentralBuildCheck(fileContent: string): boolean {
  return fileContent.includes(BUILD_CHECK_CALLER_MARKER);
}

/** Das Quell-Repo des Build-Checks: Es ruft den Workflow lokal auf, nicht über die Aufrufdatei. */
export const BUILD_CHECK_SOURCE_REPO = "Krinke-IT-Consulting/renovate";
export const BUILD_CHECK_SELF_PATH = ".github/workflows/build-check-self.yml";
export const BUILD_CHECK_SELF_MARKER = "uses: ./.github/workflows/build-check.yml";

export function isBuildCheckSourceRepo(fullName: string): boolean {
  return fullName.toLowerCase() === BUILD_CHECK_SOURCE_REPO.toLowerCase();
}

export function callsLocalBuildCheck(fileContent: string): boolean {
  return fileContent.includes(BUILD_CHECK_SELF_MARKER);
}

/** Vorlagen im Quell-Repo (Default-Branch); Zielpfad der Renovate-Konfiguration im Ziel-Repo. */
export const TEMPLATE_SOURCES = {
  "renovate-config": { source: "templates/renovate.json", target: "renovate.json" },
  "build-check-caller": {
    source: "templates/build-check-caller.yml",
    target: BUILD_CHECK_CALLER_PATH,
  },
} as const;
