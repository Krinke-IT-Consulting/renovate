import type {
  PlatformAdapter,
  PlatformConnection,
  RepositoryContentState,
  RepositoryRef,
} from "./types";

export interface RepositoryRefresh {
  /** `null` bei einem leeren Repo (noch kein Commit). */
  headSha: string | null;
  changed: boolean;
  /**
   * Nur gesetzt, wenn sich der Head-SHA geändert hat oder das Repo leer ist (dann: kein Inhalt).
   * Sonst gilt der gespeicherte Stand.
   */
  state: RepositoryContentState | null;
}

const EMPTY_STATE: RepositoryContentState = { configPath: null, hasBuildCheck: false };

/**
 * Head-SHA-Logik (design.md, Entscheidung 6): Der Inhalt eines Repos (Konfiguration,
 * Build-Check-Datei) wird nur gelesen, wenn sich der Head-SHA des Default-Branches gegenüber
 * `knownSha` geändert hat. Der Abgleich ruft diese Funktion statt `getRepositoryState` direkt auf.
 */
export async function refreshRepositoryState(
  adapter: PlatformAdapter,
  conn: PlatformConnection,
  repo: RepositoryRef,
  knownSha: string | null,
): Promise<RepositoryRefresh> {
  const headSha = await adapter.getHeadSha(conn, repo);
  // Leeres Repo: kein Inhalt, ohne weiteren Abruf. Die PR- und Issue-Teile laufen trotzdem.
  if (headSha === null) {
    return { headSha: null, changed: knownSha !== null, state: EMPTY_STATE };
  }
  if (knownSha !== null && headSha === knownSha) {
    return { headSha, changed: false, state: null };
  }
  const state = await adapter.getRepositoryState(conn, repo, headSha);
  return { headSha, changed: true, state };
}
