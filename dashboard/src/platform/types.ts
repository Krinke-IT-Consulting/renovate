/**
 * Plattformneutrale Schnittstelle zur Code-Plattform (design.md, Entscheidung 6).
 *
 * Hier stehen bewusst keine GitHub-Begriffe: Ein späterer GitLabAdapter muss alles erfüllen
 * können. "Connection" = Installation/Gruppe, "ChangeRequest" = Pull-/Merge-Request.
 * `createChangeRequest` fehlt absichtlich; es kommt mit den Aktionen (Phase 7).
 */

import type { CiStatus } from "@/domain/pull-requests";

export type OwnerType = "organization" | "user";

/** Ein Zugang zu einem Owner (GitHub: Installation der App). */
export interface PlatformConnection {
  /** ID der Verbindung auf der Plattform, als string (GitHub: Installations-ID). */
  externalConnectionId: string;
  ownerName: string;
  ownerType: OwnerType;
}

export interface PlatformRepository {
  /** Stabile ID des Repos auf der Plattform, als string. */
  externalId: string;
  fullName: string;
  defaultBranch: string;
  archived: boolean;
  private: boolean;
}

/** Was der Adapter zum Adressieren eines Repos braucht. */
export type RepositoryRef = Pick<
  PlatformRepository,
  "fullName" | "defaultBranch"
>;

export interface RepositoryContentState {
  /** Pfad der ersten gefundenen Renovate-Konfiguration (Renovates Reihenfolge) oder null. */
  configPath: string | null;
  /** true, wenn das Repo den zentralen Build-Check einbindet (GitHub: Aufrufdatei im Workflow-Ordner). */
  hasBuildCheck: boolean;
}

export interface UpdateChangeRequest {
  number: number;
  title: string;
  url: string;
  labels: string[];
  headSha: string;
  createdAt: string;
  updatedAt: string;
  /** Automerge laut PR (Plattform-Automerge) oder laut Renovate-Text im PR. */
  automerge: boolean;
  /**
   * Aktualisierte Pakete laut PR-Text bzw. Titel (`parseUpdatePackages`); leer, wenn nichts sicher
   * erkennbar ist. Kommt aus der Listen-Antwort, kein Zusatzaufruf.
   */
  packageNames: string[];
}

export type ChangeRequestStateValue = "open" | "merged" | "closed";

export interface ChangeRequestState {
  state: ChangeRequestStateValue;
  mergedAt: string | null;
}

export interface ChangeStatus {
  /** Normalisierter CI-Status des Commits; die plattformspezifische Ableitung liegt im Adapter. */
  ci: CiStatus;
}

export interface PlatformAdapter {
  listConnections(): Promise<PlatformConnection[]>;
  listRepositories(conn: PlatformConnection): Promise<PlatformRepository[]>;
  /**
   * Günstiger Abruf (bedingt, 304 kostet kein Kontingent). Grundlage der Head-SHA-Logik.
   * `null` bei einem leeren Repo (noch kein Commit auf dem Default-Branch).
   */
  getHeadSha(conn: PlatformConnection, repo: RepositoryRef): Promise<string | null>;
  /** Teuer (mehrere Abrufe): nur bei geändertem Head-SHA aufrufen, siehe refreshRepositoryState. */
  getRepositoryState(
    conn: PlatformConnection,
    repo: RepositoryRef,
    headSha: string,
  ): Promise<RepositoryContentState>;
  /** Offene Update-PRs des Bots (Head-Branch `renovate/`). */
  listUpdatePullRequests(
    conn: PlatformConnection,
    repo: RepositoryRef,
  ): Promise<UpdateChangeRequest[]>;
  getPullRequestState(
    conn: PlatformConnection,
    repo: RepositoryRef,
    number: number,
  ): Promise<ChangeRequestState>;
  getChangeStatus(
    conn: PlatformConnection,
    repo: RepositoryRef,
    sha: string,
  ): Promise<ChangeStatus>;
  /** URL des offenen Dependency-Dashboard-Issues des Bots oder null. */
  findDependencyDashboard(
    conn: PlatformConnection,
    repo: RepositoryRef,
  ): Promise<string | null>;
}
