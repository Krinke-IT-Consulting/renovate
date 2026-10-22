/**
 * Plattformneutrale Schnittstelle zur Code-Plattform (design.md, Entscheidung 6).
 *
 * Hier stehen bewusst keine GitHub-Begriffe: Ein späterer GitLabAdapter muss alles erfüllen
 * können. "Connection" = Installation/Gruppe, "ChangeRequest" = Pull-/Merge-Request.
 */

import type { CiStatus } from "@/domain/pull-requests";

/** Merge-Methoden eines Repos, plattformneutral benannt. */
export type ChangeMergeMethod = "squash" | "merge" | "rebase";

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
  /**
   * Erlaubte Merge-Methoden des Repos in Vorzugsreihenfolge (squash, merge, rebase). `undefined`,
   * wenn die Plattform sie nicht geliefert hat (dann bleibt der gespeicherte Stand unverändert);
   * leer, wenn keine Methode erlaubt ist.
   */
  mergeMethods?: ChangeMergeMethod[];
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

/** Frisch gelesener Stand eines Requests unmittelbar vor dem Merge. */
export interface MergeReadiness {
  state: ChangeRequestStateValue;
  /** Aktueller Head-Commit des Requests. */
  headSha: string;
  /** Konfliktfrei? `null`: die Plattform berechnet es noch (auch nach einem erneuten Lesen). */
  mergeable: boolean | null;
  /** CI des Head-Commits, gleiche Ableitung wie `getChangeStatus`. Nur bei offenem Request gelesen. */
  ci: CiStatus;
  /**
   * Erlaubte Merge-Methoden in Vorzugsreihenfolge; leer, wenn keine erlaubt ist oder der Request
   * nicht offen ist. `null`: unbekannt, weil die Plattform sie nicht liefert (etwa fehlendes Recht).
   */
  methods: ChangeMergeMethod[] | null;
  /**
   * Aus demselben Abruf: warum die Plattform den Merge voraussichtlich ablehnt. `protection` =
   * Branch-Schutz oder fehlende Freigaben, `draft` = Entwurf, `null`/fehlt = kein Hinweis. Ein
   * veralteter Branch ("behind") gilt nie als Grund; dann wird der Merge versucht.
   */
  blockedReason?: "protection" | "draft" | null;
}

export interface MergeRequest {
  /** Head-Commit, an den der Merge gebunden ist; ändert er sich, lehnt die Plattform ab. */
  sha: string;
  method: ChangeMergeMethod;
}

/** Was die schreibenden Methoden zum Adressieren der Verbindung brauchen. */
export type ConnectionRef = Pick<
  PlatformConnection,
  "externalConnectionId" | "ownerName"
>;

/** Vorlagen des Rollouts; der Inhalt liegt im Repo dieser Plattform (Entscheidung 10). */
export type TemplateName = "renovate-config" | "build-check-caller";

export interface TemplateFile {
  /** Zielpfad der Datei im Repo, das den Rollout erhält. */
  path: string;
  content: string;
}

export interface NewChangeRequest {
  /** Neuer Branch; er wird vom Stand des Default-Branches (`baseBranch`) aus angelegt. */
  branch: string;
  baseBranch: string;
  title: string;
  body: string;
  /** Alle Dateien kommen in genau einem Commit. */
  files: { path: string; content: string }[];
}

export interface ChangeRequestRef {
  number: number;
  url: string;
}

export interface ListRepositoriesOptions {
  readMergeMethods?: (repo: { externalId: string; fullName: string }) => boolean;
}

export interface PlatformAdapter {
  listConnections(): Promise<PlatformConnection[]>;
  /**
   * Repos einer Verbindung. Liefert die Listenantwort die Merge-Methoden nicht, liest der Adapter
   * sie je Repo einzeln nach (ein Aufruf je Repo). `options.readMergeMethods` entscheidet je Repo,
   * ob das nötig ist; ohne Angabe wird für jedes nicht archivierte Repo gelesen. Unterbleibt das
   * Lesen oder scheitert es, fehlt `mergeMethods` ("unbekannt", gespeicherter Stand gilt).
   */
  listRepositories(
    conn: PlatformConnection,
    options?: ListRepositoriesOptions,
  ): Promise<PlatformRepository[]>;
  /**
   * Günstiger Abruf (bedingt, 304 kostet kein Kontingent). Grundlage der Head-SHA-Logik.
   * `null` bei einem leeren Repo (noch kein Commit auf dem Default-Branch).
   */
  getHeadSha(conn: ConnectionRef, repo: RepositoryRef): Promise<string | null>;
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
    conn: ConnectionRef,
    repo: RepositoryRef,
    number: number,
  ): Promise<ChangeRequestState>;
  getChangeStatus(
    conn: PlatformConnection,
    repo: RepositoryRef,
    sha: string,
  ): Promise<ChangeStatus>;
  /**
   * Liest Stand, Head-Commit, Konfliktfreiheit, CI und erlaubte Merge-Methoden frisch (ohne
   * Cache). Liefert die Plattform die Konfliktfreiheit noch nicht, wird einmal nach kurzer Wartezeit
   * neu gelesen; bleibt sie offen, ist `mergeable` `null`.
   */
  getMergeReadiness(
    conn: ConnectionRef,
    repo: RepositoryRef,
    number: number,
  ): Promise<MergeReadiness>;
  /**
   * Mergt den Request mit der Methode, gebunden an `sha`. Schreibaufruf (Kontingent-Pause und
   * sekundäres Rate-Limit greifen). Wirft `PlatformHeadChangedError` (Head weicht ab),
   * `PlatformRejectedError` (Plattform lehnt ab, z. B. Branch-Schutz), `PlatformPermissionError`
   * bei fehlenden Rechten und `RateLimitPause`.
   */
  mergeChangeRequest(
    conn: ConnectionRef,
    repo: RepositoryRef,
    number: number,
    request: MergeRequest,
  ): Promise<void>;
  /** URL des offenen Dependency-Dashboard-Issues des Bots oder null. */
  findDependencyDashboard(
    conn: PlatformConnection,
    repo: RepositoryRef,
  ): Promise<string | null>;
  /**
   * Legt einen Branch mit einem Commit (alle `files`) an und öffnet daraus einen Pull-/Merge-
   * Request. Schlägt ein Schritt nach dem Anlegen des Branches fehl, löscht der Adapter ihn wieder
   * (scheitert das, wirft er `PlatformLeftoverBranchError` mit dem Namen des Rest-Branches).
   *
   * Vor dem Anlegen prüft der Adapter jede Datei live im Base-Commit: gleicher Inhalt wird
   * übersprungen; bei abweichendem Inhalt oder wenn nichts mehr zu schreiben bleibt, wirft er
   * `PlatformFilesExistError` und legt nichts an. Gibt es für den Branch schon einen offenen
   * Request, wird dieser zurückgegeben. Branches nur mit dem Rollout-Präfix.
   * Wirft `PlatformPermissionError` bei fehlenden Schreibrechten und `PlatformRejectedError` bei
   * erkennbaren Ablehnungen (leeres Repo, Repo nicht in der Verbindung, Branch-Regel).
   */
  createChangeRequest(
    conn: ConnectionRef,
    repo: RepositoryRef,
    request: NewChangeRequest,
  ): Promise<ChangeRequestRef>;
  /** Offener Request mit diesem Head-Branch oder `null`. */
  findOpenChangeRequest(
    conn: ConnectionRef,
    repo: RepositoryRef,
    branch: string,
  ): Promise<ChangeRequestRef | null>;
  /** Nur Branches mit dem Rollout-Präfix; ein fehlender Branch ist kein Fehler. */
  deleteBranch(
    conn: ConnectionRef,
    repo: RepositoryRef,
    branch: string,
  ): Promise<void>;
  /** Liest eine Rollout-Vorlage aus dem Vorlagen-Repo (Default-Branch); kein Eintrag im Image. */
  readTemplate(name: TemplateName): Promise<TemplateFile>;
}
