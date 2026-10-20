/** Adresse der Repo-Detailseite aus `owner/name` (beide Teile einzeln kodiert). */
export function repoDetailHref(fullName: string): string {
  return `/repos/${fullName.split("/").map(encodeURIComponent).join("/")}`;
}
