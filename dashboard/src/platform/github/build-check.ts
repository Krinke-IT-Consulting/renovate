/** GitHub-spezifisch: Aufrufdatei des zentralen Build-Check-Workflows. */

export const BUILD_CHECK_CALLER_PATH = ".github/workflows/build-check.yml";

/** Die Aufrufdatei gilt als aktiv, wenn sie den zentralen Workflow aufruft. */
export const BUILD_CHECK_CALLER_MARKER =
  "Krinke-IT-Consulting/renovate/.github/workflows/build-check.yml@";

export function callsCentralBuildCheck(fileContent: string): boolean {
  return fileContent.includes(BUILD_CHECK_CALLER_MARKER);
}
