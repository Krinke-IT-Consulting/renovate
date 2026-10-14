# Design

## Context

Siehe proposal.md (Why). Ausgangslage und Randbedingungen:

- **Ziel-Repos:** Die lokale Auswertung vom 2026-10-14 umfasst 8 Repos mit Git. Laut PRD gibt es
  zusätzlich pnpm (seatmagic), Bun, AWS CDK und Python ohne Tests. Die Erkennung muss daher
  breiter sein als die lokal gesehenen Repos.
- **Wirkung auf Automerge:** Das Preset mergt nur bei grünem kombiniertem Status
  (`platformAutomerge: false`). Ohne Check gibt es keinen Merge.
- **Reusable Workflows:**
  - Sie werden mit `uses: <owner>/<repo>/.github/workflows/<file>@<ref>` aufgerufen.
  - Sie lassen sich in einer Matrix aufrufen.
  - Aus einem öffentlichen Repo sind sie für private Repos anderer Owner nutzbar.
  - Ihr `services`-Block wird übersprungen, wenn `image` ein leerer String ist. Damit lässt sich
    die Postgres per Eingabe an- und abschalten.

## Goals / Non-Goals

**Goals:**
- Kein Aufruf-Repo braucht eigene Konfiguration für den Normalfall.
- Ein Check, der bei echtem Bruch rot wird und sonst nicht aus Formalien.
- Schnell genug für die Wochenend-Schübe und sparsam mit Actions-Minuten.

**Non-Goals:**
- Caching über Läufe hinaus, außer dem Paketmanager-Cache von `setup-*`
- Deploy-, Release- und Coverage-Schritte
- Rollout auf alle Repos (Dashboard)

## Decisions

### 1. Zwei Phasen: Erkennung erzeugt eine Matrix
- **Job `detect`:**
  - Ein Bash-Skript im Workflow durchsucht `working-directory` bis zur Tiefe drei, mit `find` und
    Ausschlussliste.
  - Daraus entsteht eine JSON-Liste von Einträgen `{dir, kind, pm}`. `kind` ist `node`, `python`,
    `go`, `docker` oder `compose`, `pm` ist der Paketmanager.
  - Die Eingabe `ecosystems` filtert die Liste.
  - Eine leere Liste lässt `detect` mit `::error::` fehlschlagen (Spec „Nichts erkannt").
- **Jobs `node`, `python`, `go`, `docker`, `compose`:**
  - je ein Job mit `strategy.matrix.include` aus dem gefilterten Teil der Liste
  - `fail-fast: false`, damit alle Fehler sichtbar werden
  - Name `<kind> · <dir>`
- **Verworfen:** ein einziger Job mit Schleife. Fehler wären dann schlechter zuzuordnen, und es
  gäbe keine Parallelität.
- **Verworfen:** Projekte als Pflicht-Eingabe des Aufrufers. Das widerspricht dem Ziel „ohne
  Konfiguration“.

### 2. Node-Ablauf
- **Paketmanager:**
  - pnpm über `pnpm/action-setup`, Version aus `packageManager`
  - Bun über `oven-sh/setup-bun` mit `bun-version-file: package.json`, falls `packageManager`
    gesetzt ist, sonst `latest`
  - Yarn über Corepack
- **Node-Version:** `setup-node` mit `node-version-file`, wenn `.nvmrc` oder `.node-version`
  vorhanden ist, sonst die Eingabe `node-version`, sonst `lts/*`.
- **Install:**

  | Paketmanager | Befehl |
  |---|---|
  | npm | `npm ci` |
  | pnpm | `pnpm install --frozen-lockfile` |
  | Bun | `bun install --frozen-lockfile` |
  | Yarn | `yarn install --immutable` (Berry) bzw. `--frozen-lockfile` (v1) |

- **Skripte:**
  - Das Vorhandensein wird per `node -e` aus `package.json` gelesen.
  - Ausgeführt wird `build`, dann `typecheck` (ersatzweise `npx --no-install tsc --noEmit`, wenn
    `tsconfig.json` existiert und `typescript` installiert ist), dann `lint`, dann `test`.
  - Workspaces wie in smoking-tracker laufen über die Skripte im Root. Deren `--if-present`-Logik
    bleibt Sache des Projekts.
- **Platzhalter-Test:** Erkannt wird der Text `no test specified`. Der Schritt meldet dann eine
  `::notice::` und geht weiter.

### 3. Python-Ablauf
- `astral-sh/setup-uv`; die Python-Version kommt aus `.python-version` bzw. `requires-python`,
  ersatzweise `3.12`.
- **Install:**

  | Vorhanden | Befehl |
  |---|---|
  | `uv.lock` | `uv sync --frozen --all-extras` |
  | nur `pyproject.toml` | `uv venv && uv pip install -e .` |
  | `requirements*.txt` | `uv pip install -r` je Datei |

- **Prüfung:** `python -m compileall -q` über alle Quellen außer `.venv`.
- **Tests:** `pytest`, wenn `tests/` oder `test_*.py` existieren. Ist pytest nicht installiert,
  wird es ad hoc installiert.

### 4. Go-Ablauf
- `actions/setup-go` mit `go-version-file: go.mod`, Cache an.
- Danach `go build ./...` und `go vet ./...`.
- `go test ./...` läuft nur, wenn es `*_test.go` gibt.

### 5. Docker und Compose
- **Docker:** `docker/setup-buildx-action`, danach `docker buildx build --output type=cacheonly`
  je `Dockerfile`. Es gibt kein Login und kein Push.
- **Build-Kontext** (geändert nach dem Pilot): Ursprünglich war das Verzeichnis des Dockerfiles
  immer der Kontext. Im Pilot zeigte sich, dass Monorepos wie smoking-tracker mit der Repo-Wurzel
  als Kontext bauen (`COPY apps/api …`, `COPY packages/shared …`). Coolify baut sie ebenso.
  - Der Schritt „Build-Kontext bestimmen“ liest die Quellen aller `COPY`- und `ADD`-Anweisungen.
    Zeilenfortsetzungen werden zusammengeführt. Nicht gezählt werden `--from`, Variablen, URLs,
    Heredocs und Wildcards; Wildcards dürfen in Docker leer bleiben.
  - Er geht vom Verzeichnis des Dockerfiles aufwärts bis zur Repo-Wurzel. Kontext wird das erste
    Verzeichnis, in dem alle Quellen existieren. Ohne Quellen oder ohne Treffer bleibt es beim
    eigenen Verzeichnis; der Build scheitert dann mit Dockers eigener Meldung.
  - Die Eingabe `docker-context` (`auto`, `dockerfile`, `repository`) übersteuert das für
    Sonderfälle, etwa ein `COPY . .`, das die Wurzel meint. Sie gilt für alle Dockerfiles des
    Aufrufs.
  - Verworfen: eine Liste von Kontexten je Dockerfile als Eingabe. Das wäre für die bekannten Repos
    unnötig umständlich.
  - Die Zusammenfassung nennt Kontext und Grund. Die Änderung ist kompatibel: Alle bisher
    erfolgreichen Builds behalten ihren Kontext, weil ihre Quellen im eigenen Verzeichnis liegen.
- **Compose:** `docker compose -f <datei> config --no-interpolate --quiet`, je Datei einzeln.
  Override-Dateien werden zusammen mit ihrer Basisdatei geprüft. Ein `compose build` findet nicht
  statt, denn die Dockerfiles sind schon einzeln abgedeckt.

### 6. Wegwerf-Postgres und Befehl vor den Tests
- Die Jobs `node` und `python` haben einen Service `postgres`.
  - Image: `${{ inputs.postgres && format('postgres:{0}', inputs.postgres-version) || '' }}`
  - Ports: `${{ inputs.postgres-port }}:5432`
  - Healthcheck: `pg_isready`
- **Feste Testwerte:**
  - Benutzer `postgres`, Passwort `postgres`, Datenbank `test`
  - Gesetzt werden `DATABASE_URL`, `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD` und `PGDATABASE`.
  - Das sind Wegwerf-Zugangsdaten im Sinne der Projektregel („lokale Entwicklungszugangsdaten“)
    und stehen offen im Workflow.
- **Befehl vor den Tests:** `pre-test-command` läuft mit `bash -euo pipefail` im Projektverzeichnis
  vor dem Testschritt.
- **Grenze:** Ein Aufruf mit Postgres gilt für alle Node- und Python-Projekte des Repos. Für
  Monorepos mit gemischtem Bedarf reicht das, denn die Datenbank stört nicht.
- **smoking-tracker:** Der Pilot braucht Port 5433. Seine Testwerte stehen in der
  `vitest.config`. Abweichende Zugangsdaten setzt der Aufrufer über `pre-test-command` oder die
  Test-Konfiguration des Repos.
- **Offene Prüfung:** Erwartet smoking-tracker abweichende Zugangsdaten, wird das im Pilot sichtbar
  (Task 5.2).

### 7. Sicherheit
- `permissions: contents: read` im Workflow und in der Vorlage.
- Der Workflow verlangt keine `secrets:`.
- `persist-credentials: false` beim Checkout.
- Alle Actions sind auf Digests gepinnt, mit Versionskommentar. Renovate hält sie über das Preset
  aktuell.
- Eingaben wie `pre-test-command` stammen nur aus dem aufrufenden Repo. Das ist dieselbe
  Vertrauensstufe wie dessen eigener Code.
- Zeichenketten aus Eingaben werden als Umgebungsvariablen übergeben, nicht direkt in `run:`
  interpoliert. Das verhindert Script-Injection über `${{ }}`.

### 8. Aufruf-Vorlage

```yaml
name: build-check
on:
  pull_request:
  push:
    branches: [main]
  workflow_dispatch:
permissions:
  contents: read
concurrency:
  group: build-check-${{ github.ref }}
  cancel-in-progress: true
jobs:
  build-check:
    uses: Krinke-IT-Consulting/renovate/.github/workflows/build-check.yml@v1
```

- `main` ist fest eingetragen. Repos mit anderem Standard-Branch passt das Dashboard beim Rollout
  an.
- **Verworfen:** `${{ github.event.repository.default_branch }}`. Es ist in `on.push.branches`
  nicht auswertbar.

### 9. Versionierung
- Erste Veröffentlichung: Tag `v1.0.0` und der mitwandernde Tag `v1` auf demselben Commit.
- Ablauf bei Änderungen:
  1. PR, Selbsttest grün, Merge
  2. `git tag v1.x.y && git tag -f v1 && git push origin v1.x.y && git push -f origin v1`
- Das Verschieben von `v1` geschieht nur nach Freigabe des Betreibers. Es wirkt auf alle Repos.
- Renovate pinnt die Aufrufe auf Digest mit Kommentar `# v1` (`helpers:pinGitHubActionDigests`).
  Ein verschobenes `v1` kommt als Digest-Update in der Patch-Gruppe an.
- **Verworfen:** Aufrufe direkt auf `@main`. Dann wäre jede Änderung sofort in allen Repos aktiv,
  ohne PR und ohne Automerge-Bremse.

### 10. Selbsttest und eigener Build-Check
- **Beispielprojekte** unter `tests/build-check/fixtures/`, alle minimal:

  | Beispiel | Inhalt |
  |---|---|
  | `npm-ts` | build, typecheck, test |
  | `pnpm` | pnpm-Projekt |
  | `bun` | Bun-Projekt |
  | `expo-like` | nur lint und tsconfig |
  | `python-uv` | mit pytest |
  | `python-req` | requirements, ohne Tests |
  | `go` | mit Test |
  | `docker` | Dockerfile |
  | `docker-root` | Dockerfile in `app/`, das die Wurzel des Beispiels als Kontext braucht |
  | `compose` | Compose-Datei mit `${SECRET}` |
  | `node-postgres` | Test verbindet sich mit `DATABASE_URL` |

- **`test-build-check.yml`:**
  - ruft `./.github/workflows/build-check.yml` in einer Matrix je Beispiel auf, mit passender
    `working-directory`, für `node-postgres` mit `postgres: true`
  - läuft bei PRs und Pushes auf `build-check.yml`, die Beispiele und sich selbst
- **`build-check-self.yml`:** ruft den lokalen Workflow für dieses Repo auf, mit
  `exclude-paths: tests/build-check` (Beispiele und Negativfälle). Damit werden die vier Dockerfiles und die
  Compose-Datei bei jedem PR geprüft, auch bei Renovate-PRs zu Basis-Images.
- **Negativfälle** (Lockfile-Bruch, roter Test, leeres Repo): Ein Workflow kann einen erwarteten
  Fehlschlag eines Reusable-Workflow-Aufrufs nicht als Erfolg werten. Diese Fälle prüft Task 4.3
  einmalig auf einem Test-Branch und hält das Ergebnis in der Feature-Doku fest.

## Risks / Trade-offs

- **[Risiko] Kosten an Actions-Minuten.** Docker-Builds und Matrix-Jobs je Projekt kosten Minuten.
  - Gegenmaßnahmen: Abbruch bei neuem Lauf und Caches der `setup-*`-Actions. Normale Updates kommen
    nur am Wochenende.
  - Das Dashboard kann später den Verbrauch anzeigen.
- **[Risiko] Lint bricht Automerge aus Formalgründen**, etwa durch neue Regeln nach einem Update
  von ESLint-Plugins.
  - Das ist gewollt: Ein solches Update braucht einen Blick.
  - Ist es lästig, schaltet ein späteres `run-lint`-Flag Lint ab. Das ist jetzt nicht Teil des
    Changes.
- **[Risiko] Erkennungsfehler**, etwa ein `package.json` ohne Lockfile, das nicht erkannt wird.
  Ohne Lockfile kein Node-Teil, das ist bewusst so. Der Check schlägt dann über „nichts erkannt“
  fehl, oder das Projekt fehlt still, wenn andere Teile existieren.
  - Gegenmaßnahme: Die Zusammenfassung des Laufs listet alle erkannten Teile.
- **[Trade-off] Öffentliches Repo als Quelle.** Jeder kann den Workflow lesen und nutzen. Das ist
  unkritisch, er enthält keine Secrets.
- **[Trade-off] Fester Branch `main` in der Vorlage.** Repos mit anderem Standard-Branch brauchen
  eine Anpassung.

## Migration Plan

1. Merge in `main`, dann Tags `v1.0.0` und `v1` nach Freigabe. Die Kontext-Erkennung aus dem
   Pilot folgt als `v1.1.0`; `v1` wandert mit.
2. Pilot-PR in `Hiwamashi/smoking-tracker` nach Freigabe. Der PR selbst löst den Check aus.
3. Danach weitere Repos über das Dashboard-Onboarding.

Rückweg: Aufruf-Datei im Repo entfernen. Tag `v1` auf den vorherigen Commit zurücksetzen.

## Open Questions

- Ob smoking-tracker für die Tests weitere Umgebungsvariablen braucht, zeigt der Pilot. Das ändert
  nur dessen Aufruf, nicht den Build-Check.
- **Install-Skripte unter npm 12.** npm 11 warnt bei Abhängigkeiten mit Install-Skripten ohne
  Freigabe über `allowScripts`; npm 12 soll sie standardmäßig blockieren. Dann brauchen die Repos
  eine gepflegte Freigabeliste (`npm approve-scripts`), sonst fehlen etwa native Module. Der
  Build-Check übernimmt das Verhalten der npm-Version und umgeht es nicht. Ob das Dashboard die
  Liste beim Onboarding anlegt, entscheidet ein späterer Change.
