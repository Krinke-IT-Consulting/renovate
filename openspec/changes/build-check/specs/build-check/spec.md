# Spec Delta

## Purpose

Ein zentraler, wiederverwendbarer Build-Check prüft in jedem angebundenen Repo, ob es nach einer
Änderung noch installiert, baut und seine Tests besteht. Er liefert den Status-Check, an dem das
Preset Automerge festmacht.

## ADDED Requirements

### Requirement: Aufruf als wiederverwendbarer Workflow
Der Build-Check MUST als wiederverwendbarer GitHub-Actions-Workflow unter
`Krinke-IT-Consulting/renovate/.github/workflows/build-check.yml` aufrufbar sein. Er MUST aus
privaten Repos beider Owner nutzbar sein und ohne Pflicht-Eingaben funktionieren. Optionale
Eingaben sind:

| Eingabe | Zweck |
|---|---|
| `working-directory` | Wurzel der Suche |
| `ecosystems` | Einschränkung auf bestimmte Ökosysteme |
| `node-version` | Node-Version |
| `exclude-paths` | auszuschließende Pfade |
| `run-tests` | Tests an- oder abschalten |
| `postgres` | Wegwerf-Postgres starten |
| `postgres-version` | Version der Postgres |
| `postgres-port` | Port der Postgres |
| `pre-test-command` | Befehl vor den Tests |
| `docker-context` | Build-Kontext der Dockerfiles: `auto`, `dockerfile` oder `repository` |

#### Scenario: Aufruf ohne Eingaben
- **WHEN** ein Repo die Aufruf-Vorlage unverändert übernimmt
- **THEN** läuft der Build-Check für alle erkannten Projekte des Repos

#### Scenario: Privates Repo
- **WHEN** ein privates Repo von `Hiwamashi` den Workflow aufruft
- **THEN** startet der Lauf ohne Fehler wegen fehlenden Zugriffs

### Requirement: Erkennung je Verzeichnis
Der Build-Check MUST die prüfbaren Projekte selbst erkennen, unterhalb von `working-directory` bis
zur Tiefe drei. Er erkennt sie an diesen Dateien:

| Ökosystem | Erkennungsmerkmal |
|---|---|
| Node | `package-lock.json`, `pnpm-lock.yaml`, `bun.lock`/`bun.lockb` oder `yarn.lock` |
| Python | `uv.lock`, `pyproject.toml` oder `requirements*.txt` |
| Go | `go.mod` |
| Docker | `Dockerfile` |
| Compose | `docker-compose*.y*ml` oder `compose*.y*ml` |

Jedes gefundene Projekt MUST als eigener, im Check benannter Teil geprüft werden. Verzeichnisse wie
`node_modules`, `.venv`, `vendor`, `dist`, `build` und die Pfade aus `exclude-paths` MUST NOT
durchsucht werden.

#### Scenario: Monorepo mit drei Ökosystemen
- **WHEN** ein Repo `web/package-lock.json`, `server/uv.lock` und `device/go.mod` enthält
- **THEN** entstehen drei Prüfteile: Node in `web`, Python in `server` und Go in `device`

#### Scenario: Ausgeschlossener Pfad
- **WHEN** `exclude-paths` den Pfad `tests/fixtures` enthält
- **THEN** wird darunter nichts geprüft

### Requirement: Nichts erkannt ist ein Fehler
Findet der Build-Check kein prüfbares Projekt, MUST er fehlschlagen und das im Ergebnis benennen.
Sonst gäbe ein grüner, inhaltsleerer Check Automerge frei.

#### Scenario: Repo nur mit PowerShell-Skripten
- **WHEN** ein Repo ohne erkennbares Projekt den Build-Check aufruft
- **THEN** schlägt der Check mit der Meldung fehl, dass nichts Prüfbares gefunden wurde

### Requirement: Node-Projekte
Für ein Node-Projekt gelten diese Regeln:

- **Paketmanager:** Er MUST nach der Lockfile gewählt werden. Installiert wird mit eingefrorener
  Lockfile, also ohne sie zu ändern.
- **Node-Version:** Quelle ist `.nvmrc` oder `.node-version` des Projekts. Fehlen beide, gilt die
  Eingabe `node-version`, sonst die aktuelle LTS.
- **Skripte:** Danach MUST der Build-Check die Skripte `build`, `typecheck` und `lint` ausführen,
  jeweils nur, wenn das Projekt sie hat.
- **Typecheck ohne Skript:** Fehlt `typecheck`, gibt es aber eine `tsconfig.json`, MUST
  `tsc --noEmit` laufen.
- **Tests:** Das Skript `test` MUST laufen, außer es fehlt, ist der npm-Platzhalter oder
  `run-tests` ist aus.

#### Scenario: Projekt mit pnpm und .nvmrc
- **WHEN** ein Projekt `pnpm-lock.yaml` und `.nvmrc` hat
- **THEN** installiert der Build-Check mit pnpm in der Version aus `packageManager` und der
  Node-Version aus `.nvmrc`, ohne die Lockfile zu ändern

#### Scenario: Lockfile passt nicht zu package.json
- **WHEN** die Lockfile nicht zu `package.json` passt
- **THEN** schlägt der Install-Schritt fehl

#### Scenario: Expo-Projekt ohne Build- und Test-Skript
- **WHEN** ein Expo-Projekt nur ein `lint`-Skript und eine `tsconfig.json` hat
- **THEN** laufen Install, `lint` und `tsc --noEmit`, und kein nativer Build

#### Scenario: Platzhalter-Test
- **WHEN** das `test`-Skript der npm-Standard „Error: no test specified" ist
- **THEN** wird der Testschritt übersprungen und als übersprungen ausgewiesen

### Requirement: Python- und Go-Projekte
Python- und Go-Projekte prüft der Build-Check so:

- **Python:**
  - Er MUST die Abhängigkeiten mit uv installieren (`uv sync --frozen --all-extras`, wenn `uv.lock` existiert)
    oder sonst per pip aus `pyproject.toml` bzw. `requirements*.txt`.
  - Er MUST alle Quelldateien kompilieren.
  - Er MUST `pytest` ausführen, wenn Tests existieren und `run-tests` an ist.
- **Go:**
  - Er MUST die Go-Version aus `go.mod` nehmen.
  - Er MUST `go build ./...` und `go vet ./...` ausführen.
  - Er MUST `go test ./...` ausführen, wenn Testdateien existieren und `run-tests` an ist.

#### Scenario: Python-Projekt mit Syntaxfehler
- **WHEN** eine Python-Datei nicht kompiliert
- **THEN** schlägt der Check fehl, auch wenn es keine Tests gibt

#### Scenario: Go-Projekt mit Tests
- **WHEN** ein Go-Modul Dateien `*_test.go` enthält
- **THEN** läuft `go test ./...`, und ein fehlschlagender Test lässt den Check fehlschlagen

### Requirement: Docker- und Compose-Dateien
Jedes gefundene `Dockerfile` MUST gebaut werden, ohne das Image zu veröffentlichen. Den
Build-Kontext bestimmt `docker-context`:

| Wert | Kontext |
|---|---|
| `auto` (Vorgabe) | das erste Verzeichnis vom Dockerfile aufwärts bis zur Repo-Wurzel, in dem alle Quellen der `COPY`- und `ADD`-Anweisungen existieren; ohne solche Quellen oder ohne Treffer das eigene Verzeichnis |
| `dockerfile` | das Verzeichnis des Dockerfiles |
| `repository` | die Repo-Wurzel |

Quellen aus anderen Build-Stufen (`--from`), mit Variablen, URLs und Wildcards zählen bei `auto`
nicht. Der gewählte Kontext MUST in der Zusammenfassung des Laufs stehen. Jede Compose-Datei MUST
mit `docker compose config` geprüft werden, ohne Variablen aufzulösen, damit fehlende Secrets kein
Fehler sind.

#### Scenario: Basis-Image-Update bricht den Build
- **WHEN** ein Renovate-PR das Basis-Image eines Dockerfiles auf eine Version hebt, mit der der
  Build fehlschlägt
- **THEN** schlägt der Check fehl, und der PR wird nicht automatisch gemergt

#### Scenario: Dockerfile im Monorepo mit der Repo-Wurzel als Kontext
- **WHEN** `apps/api/Dockerfile` die Pfade `apps/api` und `packages/shared` kopiert, die nur von der
  Repo-Wurzel aus existieren
- **THEN** baut der Check mit der Repo-Wurzel als Kontext und nennt ihn in der Zusammenfassung

#### Scenario: Dockerfile mit eigenem Verzeichnis als Kontext
- **WHEN** `renovate-ce/Dockerfile` die Datei `config.js` aus seinem eigenen Verzeichnis kopiert
- **THEN** baut der Check mit `renovate-ce` als Kontext

#### Scenario: Compose-Datei mit Secret-Platzhaltern
- **WHEN** eine Compose-Datei `${SECRET}` ohne gesetzten Wert enthält
- **THEN** besteht die Prüfung, sofern die Datei sonst gültig ist

### Requirement: Wegwerf-Postgres und Befehl vor den Tests
Ist `postgres` an, MUST für Node- und Python-Projekte eine leere Postgres-Datenbank in der Version
`postgres-version` auf `localhost:<postgres-port>` bereitstehen. Ihre Verbindungsdaten MUST die
Tests als `DATABASE_URL` und `PG*`-Variablen erhalten; es sind feste Testwerte ohne
Geheimnischarakter. Ist `pre-test-command` gesetzt, MUST er im Projektverzeichnis vor den Tests
laufen, und sein Fehlschlag MUST den Check fehlschlagen lassen.

#### Scenario: Prisma-Projekt mit Tests gegen Postgres auf Port 5433
- **WHEN** der Aufruf `postgres: true`, `postgres-port: 5433` und
  `pre-test-command: npx prisma migrate deploy` setzt
- **THEN** laufen die Migrationen und danach die Tests gegen die Wegwerf-Datenbank

### Requirement: Keine Secrets, minimale Rechte
Der Build-Check MUST ohne Secrets des aufrufenden Repos auskommen und MUST nur Leserechte auf den
Repo-Inhalt anfordern. Er MUST NOT Images veröffentlichen, Commits schreiben oder Kommentare
anlegen. Alle verwendeten Actions MUST auf Commit-Digests gepinnt sein.

#### Scenario: Aufruf aus einem PR eines Forks
- **WHEN** der Build-Check für einen PR aus einem Fork läuft
- **THEN** hat er keinen Zugriff auf Secrets und keine Schreibrechte

### Requirement: Aufruf-Vorlage und Versionierung
Das Repo MUST eine Aufruf-Vorlage `templates/build-check-caller.yml` bereitstellen. Sie ruft den
Build-Check bei Pull Requests, bei Pushes auf den Standard-Branch und von Hand auf. Laufen für
denselben Branch mehrere Läufe, MUST ein neuer Lauf den älteren abbrechen. Der Workflow MUST über
einen mitwandernden Major-Tag `v1` veröffentlicht werden; inkompatible Änderungen erhalten einen
neuen Major-Tag.

#### Scenario: Neue Version des Build-Checks
- **WHEN** eine kompatible Verbesserung als `v1.1.0` getaggt wird und `v1` auf denselben Commit
  zeigt
- **THEN** erhalten aufrufende Repos sie über einen Renovate-PR, der den gepinnten Digest anhebt

### Requirement: Selbsttest
Jede Änderung am Build-Check MUST in diesem Repo gegen Beispielprojekte aller unterstützten
Ökosysteme laufen. Ein Fehlschlag MUST den PR mit der Änderung als fehlerhaft markieren.

#### Scenario: Änderung bricht die Bun-Unterstützung
- **WHEN** ein PR den Build-Check so ändert, dass das Bun-Beispiel nicht mehr installiert
- **THEN** schlägt der Selbsttest für dieses Beispiel fehl
