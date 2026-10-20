# Dashboard: Tests, Fixtures und Smoke

Status: umgesetzt auf dem Branch `feat/dashboard-ansichten` (Tasks 6.3 bis 6.6 laut Entwurf). Die Seiten selbst stehen in
[`ansichten.md`](ansichten.md), die Bausteine in [`bausteine.md`](bausteine.md).

Dieses Dokument beschreibt, was der Code in `dashboard/` tut. Die Befehle stehen in `dashboard/package.json`.

## 1. Überblick

| Art | Werkzeug | Ort | Läuft in CI |
|---|---|---|---|
| Unit-Tests | Vitest 5.0.4 (`vitest run`, Skript `test`) | `dashboard/src/**/*.test.ts` | siehe Abschnitt 6 |
| End-to-End-Smoke | Playwright (`playwright test`, Skript `e2e`) | `dashboard/e2e/` | nein |
| Bildschirmfotos | Playwright mit `SCREENS=1` (Skript `e2e:screens`) | `dashboard/e2e/screens.spec.ts` | nein, nur von Hand |

Die Versionen stehen in `dashboard/package.json`: `vitest` `5.0.4`, `@playwright/test` `1.64.0`. Playwright ist bewusst auf `1.64.0` gepinnt (Release älter als zwei Wochen).
Vor dem ersten Lauf einmalig die Browser laden: `npx playwright install chromium`.

Das Docker-Image des Dashboards (`dashboard/.dockerignore`) schließt `e2e/`, `test-results/`, `playwright-report/` und
`playwright.config.ts` aus dem Build-Kontext aus. Die Smoke-Tests gehören damit nicht ins Image.

## 2. Unit-Tests (Vitest)

- Konfiguration: `dashboard/vitest.config.mts`. Sie löst den Alias `@` auf `./src` auf und sammelt
  `src/**/*.test.ts` und `tests/**/*.test.ts` in der Umgebung `node`. `.tsx`-Dateien werden nicht eingesammelt.
- Die Tests dieses Branches (Dateien unter `dashboard/`):
  - `src/domain/report.test.ts`: Szenarien des Lageberichts (zwei Sicherheitsupdates, alles erledigt, erster Start),
    feste Gruppenreihenfolge ohne doppelte hängende Sicherheits-PRs, Zahlen und Links (auch die Zählung hängender PRs
    und archivierte Repos bei Onboarding), `mergeSteps` für den Erledigt-Zustand, Hilfsfunktionen.
  - `src/domain/problem-evidence.test.ts`: genau ein Beleg je Problemart.
  - `src/lib/lib.test.ts`: Formatierung (`format.ts`), Adressparameter (`search-params.ts`, auch Steuerzeichen im
    Suchtext) und die Ableitung des Repo-Zustands (`deriveRepoHealth`).
  - `src/lib/log-view.test.ts`: Kürzung des Log-Auszugs auf 30 Zeilen.
  - `src/lib/repo-list.test.ts`: Sortierung nach Handlungsbedarf und Zusammenfassung der Repo-Liste.
  - `src/queries/repo-detail.test.ts`: `repoSteps` (die reine Funktion für die Schritte im Repo-Detail, keine Abfrage).
  - `src/components/pull-requests/pull-request-format.test.ts`: Zielversion aus dem Titel, Hängen-Schwelle (14 Tage,
    bei Sicherheit 7), Altertext und die Sortierung der PR-Liste (`sortPullRequests`).
  - `src/lib/sql.test.ts`: Maskierung von `%`, `_` und `\` in Suchtexten.
  - `src/lib/safe-external-href.test.ts`: nur `https`-Adressen werden verlinkt.
- Befehl: im Verzeichnis `dashboard/` `npm test`.
- Die Tests in diesem Branch prüfen Funktionen ohne Datenbank. Die Seitenabfragen laufen nur im Smoke gegen eine echte
  Datenbank.

## 3. Fixtures (`dashboard/src/db/fixtures.ts`)

### 3.1 Zweck und Schutz

- `seedFixtures(db, options)` leert die Tabellen und schreibt erfundene Daten. Owner sind `beispiel-firma` und
  `beispiel-privat`, Repos und PRs sind erfunden. Die Datei kennzeichnet die Daten als Fixtures.
- **Schutz über den Datenbanknamen.** `seedFixtures` liest `current_database()` und ruft `assertFixtureDatabase(name)`
  auf. Der Name muss auf `_fixture` oder `_e2e` enden (`FIXTURE_DB_SUFFIXES`). Sonst wirft die Funktion einen Fehler.
  Die Fehlermeldung nennt nur die erlaubten Endungen, nicht den Namen der Datenbank. Der Schutz greift vor dem
  Leeren.
- **Leert alle Tabellen.** Die Anweisung lautet `truncate table audit_log, rollout_actions, problems, renovate_jobs,
  pull_requests, repositories, platform_connections, tenants, sync_state, http_cache restart identity cascade`.
  Mit einer Datenbank, die kein Wegwerfsystem ist, darf die Funktion nicht laufen. Der Schutz über den Namen ist
  die einzige Sperre.
- **Aufrufer:** nur `dashboard/e2e/db.ts` (Funktion `seed`). Die Funktion `seed` wird von
  `dashboard/e2e/global-setup.ts` aufgerufen. Im `src/`-Code gibt es keinen weiteren Aufrufer.
- **Optionen (`SeedOptions`):** `now` (Bezugszeitpunkt, Standard jetzt) und `syncError`. Mit `syncError` setzt die
  Funktion einen GitHub-Fehler im Abgleich. Der Smoke ruft `seed()` ohne Optionen auf. Der Fehlerzustand wird im
  Smoke deshalb per SQL gesetzt (siehe 4.3).

### 3.2 Welche Zustände die Fixtures abdecken

Die Fixtures enthalten 14 Repos, 10 PRs, 8 gezielte Läufe (dazu sechs stündliche erfolgreiche Läufe je onboardetem
Repo), 12 Probleme (9 offen, 3 behoben), 3 Rollout-Aktionen und 2 Abgleich-Zeilen. Die Zahlen zählen die Einträge in
`fixtures.ts`. Sie decken diese Zustände ab:

| Zustand | Wo in den Fixtures |
|---|---|
| Onboardet, normal | die meisten Repos, sechs stündliche Läufe je Repo |
| Nicht onboardet (`none`), Build-Check fehlt, ohne Konfigurationspfad | `beispiel-firma/infra` |
| Onboarding-PR offen (`pr_open`) | `beispiel-privat/dotfiles` (Rollout-PR #1) |
| Deaktiviert (`disabled`) | `beispiel-privat/fotoarchiv` |
| Archiviert | `beispiel-firma/legacy-portal` |
| Entfernt (`removed_at` vor 5 Tagen) | `beispiel-firma/alt-tool` |
| Eigene CI (`own_ci`, `ownCi`) | `beispiel-firma/website` |
| Build-Check fehlt (`missing`) | `beispiel-firma/lager-sync`, `beispiel-privat/dotfiles`, `beispiel-firma/infra` |
| Konfigurationsfehler von CE (`ceStatus` `failed`) | `beispiel-privat/notizen` |
| Kein Lauf, keine Ökosysteme | `beispiel-privat/leeres-repo` |
| PR Sicherheit, frisch | `shop-api` #101 |
| PR Sicherheit, hängend (ab 7 Tagen) | `blog` #33 (9 Tage) |
| PR Major mit roter CI | `shop-api` #98, `kasse` #57 |
| PR Major mit grüner CI | `blog` #35 |
| PR mit laufender CI und Automerge | `shop-api` #103 |
| PR Minor mit mehreren Paketen | `kasse` #59 (`expo`, `expo-router`, `expo-camera`) |
| PR hängend (normal, ab 14 Tagen) | `lager-sync` #12 (20 Tage) |
| PR Digest mit Automerge | `website` #210 |
| PR Lockfile ohne Paketname, mit Automerge | `rezepte` #8 |
| Lauf fehlgeschlagen mit Log | `kasse` (ERESOLVE), `notizen` (config-validation) |
| Lauf mit Artefaktfehler (Lockfile-Hinweis) | `wetter-app` (2 Artefaktfehler) |
| Lauf manuell / per Webhook | `shop-api` / `website` |
| Lauf läuft | `rezepte` |
| Lauf wartet | `blog` |
| Lauf fehlgeschlagen, Log bereinigt | `shop-api` (30 Stunden alt, ohne Log) |
| Offene Probleme aller sechs Arten | `notizen` (config_error), `kasse` (job_failed), `wetter-app` (lockfile_failure), `kasse` und `shop-api` (ci_red), `lager-sync` (missing_build_check, stale_pr), `blog` (stale_pr) |
| Behobene Probleme im 30-Tage-Fenster | `shop-api` job_failed (29 Stunden), `website` ci_red (6 Tage, ohne PR-Datensatz), `rezepte` missing_build_check (10 Tage) |
| Rollout-Aktionen | `dotfiles` Onboarding (PR offen), `shop-api` Onboarding (übernommen), `shop-api` Build-Check (übernommen) |
| Abgleich | GitHub vor 2 Minuten, Renovate vor 30 Sekunden, ohne Fehler und ohne Teilfehler |

Zu beachten:

- Die Fixture `website` `ci_red` (#205) hat keinen PR-Datensatz. Der Beleg zeigt deshalb auf das Repo-Detail.
- Die Repo-Namen, Owner und Installations-IDs sind erfunden. Die `externalId` ist fortlaufend.
- Die Zeitstempel liegen relativ zu `now`. Altersangaben ändern sich deshalb mit der Zeit. Die Specs in diesem Stand
  prüfen Texte wie `Sicherheitsupdate` oder `PR #57`, keine Altersangaben im Wortlaut.

## 4. Playwright-Smoke

### 4.1 Konfiguration (`dashboard/playwright.config.ts`)

- `testDir: ./e2e`, `globalSetup: ./e2e/global-setup.ts`, `workers: 1`, `fullyParallel: false`, Reporter `list`.
- Sprache `de-DE`, Zeitzone `Europe/Berlin`, `trace: retain-on-failure`.
- Eine Sitzung über einen Cookie (`authelia_session`), den die Fake-Authelia akzeptiert.
- Zwei Projekte:
  - `desktop`: Desktop Chrome, 1440 × 900.
  - `mobil`: Desktop Chrome mit 375 × 812, `isMobile` und `hasTouch`.
- Zwei Webserver:
  1. **Fake-Authelia** (`dashboard/e2e/fake-authelia.mjs`) auf `127.0.0.1` und dem Port aus `E2E_AUTH_PORT` (Standard
     `9191`). Die Antwort `/api/authz/forward-auth` ist 200 mit `Remote-User: fixture`, sobald ein Cookie mitkommt.
     `/api/health` ist die Bereitschaftsprüfung.
  2. **Next-Dev-Server** `npx next dev -p <E2E_PORT> -H 127.0.0.1` (Standard `E2E_PORT` = `3100`). Er bekommt
     `DATABASE_URL` aus `e2eDatabaseUrl()`, `AUTHELIA_INTERNAL_URL` auf die Fake-Authelia und leere Werte für
     `RENOVATE_CE_API_URL`, `MEND_RNV_API_SERVER_SECRET`, `MEND_RNV_GITHUB_APP_ID`, `MEND_RNV_GITHUB_APP_KEY`.
     Damit startet der Abgleich nicht (`dashboard/src/instrumentation.ts` startet ihn nur bei vollständiger
     Konfiguration). Der Timeout ist 120 Sekunden.
- `reuseExistingServer: true` bei beiden Servern. Läuft auf dem Port schon ein Server, nutzt Playwright ihn. Dann
  gelten die Umgebungswerte der Konfiguration für ihn nicht. Das ist ein Risiko, wenn dort eine andere Datenbank läuft.

### 4.2 Datenbank (`dashboard/e2e/db.ts`)

- `ADMIN_URL` kommt aus `E2E_DATABASE_URL`. Ohne Wert gilt `postgresql://postgres:dev@localhost:55432/postgres`. Der
  Standard passt zum lokalen Docker-Container aus `.env.example` (kein Geheimnis, siehe 5.2).
- `E2E_DB` legt den Namen der Wegwerf-Datenbank fest. Standard ist `dashboard_e2e`. Der Name muss zum Muster
  `^[a-z0-9_]+_e2e$` passen. Sonst wirft das Modul beim Laden einen Fehler.
- `recreateDatabase()` löscht die Datenbank mit `drop database if exists … with (force)`, legt sie neu an und führt
  die Migrationen aus `dashboard/drizzle/` aus (`runMigrations` aus `dashboard/src/db/migrate.ts`).
- `seed()` ruft `seedFixtures` mit einem Pool auf, der genau eine Verbindung hält.

`global-setup.ts` führt beides in dieser Reihenfolge aus. Jeder `npm run e2e` beginnt mit einer frischen Datenbank.

### 4.3 Specs (`dashboard/e2e/`)

| Datei | Prüft |
|---|---|
| `shell.spec.ts` | Abgleich-Stempel steht auf der Startseite |
| `uebersicht.spec.ts` | Lagebericht: Link auf die PR-Liste, feste Gruppenreihenfolge, Kachel-Filter, Mobil ohne Querscrollen |
| `repos.spec.ts` | Repo-Liste: Filter per Adresse, Owner-Filter, entfernte Repos, Standardsortierung, Sortierung per Tastatur, Repo-Detail (Abschnitte, Onboarding ohne Knopf, entferntes Repo, unbekanntes Repo), Mobil ohne Querscrollen |
| `pull-requests.spec.ts` | PR-Liste: gefilterte Liste per Link, Chip-Auswahl, Leerzustand, Suche nach Paketnamen, Karten auf dem Handy, Sortierung nach Alter über die ganze Liste |
| `jobs-probleme.spec.ts` | Log-Auszug aufklappen und kopieren, bereinigter Lauf, Leerzustände, entferntes Repo in der Adresse (Jobs und Probleme), Sortierung der Jobs nach Repo, Probleme offen und behoben, Belege, Art-Filter, Mobil ohne Querscrollen |
| `zustaende.spec.ts` | Abgleich-Fehler mit Uhrzeit (per SQL gesetzt), Daten bleiben sichtbar, Leerzustand mit Filter |
| `screens.spec.ts` | Bildschirmfotos (nur mit `SCREENS=1`), siehe 4.4 |

Der Fehlerzustand des Abgleichs setzt `zustaende.spec.ts` direkt in `sync_state` (`last_error_at`,
`last_error_message`) und setzt ihn nach jedem Test zurück. Die Tests laufen seriell.

Die Tests verwenden die Fixture-Werte (etwa `beispiel-firma/kasse`, `PR #57`). Sie hängen damit an
`fixtures.ts`. Wer dort Namen ändert, muss die Specs anpassen.

### 4.4 Befehle

- `npm run e2e` (im Verzeichnis `dashboard/`): führt `playwright test` aus, also alle Specs in beiden Projekten.
- `npm run e2e:screens`: führt `SCREENS=1 playwright test e2e/screens.spec.ts` aus. Der Befehl macht Fotos statt Tests.
- `SCREENS_PATHS`: kommagetrennte Liste der Pfade. Standard `/,/repos,/repos/beispiel-firma/kasse,/pull-requests,/jobs,/probleme`.
  Beispiel: `SCREENS_PATHS=/repos,/jobs npm run e2e:screens`.
- Ausgabe: `dashboard/test-results/screens/<projekt>-<name>.png`. Für `/` ist der Name `uebersicht`. Für andere Pfade
  wird der führende Schrägstrich entfernt, Schrägstriche werden zu `_`. Vollständige Seiten (`fullPage: true`).
- `test-results/` und `playwright-report/` stehen in `dashboard/.gitignore`.

### 4.5 Umgebungsvariablen

| Variable | Standard | Wirkung |
|---|---|---|
| `E2E_DATABASE_URL` | `postgresql://postgres:dev@localhost:55432/postgres` | Admin-Zugang, in dem die Testdatenbank angelegt wird |
| `E2E_DB` | `dashboard_e2e` | Name der Wegwerf-Datenbank, muss auf `_e2e` enden |
| `E2E_PORT` | `3100` | Port des Next-Dev-Servers |
| `E2E_AUTH_PORT` | `9191` | Port der Fake-Authelia |
| `SCREENS` | ungesetzt | `1` schaltet die Bildschirmfotos ein |
| `SCREENS_PATHS` | siehe 4.4 | Pfade für die Fotos |

`E2E_PORT` und `E2E_AUTH_PORT` erlauben parallele Arbeitskopien. Der Kommentar in `playwright.config.ts` nennt das
ausdrücklich.

## 5. Lokale Docker-Postgres

### 5.1 Befehl

`.env.example` (im Repo-Wurzelverzeichnis) nennt den Befehl für eine lokale Wegwerf-Datenbank:

```bash
docker run -d --name dashboard-dev-db -e POSTGRES_PASSWORD=dev -p 55432:5432 postgres:16
```

Die Zeile `E2E_DATABASE_URL=postgresql://postgres:dev@localhost:55432/postgres` ist dort als Beispiel
auskommentiert. Der Wert ist leer, der Standard in `e2e/db.ts` passt aber zu diesem Container.

### 5.2 Geheimnis oder nicht

Die Zugangsdaten dieses Containers stehen bewusst im Klartext in `.env.example`. Der Container ist eine
Wegwerf-Datenbank auf dem eigenen Rechner. Er betrifft kein System außerhalb davon. Das entspricht der Regel in
`CLAUDE.md` („Lokale Entwicklungszugangsdaten sind keine Geheimnisse“). Der Smoke löscht nur die Datenbank aus
`E2E_DB`, und deren Name muss auf `_e2e` enden.

## 6. CI

- `build-check-self.yml` ruft den Build-Check für alle Node-Projekte dieses Repos auf (außer `tests/build-check`),
  also auch für `dashboard/`: `typecheck`, `lint` und `test` (Vitest) laufen bei jedem PR, mit Wegwerf-Postgres
  (`postgres: true`) für die Integrationstests.
- **Playwright läuft in keiner CI.** Der Smoke läuft lokal von Hand (`npm run e2e`), vor jedem PR der Ansichten.

## 7. Offene Punkte

- Offen: Der Kommentar in `dashboard/e2e/fake-authelia.mjs` spricht von einer „lokalen Ansicht mit Fixtures“. Im Code
  gibt es keinen Befehl, der die Fixtures in eine Entwicklungsdatenbank schreibt. `seedFixtures` hat nur den
  Aufrufer `e2e/db.ts`. Ob ein solcher Befehl gewollt ist, ist offen.
- Offen: Der Smoke läuft gegen `next dev`. Ein Test gegen den Produktionsbau ist nicht vorhanden.
