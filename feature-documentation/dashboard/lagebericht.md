# Dashboard: Lagebericht (Startseite `/`)

Status: umgesetzt auf dem Branch `feat/dashboard-ansichten`. Gestaltung und Begründung stehen in
[`../uebersicht-entwurf.md`](../uebersicht-entwurf.md) (Variante „Lagebericht“, Entwurf bestätigt). Die Seite
selbst ist in [`ansichten.md`](ansichten.md), Abschnitt 3.1, beschrieben.

Dieses Dokument beschreibt die Textbausteine, die Schritte und die Erledigt-Logik, wie sie der Code tut.
Die Funktionen sind rein und stehen in `dashboard/src/domain/report.ts`. Tests dazu liegen in
`dashboard/src/domain/report.test.ts`.

## 1. Aufbau der Seite

- `dashboard/src/app/page.tsx` lädt alles über `loadOverview` (`dashboard/src/queries/overview.ts`) und ruft
  `buildSteps` und `buildReport` auf.
- Links im Absatz und Schritte kommen aus festen Adressen. Die Seite erzeugt keinen frei formulierten Text.
  Das ist eine bewusste Vorgabe der Spec `dashboard-views` (laut Kommentar in `report.ts`). Der Entwurf empfiehlt
  dasselbe („Textbausteine, kein LLM“).
- Die Seite hat zwei Spalten: links der Absatz und die Schritte, rechts die Kennzahlen und das Repo-Raster.

## 2. Schritte in fester Reihenfolge

`STEP_GROUPS` gibt die Gruppenreihenfolge vor. Sie gilt für den Lagebericht und für die Schritte im Repo-Detail.

| Nr. | Gruppe (`StepGroup`) | Überschrift (`STEP_GROUP_TITLE`) | Ton | Herkunft |
|---|---|---|---|---|
| 1 | `security` | Sicherheitsupdates | fehler | offene PRs mit `updateType = security` |
| 2 | `failure` | Rote Builds und fehlgeschlagene Läufe | fehler | offene Probleme der Arten `config_error`, `job_failed`, `lockfile_failure`, `ci_red` |
| 3 | `major` | Major-Updates zur Freigabe | warnung | offene PRs mit `updateType = major` |
| 4 | `onboarding` | Nicht onboardete Repos | warnung | Repos mit `onboarding = none`, nicht archiviert |
| 5 | `stale` | Hängende PRs | warnung | offene Probleme der Art `stale_pr`, ohne Sicherheits-PRs |

Innerhalb einer Gruppe gilt:

- `security`, `major`: ältester PR zuerst (`createdAt`), bei Gleichstand nach Repo-Name.
- `failure`: zuerst nach der Art (Konfiguration, Lauf, Lockfile, CI), dann das älteste Problem zuerst
  (`firstSeenAt`).
- `onboarding`: nach Repo-Name alphabetisch.
- `stale`: ältestes Problem zuerst.

Jeder Schritt hat einen Typ, einen Titel, optional einen Versionssprung, eine Detailzeile und genau eine Aktion.
Der Ton je Gruppe steht in `GROUP_TONE` (`dashboard/src/domain/report.ts`). Externe Aktionen verlinken nur
`https`-Adressen (`safeExternalHref`, siehe [`bausteine.md`](bausteine.md), Abschnitt 8). Andere Werte stehen als
Text ohne Link da.

### 2.1 Inhalt je Gruppe

- **Sicherheitsupdates** (`typeLabel` „Sicherheitsupdate“):
  - Titel: die Paketnamen. Bei bis zu zwei Paketen durch „, “ getrennt, sonst „erstes und N weitere“. Ohne
    Paketnamen steht der PR-Titel.
  - Versionssprung: `versionJump(title)` (siehe Abschnitt 5).
  - Details: CI-Status, Alter („seit heute offen“, „seit 1 Tag offen“, „seit N Tagen offen“). Ab 7 Tagen steht
    zusätzlich „, hängt“.
  - Aktion: „Auf GitHub mergen“, öffnet in neuem Tab.
- **Rote Builds und fehlgeschlagene Läufe** (`typeLabel` ist die Art des Problems, z. B. „CI rot“):
  - Titel: bei `ci_red` mit PR-Nummer „PR #N“. Sonst eine feste Aufgabe:
    - `config_error`: „Konfiguration prüfen“
    - `job_failed`: „Fehlgeschlagenen Lauf klären“
    - `lockfile_failure`: „Lockfile reparieren“
    - `ci_red` ohne PR-Nummer: „Rote CI klären“
  - Details: die Kurzbeschreibung des Problems und „seit heute“, „seit 1 Tag“ oder „seit N Tagen“.
  - Aktion: bei `ci_red` mit offenem PR „PR ansehen“ (extern). Sonst „Log ansehen“ auf
    `/jobs?repo=<owner>%2F<name>&status=failed` (der Repo-Name wird mit `encodeURIComponent` kodiert). Bei
    `lockfile_failure` ohne `status=failed`.
- **Major-Updates zur Freigabe** (`typeLabel` „Major-Update“):
  - Titel und Versionssprung wie bei Sicherheitsupdates.
  - Details: CI-Status und Alter (ohne „hängt“-Zusatz).
  - Aktion: „Freigeben“ auf GitHub, extern.
- **Nicht onboardete Repos** (`typeLabel` „Onboarding“):
  - Titel: Kurzname des Repos (ohne Owner).
  - Details: „Noch keine Renovate-Konfiguration“.
  - Aktion: „Zum Repo“ auf `/repos/<owner>/<name>`. Die Aktion „Onboarding-PR anlegen“ kommt mit Phase 7 (Kommentar
    in `report.ts`). Repos mit `pr_open` oder `disabled` erscheinen hier nicht.
- **Hängende PRs** (`typeLabel` „PR hängt“):
  - Titel: „PR #N“, sonst die Kurzbeschreibung.
  - Details: die Kurzbeschreibung und „älter als 14 Tage“ (`STALE_PR_DAYS`).
  - Aktion: „Auf GitHub öffnen“, extern. Ohne PR-URL: „Zum Repo“.
  - Hängende Sicherheits-PRs stehen schon in Gruppe 1 und fehlen hier.
  - Die Zahl im Absatz zählt dagegen alle offenen `stale_pr`-Probleme, auch die von Sicherheits-PRs (siehe 4.3).

## 3. Erledigt-Logik

Der Code steht in `dashboard/src/components/overview/step-list.tsx`, Funktion `useStepsWithDone`.

- Beim ersten Anzeigen gilt jeder Schritt als offen. Die Liste merkt sich alle Schritte, die sie gesehen hat.
- Verschwindet ein Schritt aus den Daten nach einem Auto-Refresh (siehe `ansichten.md`, Abschnitt 2), bleibt er auf
  der Seite stehen und ist **erledigt**:
  - Der Knoten ist ein Ring mit Haken (kein Zahl mehr).
  - Der Text trägt „Erledigt“ und ist abgeblendet. Der Knopf wird zur dezenten Schaltfläche.
  - Die Nummer des Schritts bleibt gleich. Die Reihenfolge ändert sich nicht.
- Noch vorhandene Schritte zeigen bei jedem Abgleich den aktuellen Stand (Titel, Details, Aktion) an ihrer bisherigen
  Stelle. Verschwundene bleiben als Snapshot stehen. Neue kommen ans Ende. Das leistet `mergeSteps` in
  `dashboard/src/domain/report.ts`.
- Erledigt bleibt bis zum Neuladen der Seite. Neu laden setzt den Zustand zurück, weil er nur im Browser liegt.
- Taucht ein Schritt wieder in den Daten auf, ist er wieder offen.
- Neue Schritte landen am Ende ihrer Gruppe, nicht an der Stelle, an der sie in der Daten-Reihenfolge stehen.
- Beim Wechsel des Repo-Filters (`?repo=`) wird die Liste neu aufgebaut (`key` auf `StepList` in `page.tsx`).
  Dadurch entstehen keine Erledigt-Schritte durch Filtern. Der Kommentar dort nennt genau das als Grund.
- Mobil (unter 768 px) zeigt `SwipeSteps` dieselben Schritte als Wischleiste. Der Schritt „Schritt N von M“ zählt
  alle sichtbaren Schritte, auch erledigte.
- Animation: nur der Farbübergang (`transition-colors duration-300`). `prefers-reduced-motion` setzt Übergänge in
  `dashboard/src/app/globals.css` auf praktisch null.

### 3.1 „weitere X anzeigen“

- Nur auf dem Desktop (`GroupedSteps`). Je Gruppe sind 5 Schritte sichtbar (`VISIBLE_PER_GROUP`).
- Hat eine Gruppe 7 oder weniger Schritte, zeigt sie alle. Erst ab 8 wird gekürzt. Dann steht darunter
  „weitere N anzeigen“, wobei N die Anzahl der verborgenen Schritte ist.
- Der Knopf ist ein Button mit lokalem Zustand. Er steht nicht in der Adresse und setzt sich mit dem Neuladen zurück.
- Mobil zeigt die Wischleiste alle Schritte ohne Kürzung.

## 4. Textbausteine

Der Absatz wird von `buildReport` aus festen Bausteinen zusammengesetzt. Er hat einen von drei Zuständen
(`Report.kind`).

### 4.1 Erster Start (`first-run`)

Gilt, wenn kein aktives Repo onboardet ist **und** es noch keinen Lauf gibt (`hasAnyJob` ist falsch).

- „Noch ist kein Repo onboardet, und Renovate ist noch nicht gelaufen. “
- Dann entweder „N Repo(s) wartet/warten auf das Onboarding“ (verlinkt auf `/repos?onboarding=none`) oder, wenn kein
  Repo wartet, „Sobald die App in einem Repo installiert ist, erscheint es hier“.
- Abschluss: „.“

### 4.2 Alles aktuell (`all-clear`)

Gilt, wenn es keine Schritte gibt. Der Text ist „Alles aktuell.“ Der Zusatz „Nächster Lauf um HH:MM.“ hängt nur an,
wenn `nextRunAt` gesetzt ist. Die Zeit steht in Europe/Berlin.

**Offen:** `loadOverview` übergibt kein `nextRunAt`. Der Zusatz erscheint deshalb derzeit nicht auf der Seite.
Siehe Abschnitt 7.

### 4.3 Offene Schritte (`open`)

- Anfang: „Ein Punkt braucht Ihre Entscheidung: “ bei genau einem Schritt. Sonst „N Punkte brauchen Ihre
  Entscheidung: “. Die Zahl steht bis Zwölf ausgeschrieben (`NUMBER_WORDS`, ab 13 als Ziffer).
- Je Gruppe mit Schritten eine Phrase: `N <Substantiv>` als Link auf die gefilterte Liste (siehe Abschnitt 5).
  - Singular und Plural der Substantive stehen in `GROUP_NOUN`, z. B. „Sicherheitsupdate“ und
    „Sicherheitsupdates“.
  - Außer bei Onboarding folgt „in <Repo>“. Bei bis zu drei verschiedenen Repos stehen die Kurznamen durch „, “
    getrennt und mit „und“ vor dem letzten. Bei mehr als drei steht „in N Repos“.
  - Bei Onboarding folgen bis zu drei Titel in Klammern, sonst nichts.
  - Bei hängenden PRs zählt die Zahl alle offenen `stale_pr`-Probleme, auch die von Sicherheits-PRs. Die Repo-Phrase
    nennt die Repos dieser Probleme. Der Link führt auf dieselbe Menge.
- Gruppen trennt „, “. Vor der letzten Gruppe steht „ und “.
- Ende: „.“ Danach optional der Zusatz „Ein weiteres Repo ist aktuell.“ bzw. „N weitere Repos sind aktuell.“ Gezählt
  werden aktive, onboardete Repos ohne Schritt.

Der Entwurf nennt als Beispiel „Sechs Dinge brauchen Sie: …“. Der Code verwendet „Punkte brauchen Ihre
Entscheidung“. Der Code gilt.

## 5. Links der Zahlen

Die Zahl jeder Gruppe ist ein Link (`GROUP_LINK` in `report.ts`):

| Gruppe | Ziel |
|---|---|
| Sicherheitsupdates | `/pull-requests?typ=security` |
| Rote Builds und fehlgeschlagene Läufe | `/probleme?art=config_error,job_failed,lockfile_failure,ci_red` |
| Major-Updates zur Freigabe | `/pull-requests?typ=major` |
| Nicht onboardete Repos | `/repos?onboarding=none` |
| Hängende PRs | `/probleme?art=stale_pr` |

Der Link „2 Sicherheitsupdates“ ist in `dashboard/e2e/uebersicht.spec.ts` geprüft.

Die Schritte selbst verlinken auf die Aktion (siehe Abschnitt 2.1) und den Repo-Namen auf `/repos/<owner>/<name>`.

## 6. Kennzahlen und Repo-Raster

Rechts stehen die Kennzahlen (`Metrics`) und das Repo-Raster (`RepoGrid`). Details zu Zahlen und Zielen stehen in
[`ansichten.md`](ansichten.md), Abschnitt 3.1.

- Kennzahlen: Repos (onboardet von allen aktiven), Offene PRs (mit Automerge-Anteil), Läufe der letzten 24 Stunden
  (mit Fehlschlägen), Offene Probleme.
- Repo-Raster: eine Kachel pro Repo, Farbe und Symbol nach dem dringendsten Zustand (`deriveRepoHealth`,
  `dashboard/src/domain/status-tone.ts`). Die Reihenfolge der Zustände steht in den Kommentaren dort.
- **Kachel-Filter:** Ein Klick auf eine Kachel setzt `?repo=<owner>/<name>` und filtert die Schritte.
  Die Überschrift wird zu „Schritte für <Kurzname>“ mit dem Link „Filter aufheben“. Der Absatz zeigt weiterhin
  alle Schritte. Ist für das Repo nichts offen, steht „nichts offen.“. Ein zweiter Klick auf dieselbe Kachel
  hebt den Filter auf.

## 7. Offene Punkte

- Offen: `nextRunAt` wird nie gesetzt. `loadOverview` (`dashboard/src/queries/overview.ts`) übergibt `report` ohne
  dieses Feld, obwohl `buildReport` den Zusatz „Nächster Lauf um HH:MM.“ erzeugt. Der Entwurf
  (`../uebersicht-entwurf.md`, Abschnitt 5) zeigt den Zusatz im Zustand „Alles erledigt“. Die CE-Statusantwort
  enthält laut `feature-documentation/dashboard/vorbereitung.md` einen Cron-Eintrag `0 * * * *`. Ob daraus der
  nächste Lauf berechnet werden soll, ist nicht entschieden.
- Bis Phase 7: Die Aktion Onboarding-PR fehlt. Der Schritt „Zum Repo“ ist ein Platzhalter.

## 8. Zusammenspiel mit anderen Dateien

- Die Gruppen, Schwellen und Textbausteine stehen in `dashboard/src/domain/report.ts`. Die Schwellen für hängende PRs
  (14 und 7 Tage) kommen aus `dashboard/src/domain/problems.ts`.
- Die Bausteine für Tonlagen und Symbole stehen in [`bausteine.md`](bausteine.md), Abschnitt 2.
- Der Repo-Detail-Abschnitt „Was hier zu tun ist“ nutzt `buildSteps` mit demselben Ergebnis für ein Repo
  (`repoSteps` in `dashboard/src/queries/repo-detail.ts`).

## 9. Versionssprung

`versionJump(title)` und `parseTargetVersion(title)` stehen in `dashboard/src/domain/version-jump.ts`. `report.ts` und
`dashboard/src/components/pull-requests/pull-request-format.ts` reexportieren sie. Die Funktion sucht `\bto\s+v?<Zahl>`
im Titel und zeigt `→ <Version>`. Ein Satzendepunkt gehört nicht zur Version. Ohne Treffer steht nichts da, es wird
nichts geraten. Der Kommentar an der Funktion nennt das Beispiel „update dependency next to v16“ mit dem Ergebnis
`→ v16`.

