# Dashboard: Ansichten (Phase 6)

Status: umgesetzt auf dem Branch `feat/dashboard-ansichten` (Tasks 6.3 bis 6.6 laut Entwurf). Review und
Deployment stehen aus.

Dieses Dokument beschreibt, was der Code unter `dashboard/src/app/` tatsächlich tut. Wenn Code und Text
voneinander abweichen, gilt der Code. Die Gestaltungsentscheidungen stehen in
[`ansichten-entwurf.md`](ansichten-entwurf.md) (Entwurf bestätigt, Task 6.1) und in
[`../uebersicht-entwurf.md`](../uebersicht-entwurf.md) (Lagebericht, Startseite). Die gemeinsamen Bausteine
beschreibt [`bausteine.md`](bausteine.md), den Lagebericht [`lagebericht.md`](lagebericht.md), Fixtures und
Smoke-Tests [`tests-und-fixtures.md`](tests-und-fixtures.md).

## 1. Überblick

Sechs Seiten, alle mit `export const dynamic = "force-dynamic"`. Sie lesen direkt über Drizzle
(`getDb()` aus `dashboard/src/db/client.ts`) und zeigen den Stand aus den abgeglichenen Tabellen.
Die Navigation (`dashboard/src/components/shell/nav-items.ts`) enthält fünf Einträge; `/repos/[owner]/[name]`
ist nur über Links erreichbar.

| Pfad | Datei | Zweck | Query-Funktionen (`dashboard/src/queries/`) |
|---|---|---|---|
| `/` | `dashboard/src/app/page.tsx` | Lagebericht: was zu tun ist (Nav-Label „Übersicht“) | `loadOverview` in `overview.ts` |
| `/repos` | `dashboard/src/app/repos/page.tsx` | alle Repos mit Zustand | `listRepos`, `listRepoOwners` in `repos.ts` |
| `/repos/[owner]/[name]` | `dashboard/src/app/repos/[owner]/[name]/page.tsx` | ein Repo: Aufgaben, PRs, Läufe, Probleme, Rollouts | `loadRepoDetail` in `repo-detail.ts` |
| `/pull-requests` | `dashboard/src/app/pull-requests/page.tsx` | offene Renovate-PRs | `listOpenPullRequests`, `listPullRequestRepos` in `pull-requests.ts` |
| `/jobs` | `dashboard/src/app/jobs/page.tsx` | Renovate-Läufe der letzten 7 Tage | `listJobs`, `summarizeJobs`, `listJobRepos` in `jobs.ts` |
| `/probleme` | `dashboard/src/app/probleme/page.tsx` | offene und behobene Probleme | `listProblems`, `countProblems` in `problems.ts`, `listJobRepos` in `jobs.ts` |

Jede Seite zeigt den Abgleich-Stempel aus dem Layout (`dashboard/src/app/layout.tsx`, siehe
[`bausteine.md`](bausteine.md), Abschnitt 6). Das Layout bindet außerdem `AutoRefresh` ein.

## 2. Gemeinsame Regeln für Adressparameter

Die Regeln gelten für alle Seiten. Die Hilfsfunktionen stehen in `dashboard/src/lib/search-params.ts`.

- **Filter stehen in der Adresse.** Jeder Chip ist ein Link. Filter funktionieren ohne JavaScript.
- **Mehrfachwerte** werden kommagetrennt geschrieben, etwa `?typ=major,security&ci=failure`. Die Reihenfolge
  in der Adresse ist egal. Chips und Abfragen verwenden die Reihenfolge der Erlaubnisliste.
- **Unbekannte Werte werden still verworfen.** Ein Wert, der nicht in der Erlaubnisliste steht, gilt als nicht
  gesetzt.
- **Schalter** (`automerge`, `problem`, `eigene-ci`, `entfernt`) gelten nur bei `1` oder `ja`.
- **Freitext** (`q`) wird von Steuerzeichen (C0 und DEL) befreit, getrimmt und auf 100 Zeichen gekürzt. Leer heißt
  nicht gesetzt.
- **Seite** (`seite`) beginnt bei 1. Jede Filteränderung entfernt `seite` aus der Adresse
  (`withParams` in `search-params.ts`).
- **Sortierung** über `sort=<Spalten-ID>` und `dir`. `dir=asc` sortiert aufsteigend, jeder andere Wert
  (oder fehlend) absteigend. Die Spalten-IDs je Seite stehen in den Abschnitten unten. Bei paginierten Listen (PRs,
  Jobs) sortiert die Seite alle Treffer, bevor sie in Seiten schneidet. Bei Repos und in den Tabellen des
  Repo-Detail sortiert die Tabelle die übergebenen Zeilen.
- **Aktualisierung:** `AutoRefresh` (`dashboard/src/components/shell/auto-refresh.tsx`) ruft
  `router.refresh()` alle 60 Sekunden auf, solange der Tab sichtbar ist. Beim Wechsel auf sichtbar wird
  sofort einmal neu geladen.

## 3. Seiten

### 3.1 `/` (Lagebericht)

- **Datei:** `dashboard/src/app/page.tsx`. Der Lagebericht selbst ist in [`lagebericht.md`](lagebericht.md)
  beschrieben.
- **Zweck:** sagt in einem Absatz, was zu tun ist, und zeigt die offenen Schritte. Jede Zahl im Absatz ist
  ein Link auf die gefilterte Liste.
- **Adressparameter:**
  - `repo=<owner>/<name>`: filtert die Schritte auf ein Repo (Kachelklick). Der Absatz bleibt unverändert.
- **Query:** `loadOverview(getDb())` aus `dashboard/src/queries/overview.ts`. Die Funktion lädt Repos ohne
  `removed_at`, offene PRs, offene Probleme, Läufe der letzten 24 Stunden, aktive Läufe und die Existenz eines
  Laufs. Daraus entstehen `report`, `tiles` und `metrics`.
- **Komponenten:**
  - `ReportParagraph` (in `page.tsx`): rendert die Segmente des Absatzes.
  - `StepList` (`dashboard/src/components/overview/step-list.tsx`): Schritte auf der Leiterbahn.
  - `Metrics` und `RepoGrid` (`dashboard/src/components/overview/side-panel.tsx`): Kennzahlen und Kachel-Raster.
- **Kennzahlen (`Metrics`):**
  - „Repos“: `N von M onboardet`, verlinkt auf `/repos`. Archivierte Repos zählen nicht.
  - „Offene PRs“: alle offenen PRs, bei Automerge mit `, davon K Automerge`. Verlinkt auf `/pull-requests`.
  - „Läufe, 7 Tage“: alle Läufe der letzten 24 Stunden, bei Fehlschlägen mit `N fehlgeschlagen`. Verlinkt auf
    `/jobs?status=failed` bei Fehlschlägen, sonst auf `/jobs`. Die Jobs-Seite zeigt aber 7 Tage. Das ist so
    gebaut; siehe Offene Punkte unten.
  - „Offene Probleme“: verlinkt auf `/probleme`.
- **Repo-Raster (`RepoGrid`):** eine Kachel je nicht archiviertem Repo mit `removed_at` leer. Der Klick setzt
  `repo=` in der Adresse und hebt die Kachel mit einem Rahmen hervor, ein zweiter Klick entfernt den Filter.
  Die Legende zeigt vier Töne: Fehler, Entscheidung, Läuft, Aktuell.
- **Zustände:**
  - Laden: `dashboard/src/app/loading.tsx`, Platzhalter in Form des Absatzes und der Schritte.
  - Fehler: `dashboard/src/app/error.tsx`, Überschrift „Der Lagebericht konnte nicht geladen werden.“ mit
    Knopf „Erneut versuchen“ (ruft `reset` auf). Der Abgleich-Stempel zeigt den Grund.
  - Erster Start, alles aktuell, offene Schritte: aus `buildReport` (siehe `lagebericht.md`).
  - Mit `repo=` und ohne Schritte: „Schritte für <Kurzname>: nichts offen.“ Dazu der Link „Filter aufheben“.
  - Ohne Kacheln (keine Repos): das Raster erscheint nicht.

### 3.2 `/repos`

- **Datei:** `dashboard/src/app/repos/page.tsx`. Tabelle: `dashboard/src/components/repos/repo-table.tsx`.
- **Zweck:** alle Repos mit abgeleitetem Zustand. Standardsortierung nach Handlungsbedarf, danach nach Name
  (`sortByAttention` in `dashboard/src/lib/repo-list.ts`).
- **Adressparameter:**
  - `owner=<owner>` (mehrfach möglich): Owner-Chips erscheinen nur, wenn es mehr als einen Owner gibt.
  - `status=fehler,warnung,laeuft,erfolg`: Chips „Fehler“, „Warnung“, „Läuft“, „In Ordnung“. Der Zustand
    `neutral` (Entfernt, Archiviert, Deaktiviert) hat keinen Chip. Der Ton `erfolg` trägt das Label „Aktuell“
    in der Tabelle, der Chip heißt „In Ordnung“.
  - `onboarding=none,pr_open,onboarded,disabled`: Chips „Nicht onboardet“, „Onboarding-PR offen“, „Onboardet“,
    „Deaktiviert“. Ist einer dieser Filter gesetzt, fallen archivierte Repos heraus.
  - `problem=1`: nur Repos mit mindestens einem offenen Problem.
  - `eigene-ci=1`: nur Repos mit „Eigene CI“.
  - `entfernt=1`: entfernte Repos (`removed_at` gesetzt) werden mit angezeigt. Ohne diesen Schalter bleiben sie
    außen vor.
  - `q=<Text>`: Teilstring im vollen Namen (`owner/name`), ohne Groß- und Kleinschreibung.
  - `sort=repo|status|lauf|prs|sicherheit` und `dir`. Nicht sortierbar sind `onboarding` und `build-check`.
- **Query:** `listRepos(db, filter)` und `listRepoOwners(db)` aus `dashboard/src/queries/repos.ts`. Die Filter
  für Ton und Problem greifen nach dem Ableiten des Zustands in der Anwendung, die übrigen in der Abfrage.
- **Komponenten:** `FilterBar`, `FilterChips`, `SearchBox` (Freitext) und `RepoTable` mit `DataTable`.
- **Kopfzeile:** `summarizeRepos` (`dashboard/src/lib/repo-list.ts`), etwa „12 Repos, 9 onboardet, 4 brauchen
  eine Entscheidung“.
- **Keine Paginierung.** Die Liste zeigt alle Treffer.
- **Zustände:**
  - Laden: `dashboard/src/app/repos/loading.tsx`, `TableSkeleton` mit 12 Zeilen.
  - Fehler: `dashboard/src/app/repos/error.tsx`, „Die Repos konnten nicht geladen werden.“ mit „Erneut
    versuchen“ (ruft `retry`).
  - Leer ohne Filter: EmptyState „Noch keine Repos“ mit dem Hinweis auf den ersten Abgleich.
  - Keine Treffer: EmptyState „Keine Treffer für diese Filter.“ mit dem Link „Filter zurücksetzen“.
- **Kein Aktionsknopf.** „Onboarding-PR“ und „Build-Check ausrollen“ sind Phase 7.

### 3.3 `/repos/[owner]/[name]` (Repo-Detail)

- **Datei:** `dashboard/src/app/repos/[owner]/[name]/page.tsx`.
- **Zweck:** Stand eines Repos auf einer Seite. Abschnitte in dieser Reihenfolge:
  1. Kopf mit Name, Zustands-Badge und Links „Auf GitHub öffnen“ sowie „Dependency Dashboard“ (nur wenn die URL
     gesetzt ist). Darunter Onboarding, Build-Check (bei `own_ci` als „Eigene CI“), Konfigurationspfad und letzter
     Lauf. Bei entferntem Repo steht ein Hinweis mit dem Datum, bei archiviertem ein Hinweis zur Archivierung.
  2. Abschnitt `#zu-tun` „Was hier zu tun ist“ mit der Anzahl. Die Schritte kommen aus `repoSteps`
     (`dashboard/src/queries/repo-detail.ts`), gleiche Gruppen und Reihenfolge wie im Lagebericht.
  3. Abschnitt `#prs` „Offene PRs“ mit `PullRequestTable` ohne Repo-Spalte.
  4. Abschnitt `#jobs` „Letzte Jobs“, bis zu 20 Läufe (`REPO_DETAIL_JOBS`), mit „Alle Läufe“ nach
     `/jobs?repo=<owner>%2F<name>`. Ab 20 Läufen steht der Hinweis „Gezeigt sind die letzten 20 Läufe.“.
  5. Abschnitt `#probleme` „Probleme“ mit der Anzahl offener Probleme. Ein Link nennt die behobenen Probleme der
     letzten 30 Tage und führt nach `/probleme?ansicht=behoben&repo=<owner>/<name>`.
  6. Abschnitt `#rollouts` „Rollout-Aktionen“ mit `RolloutTable` (Art, Status, PR-Link, Zeitpunkt, ohne Sortierung).
- **Adressparameter:** keine eigenen. Der Parameter `alle` des Problem-Abschnitts (siehe 3.6) bleibt in der
  Adresse erhalten.
- **Adressauflösung:** `owner` und `name` werden einzeln dekodiert. Ein ungültiges Kodieren ergibt `notFound()`.
  Der Vergleich mit `full_name` ist ohne Groß- und Kleinschreibung. Gibt es mehrere Treffer, gewinnt ein nicht
  entferntes Repo.
- **Query:** `loadRepoDetail(db, fullName, now)` aus `dashboard/src/queries/repo-detail.ts`.
- **Komponenten:** `RepoSteps` (`dashboard/src/components/repos/repo-steps.tsx`), `PullRequestTable`, `JobTable`,
  `ProblemGroups` mit `headingLevel={3}` (weil die Gruppen unter einer Abschnittsüberschrift stehen),
  `RolloutTable`.
- **Schritte ohne Knopf:** Ein Schritt, dessen Ziel auf dieselbe Seite zeigt (`/repos/…`, also Onboarding), hat
  keinen Aktionsknopf. Externe Ziele und andere interne Ziele bekommen einen Knopf.
- **Zustände:**
  - Laden: `dashboard/src/app/repos/[owner]/[name]/loading.tsx`, Kopf-Platzhalter und `TableSkeleton` mit 4 Zeilen.
  - Fehler: `dashboard/src/app/repos/[owner]/[name]/error.tsx`, „Das Repo konnte nicht geladen werden.“ mit
    „Erneut versuchen“ (ruft `retry`).
  - Unbekanntes Repo: `notFound()`, es erscheint `dashboard/src/app/not-found.tsx` mit „Seite nicht gefunden“ und
    den Links „Zurück zur Übersicht“ und „Alle Repos ansehen“ (`/repos`).
  - Leere Abschnitte: „Nichts zu tun.“ (Schritte), „Keine offenen Renovate-PRs. Der nächste Lauf ist stündlich.“,
    „Noch kein Lauf.“, „Keine offenen Probleme.“, „Für dieses Repo gab es noch keine Onboarding- oder
    Build-Check-Aktion.“

### 3.4 `/pull-requests`

- **Datei:** `dashboard/src/app/pull-requests/page.tsx`. Tabelle: `dashboard/src/components/pull-requests/pull-request-table.tsx`.
- **Zweck:** flache Liste aller offenen Renovate-PRs, keine Gruppierung.
- **Adressparameter:**
  - `typ=security,major,minor,patch,digest,lockfile,other`: Chips „Sicherheit“, „Major“, „Minor“, „Patch“,
    „Digest“, „Lockfile“, „Sonstiges“.
  - `ci=success,failure,pending,none`: Chips „CI grün“, „CI rot“, „CI läuft“, „Keine CI“.
  - `automerge=1`: nur PRs mit Automerge.
  - `repo=<owner>/<name>` (mehrfach): Chips für alle Repos mit offenen PRs.
  - `q=<Text>`: sucht in Titel, Repo-Name und Paketnamen (Teilstring, ohne Groß- und Kleinschreibung).
  - `seite=<n>`: 50 PRs je Seite (`PAGE_SIZE`).
  - `sort=repo|typ|alter` und `dir`. Die Spalte „Repo“ ist nur mit `showRepo` sortierbar; hier immer. Nicht sortierbar
    sind „Titel“, „CI“ und „Automerge“.
- **Query:** `listOpenPullRequests(db, filter)` und `listPullRequestRepos(db)` aus
  `dashboard/src/queries/pull-requests.ts`. Die Abfrage schließt Repos mit `removed_at` aus. Die Standardsortierung
  ist: Sicherheit zuerst, dann rote CI, dann Major, dann nach Alter (älteste zuerst).
- **Sortierung über alle Treffer.** Die Seite sortiert mit `sortPullRequests` (`dashboard/src/components/pull-requests/pull-request-format.ts`),
  bevor sie in Seiten schneidet. Ohne `sort` bleibt die Standardsortierung der Abfrage. Die Tabelle bekommt die
  Zeilen mit `manualSorting` und sortiert nicht selbst.
- **Kopfzeile:** „N offene PRs, davon M Sicherheit“, mit „(gefiltert)“ bei aktiven Filtern. Ohne PRs überhaupt:
  „Keine offenen PRs.“
- **Hängende PRs:** Die Alter-Spalte trägt das Warnungssymbol mit „, hängt“, ab 14 Tagen bei Major und Minor (und
  allen anderen Typen außer Sicherheit), ab 7 Tagen bei Sicherheit (`isStale` in
  `dashboard/src/components/pull-requests/pull-request-format.ts`, Schwellen aus `dashboard/src/domain/problems.ts`).
- **Zustände:**
  - Laden: `dashboard/src/app/pull-requests/loading.tsx`, Kopf-Platzhalter und `TableSkeleton`.
  - Fehler: `dashboard/src/app/pull-requests/error.tsx`, „Die Pull Requests konnten nicht geladen werden.“ mit
    „Erneut versuchen“ (ruft `retry`).
  - Keine offenen PRs überhaupt: EmptyState „Keine offenen Renovate-PRs“ mit „Der nächste Lauf ist stündlich.“
  - Keine Treffer: EmptyState „Keine Treffer für diese Filter.“ mit „Filter zurücksetzen“.
  - Paginierung erscheint erst ab mehr als 50 Treffern (`Pagination`).

### 3.5 `/jobs`

- **Datei:** `dashboard/src/app/jobs/page.tsx`. Tabelle und Log-Auszug: `dashboard/src/components/jobs/job-table.tsx`.
- **Zweck:** Renovate-Läufe der letzten 7 Tage (`JOBS_WINDOW_DAYS`), neueste zuerst. Der Lauf wird nach
  `startedAt`, sonst `createdAt` eingeordnet.
- **Adressparameter:**
  - `status=failed,running,queued,success`: Chips „Fehlgeschlagen“, „Läuft“, „Wartet“, „Erfolgreich“. „Fehlgeschlagen“
    steht vorn als schneller Einstieg.
  - `repo=<owner>/<name>` (mehrfach): die Chips zeigen nur die gewählten Repos (siehe Offene Punkte unten). Ein entferntes Repo,
    das in der Adresse steht, bleibt gültig und zeigt seine Läufe (`includeRemoved`).
  - `q=<Text>`: Teilstring im Repo-Namen. Das Suchfeld ist mit „Nach Repo suchen“ beschriftet.
  - `seite=<n>`: 50 Läufe je Seite (`JOBS_PAGE_SIZE`). Liegt die Seite über der letzten, leitet die Seite per
    `redirect` auf die letzte Seite um (`seite` entfällt bei nur einer Seite).
  - Sortierung: `sort=zeit|repo|ausloeser|status|dauer` und `dir`. Die Abfrage sortiert über alle Treffer, bevor sie in
    Seiten schneidet (`JOB_SORT_KEYS` in `dashboard/src/queries/jobs.ts`). Ohne `sort` gilt „neueste zuerst“. Die
    Spalten „Hinweis“ und „Log“ sind nicht sortierbar. Bei Gleichstand gilt „neueste zuerst“.
- **Query:** `listJobs(db, filter)`, `summarizeJobs(db)` und `listJobRepos(db, { includeRemoved })` aus
  `dashboard/src/queries/jobs.ts`. Ohne Repo-Filter zählen nur Repos ohne `removed_at`. Mit Repo-Filter schließt die
  Abfrage entfernte Repos ein (`includeRemoved`). Mit genau einem gewählten Repo entfällt das 7-Tage-Fenster
  (`allTime`), wie im Repo-Detail. Die Seite setzt dabei `repos`, nicht `repositoryId`.
- **Kopfzeile:** „N Läufe in den letzten 7 Tagen, davon M fehlgeschlagen.“ Ohne Läufe: „In den letzten 7 Tagen gab es
  noch keinen Lauf.“ Bei genau einem gewählten Repo: „N Läufe für <owner>/<name>.“ bzw. „Für dieses Repo liegt kein
  Lauf vor.“ (ohne Zeitangabe)
- **Spalten:** Zeit (Relativzeit, Datum im Tooltip), Repo, Auslöser (Zeitplan, Webhook, Manuell), Status, Dauer
  (`formatDuration`, „–“ ohne Wert), Hinweis (Lockfile-Fehler bei `artifactErrorCount > 0`), Log.
- **Log-Auszug (`LogPanel`):**
  - Der Knopf „Log anzeigen“ erscheint nur, wenn `logExcerpt` nicht leer ist. Er hat `aria-expanded` und klappt die
    Zeile unter der Zeile auf (`renderExpanded` von `DataTable`). Auf Karten liegt der Auszug unter der Karte.
  - Der Auszug zeigt die ersten 30 Zeilen (`LOG_PREVIEW_LINES` in `dashboard/src/lib/log-view.ts`). Der Knopf
    „Ganzen Auszug zeigen (N Zeilen)“ schaltet um.
  - „Kopieren“ schreibt den vollständigen Auszug in die Zwischenablage. Die Meldung „Kopiert“ oder „Kopieren nicht
    möglich“ steht in einer `aria-live`-Region und verschwindet nach 3 Sekunden.
  - Fehlgeschlagene Läufe ohne Auszug zeigen „Log nicht mehr verfügbar“. Das gilt für bereinigte Läufe.
- **Zustände:**
  - Laden: `dashboard/src/app/jobs/loading.tsx`.
  - Fehler: `dashboard/src/app/jobs/error.tsx`, „Die Jobs konnten nicht geladen werden.“ mit „Erneut versuchen“
    (ruft `retry`).
  - Keine Läufe, genau ein Repo gewählt und sonst kein Filter: „Noch kein Lauf.“ mit dem Link „Alle Läufe ansehen“.
  - Keine Läufe, sonst: „Noch kein Lauf.“ mit dem Hinweis, dass Renovate stündlich läuft.
  - Keine Treffer für die Filter: „Keine Treffer für diese Filter.“ mit „Filter zurücksetzen“. Der Zusatz lautet
    „Mit den gewählten Filtern liegt in den letzten 7 Tagen kein Lauf vor.“, bei einem gewählten Repo ohne weiteren
    Hinweis auf 7 Tage nur „Mit den gewählten Filtern liegt kein Lauf vor.“.

### 3.6 `/probleme`

- **Datei:** `dashboard/src/app/probleme/page.tsx`. Gruppen: `dashboard/src/components/problems/problem-groups.tsx`.
- **Zweck:** offene Probleme und die in den letzten 30 Tagen behobenen, nach Art gruppiert.
- **Adressparameter:**
  - `ansicht=offen|behoben`: Umschalter, Vorgabe `offen`. Der Link auf „Offen“ entfernt den Parameter wieder.
  - `art=config_error,job_failed,lockfile_failure,ci_red,missing_build_check,stale_pr`: Chips in dieser Reihenfolge
    (Labels aus `PROBLEM_KIND_LABEL`).
  - `repo=<owner>/<name>` (mehrfach): Chips für die Repos, die in dieser Ansicht und mit dem Art-Filter Probleme haben.
  - `alle=<art>[,<art>]`: klappt die Gruppen auf, die mehr als 10 Einträge haben. Die Gruppe „weitere X anzeigen“ ist
    ein Link mit diesem Parameter, „Weniger anzeigen“ entfernt ihn wieder.
- **Query:** `listProblems(db, {state, kinds})` und `countProblems(db, {repos, kinds, includeRemoved})` aus
  `dashboard/src/queries/problems.ts`. Die Zähler am Umschalter berücksichtigen Repo- und Art-Filter. Mit Repo-Filter lädt
  die Seite die Liste mit `repos` und `includeRemoved: true` neu, damit ein entferntes Repo in der Adresse sichtbar
  bleibt. Die Repo-Chips zeigen die Repos der Ansicht.
- **Gruppen:** Reihenfolge `PROBLEM_KIND_ORDER`. Jede Gruppe hat eine Überschrift mit Anzahl. Zunächst sind die ersten
  10 Einträge sichtbar (`PROBLEM_GROUP_VISIBLE`).
- **Eintrag:** Repo (nur auf dieser Seite, nicht im Repo-Detail), Kurzbeschreibung, „seit TT.MM.JJJJ“ oder bei
  behobenen „behoben am TT.MM.JJJJ“, und genau ein Beleg-Link (`problemEvidence` in
  `dashboard/src/domain/problem-evidence.ts`):
  - Hängender PR und rote CI mit PR-Nummer: „PR #N öffnen“ auf GitHub. Fehlt der PR, „Repo-Details“.
  - Konfigurations- und Lauffehler: „Log ansehen“ auf `/jobs?repo=…&status=failed`.
  - Lockfile-Fehler: „Läufe ansehen“ auf `/jobs?repo=…`.
  - Fehlender Build-Check: „Repo-Details“.
- **Umschalter** (`nav`, `aria-label="Ansicht"`): zwei Links mit `aria-current`, die Zahl steht daneben.
- **Zustände:**
  - Laden: `dashboard/src/app/probleme/loading.tsx`.
  - Fehler: `dashboard/src/app/probleme/error.tsx`, „Die Probleme konnten nicht geladen werden.“ mit „Erneut
    versuchen“ (ruft `retry`).
  - Offen leer: „Keine offenen Probleme.“ mit „Behobene ansehen“.
  - Behoben leer: „Keine behobenen Probleme.“ mit „Offene ansehen“.
  - Keine Treffer für die Filter: „Keine Treffer für diese Filter.“ mit „Filter zurücksetzen“.

## 4. Zusammenspiel

- Der Lagebericht verlinkt auf die Listen mit fest verdrahteten Parametern (`GROUP_LINK` in
  `dashboard/src/domain/report.ts`). Der Link „2 Sicherheitsupdates“ ist in `dashboard/e2e/uebersicht.spec.ts`
  geprüft, der Log-Link der Probleme in `dashboard/e2e/jobs-probleme.spec.ts`.
- Das Repo-Detail verlinkt auf `/jobs?repo=…`, `/probleme?ansicht=behoben&repo=…` und die Problemgruppen mit
  `alle`. Die Schritte im Repo-Detail und im Lagebericht stammen aus derselben Funktion (`buildSteps`).
- Der Fehlerfall der Datenbank: Das Layout fängt den Fehler beim Laden des Abgleich-Stempels ab. Die Seiten
  selbst zeigen bei einem Fehler die Fehlerseite ihres Segments.

## 5. Offene Punkte

- Offen: Die Chips für `repo=` auf `/jobs` zeigen nur die bereits gewählten Repos (`repos.map(...)` in
  `dashboard/src/app/jobs/page.tsx`), nicht alle Repos mit Läufen. Der Entwurf
  (`ansichten-entwurf.md`, Abschnitt „Jobs“) nennt einen Repo-Filter ohne diese Einschränkung. Ob das gewollt ist,
  muss der Betreiber bestätigen. Wer ein weiteres Repo filtern will, nutzt im Code das Suchfeld (`q`).
- Alle Fehlerseiten (`error.tsx`) nutzen `retry` (Next 16.3+): Es lädt die Serverdaten neu, `reset` würde nur neu rendern.
