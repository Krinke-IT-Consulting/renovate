# Build-Check (zentraler Reusable Workflow)

Status: umgesetzt im OpenSpec-Change `build-check` (Tasks 1 bis 5 erledigt bis auf 3.5, Dokumentation Task 6.1
mit dieser Datei). Quellen der Anforderungen: `openspec/changes/build-check/` (`proposal.md`, `design.md`, `tasks.md`,
`specs/build-check/spec.md`). Offen ist nur die Sichtprüfung der Lauf-Zusammenfassung durch den Betreiber
(Task 3.5); geschrieben wird sie bereits (Abschnitt 4).

Dieses Dokument beschreibt, was `.github/workflows/build-check.yml` tatsächlich tut. Wenn Workflow und
dieser Text voneinander abweichen, gilt der Workflow. Der Build-Check enthält keine Werte, die nicht im
Repository stehen dürften.

## 1. Überblick

Der Build-Check ist ein wiederverwendbarer GitHub-Actions-Workflow (`on: workflow_call`) in diesem öffentlichen
Repo. Er erkennt die prüfbaren Teile des aufrufenden Repos selbst und prüft jeden Teil in einem eigenen Job.
Sein Zweck ist ein Status-Check, an dem das Renovate-Preset Automerge festmacht. Ohne grünen Check mergt
Renovate nichts (`platformAutomerge: false`, siehe `design.md`, Kontext).

Aufruf aus einem anderen Repo mit der Vorlage `templates/build-check-caller.yml`:

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

Die Jobs im Überblick:

| Job (Name im Check) | Aufgabe | Läuft wenn |
|---|---|---|
| `detect` (`Erkennung`) | sucht die Projekte und baut die Matrix | immer |
| `node` (`node · <dir>`) | Install, Build, Typecheck, Lint, Tests | mindestens ein Node-Projekt erkannt |
| `python` (`python · <dir>`) | Install, Kompilieren, pytest | mindestens ein Python-Projekt erkannt |
| `go` (`go · <dir>`) | build, vet, test | mindestens ein Go-Modul erkannt |
| `docker` (`docker · <dir>`) | `docker buildx build` ohne Push | mindestens ein Dockerfile erkannt |
| `compose` (`compose · <dir>`) | `docker compose config` | mindestens eine Compose-Datei erkannt |

Eigenschaften, die für den Betrieb wichtig sind:

- Jeder Teil läuft als eigener Matrix-Eintrag mit `fail-fast: false`. Ein Fehler in einem Teil verdeckt die
  anderen nicht.
- Alle Jobs laufen auf `ubuntu-latest`. Es gibt keinen macOS- oder Windows-Lauf.
- Der Workflow braucht keine `secrets:`. Die Berechtigung ist `contents: read`, es gibt keinen Login und keinen
  Push. Details in Abschnitt 9.

## 2. Was geprüft wird

### 2.1 Übersicht je Ökosystem

| Ökosystem | Erkannt an (im Verzeichnis) | Prüfschritte (Reihenfolge) | Übersprungen, wenn |
|---|---|---|---|
| Node, npm | `package-lock.json` und `package.json` | Install (`npm ci`), `build`, `typecheck`, `lint`, `test` | Skript fehlt; `test` ist der npm-Platzhalter; `run-tests: false` |
| Node, pnpm | `pnpm-lock.yaml` und `package.json` | Install (`pnpm install --frozen-lockfile`), dieselben Skripte | wie npm |
| Node, Bun | `bun.lock` oder `bun.lockb` und `package.json` | Install (`bun install --frozen-lockfile`), dieselben Skripte | wie npm |
| Node, Yarn | `yarn.lock` und `package.json` | Install (Berry: `yarn install --immutable`, v1: `--frozen-lockfile`), dieselben Skripte | wie npm |
| Python, uv | `uv.lock` | `uv sync --frozen --all-extras`, Kompilieren, pytest | keine `.py`-Dateien; keine Tests |
| Python, pyproject | `pyproject.toml` ohne `uv.lock` | `uv venv`, `uv pip install -e .`, Kompilieren, pytest | wie uv |
| Python, pip | `requirements*.txt` ohne `uv.lock` und `pyproject.toml` | `uv venv`, `uv pip install -r` je Datei, Kompilieren, pytest | wie uv |
| Go | `go.mod` | `go build ./...`, `go vet ./...`, `go test ./...` | `go test`: keine `*_test.go` oder `run-tests: false` |
| Docker | `Dockerfile` (exakter Name) | `docker buildx build --output type=cacheonly` (ohne Push) | nie übersprungen |
| Compose | `docker-compose*.y*ml` oder `compose*.y*ml` | `docker compose -f … config --no-interpolate --quiet` | nie übersprungen |

Hinweise zu den Zeilen:

- **Node:** Die Lockfile bestimmt den Paketmanager. Liegen mehrere Lockfiles im selben Verzeichnis, gilt diese
  Reihenfolge: `pnpm-lock.yaml`, dann `bun.lock`/`bun.lockb`, dann `yarn.lock`, dann `package-lock.json`.
  Ohne `package.json` daneben wird die Lockfile nur mit `::notice::` gemeldet, das Verzeichnis zählt nicht.
  Ein `package.json` ohne Lockfile wird nicht als Node-Projekt erkannt (bewusst, siehe Abschnitt 4).
- **Python:** Pro Verzeichnis entsteht höchstens ein Python-Eintrag. Die Reihenfolge ist `uv.lock`, dann
  `pyproject.toml`, dann `requirements*.txt`.
- **Go:** Die Go-Version kommt aus `go.mod` (`go-version-file`). `go build` und `go vet` laufen immer, nur
  `go test` hängt an `run-tests`.
- **Docker:** Gefunden wird nur die Datei mit exakt dem Namen `Dockerfile`. `Dockerfile.prod` oder
  `app.Dockerfile` werden nicht erkannt. Der Build-Kontext ist in Abschnitt 7 beschrieben.
- **Compose:** Override-Dateien (`*.override.yml` oder `*.override.yaml`) werden zusammen mit der gleichnamigen
  Basisdatei geprüft, als ein Eintrag mit beiden Dateien. Eine Override-Datei ohne Basisdatei ist ein eigener
  Eintrag.

### 2.2 Node-Projekte im Detail

**Node-Version.** Quelle ist die erste vorhandene Datei aus `.nvmrc`, dann `.node-version`, jeweils im
Projektverzeichnis. Gibt es keine, gilt die Eingabe `node-version`. Ist auch die leer, gilt `lts/*`.

**pnpm.** Die pnpm-Version kommt aus dem Feld `packageManager` in `package.json` (Format `pnpm@<version>`).
Fehlt das Feld oder hat es ein anderes Format, bricht der Job mit einem Fehler ab. Der Job nennt die Ursache
(`packageManager` fehlt).

**Bun.** Hat `package.json` ein `packageManager` mit `bun@…`, übernimmt der Job die Version daraus. Sonst wird
`latest` installiert.

**Yarn.** Yarn wird über Corepack aktiviert (`corepack enable`). Ab Version 2 (Berry) läuft `yarn install
--immutable`, sonst `yarn install --frozen-lockfile`.

**Skripte.** Die Schritte Build, Typecheck, Lint und Tests prüfen mit `node -e` ob das Skript in
`package.json` existiert. Ist es da, läuft `<paketmanager> run <skript>`. Sonst steht im Ablauf
„übersprungen (kein Skript)“.

**Typecheck ohne Skript.** Fehlt das Skript `typecheck`, läuft `npx --no-install tsc --noEmit`, wenn eine
`tsconfig.json` existiert und `typescript` im Projekt installiert ist (`node_modules/typescript`). Sonst wird der
Schritt übersprungen. Fehlt `typescript` als Abhängigkeit, passiert also gar nichts.

**Tests.** Der Testschritt läuft nicht, wenn `run-tests` aus ist, kein `test`-Skript existiert, oder das Skript
der npm-Platzhalter ist (`no test specified`). Dann gibt es eine `::notice::` und der Lauf geht weiter. Ist
`pre-test-command` gesetzt, läuft er unmittelbar vor `<paketmanager> run test`, und nur dann (Abschnitt 6).

### 2.3 Python-Projekte im Detail

**Python-Version.** Quelle ist die erste Zeile von `.python-version` (ein Präfix `python-` wird entfernt).
Fehlt die Datei, nimmt der Job die untere Schranke aus `requires-python` in `pyproject.toml`. Ist auch das nicht
brauchbar, gilt `3.12`. Gültig ist nur die Form `x.y` oder `x.y.z`.

**Install.** Siehe Tabelle in 2.1. Der Job nutzt `astral-sh/setup-uv` mit Cache. Auch Projekte mit
`requirements*.txt` installiert der Job mit `uv pip` (nicht mit `pip`).

**Kompilieren.** Alle `*.py`-Dateien unterhalb des Projekts (ohne `.venv`, `venv`, `node_modules`, `vendor`,
`dist`, `build`, `.git`) werden mit `.venv/bin/python -m compileall -q` übersetzt. Ein Syntaxfehler lässt den
Schritt „Quellen kompilieren“ fehlschlagen, auch ohne Tests. Gibt es keine `.py`-Datei, wird der Schritt als
übersprungen ausgewiesen.

**pytest.** Der Schritt läuft nur, wenn `run-tests` an ist und es ein Verzeichnis `tests/` oder eine Datei
`test_*.py` beziehungsweise `*_test.py` gibt. Fehlt pytest im Projekt-venv, installiert der Job es mit
`uv pip install`, ohne Version-Pin. Danach läuft `pre-test-command`, dann `.venv/bin/python -m pytest`.
Ein Exit-Code 5 (pytest hat nichts gesammelt) gilt als übersprungen mit `::notice::`. Jeder andere Fehler lässt
den Check fehlschlagen.

### 2.4 Go-Module im Detail

- `actions/setup-go` nimmt die Version aus `go.mod`. Der Cache ist nur aktiv, wenn `go.sum` existiert, sonst
  bricht `setup-go` ab.
- `go build ./...` und `go vet ./...` laufen immer.
- `go test ./...` läuft nur, wenn `run-tests` an ist und außerhalb von `vendor` mindestens eine `*_test.go`
  liegt.

### 2.5 Docker und Compose im Detail

**Docker.** Jedes erkannte `Dockerfile` wird mit `docker buildx build --output type=cacheonly -f <dir>/Dockerfile
<kontext>` gebaut. Das Ergebnis bleibt im Build-Cache. Es gibt kein Login, kein Push und kein Tagging. Den
Build-Kontext bestimmt Abschnitt 7.

**Compose.** Jede Basisdatei wird einzeln mit `docker compose -f <datei> [-f <override>] config
--no-interpolate --quiet` geprüft. Die Option `--no-interpolate` lässt `${VAR}` unaufgelöst. Fehlende Secrets sind
deshalb kein Fehler. Ein Build oder Start findet nicht statt, die Dockerfiles sind schon im Docker-Job abgedeckt.

### 2.6 Selbsttest der Beispiele

Die Datei `.github/workflows/test-build-check.yml` ruft den Build-Check in einer Matrix gegen die Beispiele unter
`tests/build-check/fixtures/` auf. Der Lauf startet bei PRs und Pushes auf `main`, wenn sich
`build-check.yml`, `test-build-check.yml` oder ein Fixture ändert. Änderungen an `build-check-self.yml` oder
`templates/` lösen ihn nicht aus.

| Fixture | Was es prüft |
|---|---|
| `npm-ts` | npm mit `build`, `typecheck` und `test` (TypeScript über `tsc`) |
| `pnpm` | pnpm mit `packageManager` und `.nvmrc` |
| `bun` | Bun mit `bun.lock` |
| `expo-like` | nur `lint` und `tsconfig.json`, `typescript` als Abhängigkeit |
| `python-uv` | uv mit `uv.lock`, `.python-version` und pytest |
| `python-req` | `requirements.txt` ohne Tests |
| `go` | Go-Modul mit `*_test.go` |
| `docker` | ein einfaches Dockerfile |
| `docker-root` | Dockerfile in `app/`, das `shared/` aus der Wurzel des Beispiels kopiert (Kontext-Erkennung) |
| `compose` | `compose.yaml` mit `${SECRET}` und Override-Datei |
| `node-postgres` | Test, der per `DATABASE_URL` auf Postgres zugreift (mit `postgres: true`) |

Die Negativfälle liegen in `tests/build-check/negative/` und laufen nicht im Selbsttest (Abschnitt 8.1).

## 3. Eingaben

Alle Eingaben sind optional. Ohne Eingaben läuft die Erkennung über das ganze Repo mit allen Ökosystemen.

| Eingabe | Typ | Vorgabe | Wirkung |
|---|---|---|---|
| `working-directory` | string | `.` | Wurzel der Suche, relativ zum Repo. Kein `..`, und der Pfad muss existieren. |
| `ecosystems` | string | leer (= alle) | Kommaseparierte Liste aus `node`, `python`, `go`, `docker`, `compose`. Unbekannte Werte lassen `Erkennung` fehlschlagen. |
| `node-version` | string | leer (= `lts/*`) | Node-Version, wenn das Projekt weder `.nvmrc` noch `.node-version` hat. Beispiel: `"22"`. |
| `exclude-paths` | string | leer | Kommaseparierte Pfade relativ zu `working-directory`. Ein Pfad schließt sich selbst und alles darunter aus. |
| `run-tests` | boolean | `true` | Schaltet alle Testschritte ab (Node, pytest, `go test`). Build, Lint, Typecheck und `go vet` laufen weiter. |
| `postgres` | boolean | `false` | Startet eine Wegwerf-Postgres für Node- und Python-Jobs (Abschnitt 6). |
| `postgres-version` | string | `"17"` | Image-Tag, also `postgres:<version>`. |
| `postgres-port` | number | `5432` | Port der Wegwerf-Postgres auf `localhost`. |
| `pre-test-command` | string | leer | Shell-Befehl im Projektverzeichnis, vor den Tests (Abschnitt 6). |
| `docker-context` | string | `auto` | Build-Kontext der Dockerfiles: `auto`, `dockerfile` oder `repository` (Abschnitt 7). |

Beispiel mit mehreren Eingaben (Monorepo, Tests und Docker-Kontext):

```yaml
jobs:
  build-check:
    uses: Krinke-IT-Consulting/renovate/.github/workflows/build-check.yml@v1
    with:
      working-directory: .
      exclude-paths: tests/fixtures,docs/beispiele
      ecosystems: node,docker
      docker-context: repository
```

Die Eingaben landen ausschließlich über `env:` in den Schritten. Sie stehen nie direkt in `run:`
(Schutz vor Script-Injection, siehe Abschnitt 9).

## 4. Erkennung und Ausschlüsse

Der Job `detect` (Name `Erkennung`) durchsucht `working-directory`:

- **Tiefe:** bis zu drei Verzeichnisebenen unter `working-directory` (`find -maxdepth 4` auf Dateiebene).
- **Ausgeschlossene Verzeichnisse:** Auf jeder Ebene werden `node_modules`, `.venv`, `venv`, `vendor`, `dist`,
  `build` und `.git` nicht durchsucht, egal wo sie stehen.
- **Ausgeschlossene Pfade:** `exclude-paths` wirkt relativ zu `working-directory`. Ein Verzeichnis fällt weg, wenn
  sein Pfad gleich dem Eintrag ist oder mit `<eintrag>/` beginnt. Der Eintrag `tests/build-check` schließt also
  `tests/build-check/fixtures/npm-ts` aus, nicht aber `tests/build-check-neu`.
- **Eintrag je Verzeichnis:** Jedes Verzeichnis mit einem Erkennungsmerkmal bekommt einen Eintrag je Ökosystem.
  Ein Monorepo mit `web/package-lock.json`, `server/uv.lock` und `device/go.mod` ergibt drei Matrix-Einträge.
- **Matrix-Namen:** `<ökosystem> · <verzeichnis>`, das Verzeichnis ist der Pfad ab Repo-Wurzel (etwa
  `node · apps/api`).
- **Zusammenfassung:** Der Job schreibt in `$GITHUB_STEP_SUMMARY` einen Abschnitt „Erkannte Teile“ mit
  Suchwurzel, aktiven Ökosystemen, Ausschlüssen und einer Tabelle aller Treffer (Ökosystem, Verzeichnis,
  Paketmanager oder Dateien). Dort sieht man, was nicht erkannt wurde.

Bekannte Grenzen der Erkennung:

- Ein `package.json` ohne Lockfile ist kein Node-Projekt. Ein Repo, das nur so aufgebaut ist, schlägt bei
  „nichts erkannt“ fehl (Abschnitt 5). Liegen andere Teile daneben, fehlt das Node-Projekt still. Die
  Zusammenfassung ist das Gegenmittel.
- Projekte tiefer als drei Ebenen unter `working-directory` werden nicht gefunden.

## 5. Verhalten bei „nichts erkannt“

Findet die Erkennung kein prüfbares Projekt, schlägt `Erkennung` fehl. Die Meldung lautet sinngemäß „Nichts
Prüfbares gefunden“. Der Grund steht in der Fehlermeldung selbst und in `specs/build-check/spec.md`: Ein grüner
Check ohne Inhalt würde Automerge freigeben. Das gilt auch dann, wenn alle Treffer durch `ecosystems` oder
`exclude-paths` herausfallen. Der Job `detect` bricht vor allen Matrix-Jobs ab, also laufen dann keine anderen
Jobs.

Typische Auslöser:

- Ein Repo mit nur PowerShell-Skripten (PowerShell ist laut `proposal.md` ausgeschlossen).
- Ein Verzeichnis ohne Projektdateien, etwa mit nur einer `hello.ps1`. Dieser Fall steht als Negativbeispiel in
  `tests/build-check/negative/empty-project/`.
- Ein `package.json` ohne Lockfile, wenn sonst nichts im Repo liegt.

## 6. Wegwerf-Postgres und `pre-test-command`

### 6.1 Postgres

Mit `postgres: true` startet der Workflow in den Jobs `node` und `python` einen Service `postgres` mit dem Image
`postgres:<postgres-version>` (Standard `17`). Der Port wird auf `localhost:<postgres-port>` abgebildet.
Der Healthcheck ist `pg_isready -U postgres -d test`. Ohne `postgres: true` ist das Image leer, und GitHub
überspringt den Service.

Festgelegte Testwerte (Wegwerf-Container, lebt nur für den Lauf, kein Geheimnis):

| Variable | Wert |
|---|---|
| Benutzer / Passwort | `postgres` / `postgres` |
| Datenbank | `test` |
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:<postgres-port>/test` |
| `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` | `localhost`, `<postgres-port>`, `postgres`, `postgres`, `test` |

Die Variablen landen über `GITHUB_ENV` im Lauf. Sie gelten für alle Node- und Python-Projekte des Aufrufs, nicht
nur für einzelne Verzeichnisse. Die Datenbank ist leer. Migrationen oder Seed-Daten gehören in `pre-test-command`.

Der Service-Container ist per Tag gepinnt (`postgres:17`), nicht per Digest. Das ist ein Unterschied zu den
Actions (Abschnitt 9).

### 6.2 `pre-test-command`

- Läuft im Projektverzeichnis mit `bash -euo pipefail -c "<befehl>"`.
- Läuft erst nach der Installation und unmittelbar vor den Tests. Bei Node nur, wenn der Testschritt läuft. Bei
  Python nur, wenn pytest läuft (also Tests vorhanden sind).
- Ein Fehlschlag lässt den Check fehlschlagen.
- Die Eingabe steht als Umgebungsvariable `PRE_TEST_COMMAND` im Schritt. Sie wird nicht direkt in `run:`
  eingesetzt.

Beispiel aus dem Pilot in `Hiwamashi/smoking-tracker` (Monorepo mit npm-Workspaces, Prisma, Postgres auf
Port 5433). Die Rolle und die Datenbank sind Wegwerf-Testwerte:

```yaml
    with:
      postgres: true
      postgres-port: 5433
      pre-test-command: >-
        psql -v ON_ERROR_STOP=1 "postgresql://postgres:postgres@localhost:5433/test"
        -c "CREATE ROLE smoking LOGIN PASSWORD 'smoking' CREATEDB"
        -c "CREATE DATABASE smoking_tracker_test OWNER smoking"
        && DATABASE_URL='postgresql://smoking:smoking@localhost:5433/smoking_tracker_test?schema=public'
        npm run db:deploy --workspace=apps/api
```

## 7. Build-Kontext der Dockerfiles

### 7.1 Wozu

Ein Dockerfile in einem Monorepo kopiert oft Quellen aus der Repo-Wurzel (`COPY apps/api …`,
`COPY packages/shared …`). Mit dem eigenen Verzeichnis als Kontext scheitert dann der Build. Coolify baut solche
Dockerfiles mit der Repo-Wurzel als Kontext, deshalb orientiert sich der Build-Check daran (Entscheidung nach dem
Pilot, `design.md`, Entscheidung 5).

### 7.2 Algorithmus bei `docker-context: auto` (Vorgabe)

1. Das Dockerfile wird zeilenweise gelesen. Kommentarzeilen (beginnend mit `#`) fallen weg. Zeilen mit Fortsetzung
   `\` werden zusammengeführt.
2. Jede Zeile, deren erstes Wort `COPY` oder `ADD` ist (ohne Groß-/Kleinschreibungsunterschied), liefert ihre
   Quellen. Alle Wörter außer dem letzten sind Quellen, das letzte ist das Ziel.
3. Ausgeschlossen werden:
   - Anweisungen mit `--from=` (Quellen aus anderen Build-Stufen),
   - Heredocs (`<<` in der Anweisung),
   - Quellen mit `$` (Variablen) oder `://` (URLs),
   - Flags (`--chmod=…` und andere `--…`) als Wörter.
4. Führendes `/` und `./` werden von den Quellen entfernt.
5. Wildcard-Quellen (`*` oder `?`) werden bei der Existenzprüfung übersprungen. Sie zählen also nicht als
   fehlend. Steht nur eine Wildcard-Quelle da, ist bereits das eigene Verzeichnis der erste Treffer.
6. Vom Verzeichnis des Dockerfiles aus wird aufwärts bis zur Repo-Wurzel geprüft. Der Kontext ist das erste
   Verzeichnis, in dem alle (nicht als Wildcard geltenden) Quellen existieren.
7. Keine Quellen, oder kein Treffer bis zur Wurzel: das eigene Verzeichnis. Der Build scheitert dann mit der
   Meldung von Docker selbst.

Die Zusammenfassung zeigt den gewählten Kontext und den Grund, zum Beispiel „COPY/ADD-Quellen dort gefunden“ oder
„keine COPY/ADD-Quellen, eigenes Verzeichnis“.

### 7.3 Werte der Eingabe `docker-context`

| Wert | Kontext |
|---|---|
| `auto` | Algorithmus aus 7.2 |
| `dockerfile` | immer das Verzeichnis des Dockerfiles |
| `repository` | immer die Repo-Wurzel (Arbeitsverzeichnis des Checkouts, nicht `working-directory`) |

Die Eingabe gilt für alle Dockerfiles des Aufrufs. Ein unbekannter Wert bricht den Docker-Job mit einer Meldung ab.
Der Job prüft ihn nur, wenn es überhaupt Dockerfiles gibt.

### 7.4 Grenzen

- **Die Wurzel ist gemeint, aber die Quellen liegen im eigenen Verzeichnis.** Beispiel: `COPY . .` in
  `apps/api/Dockerfile`. Das `.` existiert dort, `auto` nimmt also `apps/api` als Kontext. Dann
  `docker-context: repository` setzen.
- **Pfade mit Leerzeichen in Shell-Form** werden an den Leerzeichen zerlegt. Die Teile gelten als eigene Quellen,
  die meist nicht existieren. Bei solchen Pfaden die JSON-Form verwenden oder `docker-context` setzen.
- **Quellen über Variablen, URLs und `--from`** zählen nicht. Hängt ein Dockerfile nur daran, ist das eigene
  Verzeichnis der Kontext.
- **Heredocs** (`COPY <<EOF …`) zählen nicht.

## 8. Ergebnisse der Prüfungen

### 8.1 Negativfälle (Task 4.3)

Die Negativbeispiele in `tests/build-check/negative/` sind absichtlich kaputt. Sie laufen nicht im Selbsttest, denn
ein Workflow kann den erwarteten Fehlschlag eines Reusable-Workflow-Aufrufs nicht als Erfolg werten. Sie wurden
einmalig auf einem eigenen Branch mit `working-directory: tests/build-check/negative/<ordner>` geprüft (Task 4.3).

| Ordner | Erwarteter Fehlschlag | Ergebnis |
|---|---|---|
| `empty-project` | Job `Erkennung`: „Nichts Prüfbares gefunden“ | fehlgeschlagen in „Erkennung“ |
| `lockfile-mismatch` | Job `node`, Schritt „Install (eingefrorene Lockfile)“: `npm ci` | fehlgeschlagen in „Install (eingefrorene Lockfile)“ |
| `red-test` | Job `node`, Schritt „Tests“ | fehlgeschlagen in „Tests“ |
| `python-syntax` | Job `python`, Schritt „Quellen kompilieren“: `broken.py` | fehlgeschlagen in „Quellen kompilieren“ |

### 8.2 Pilot in `Hiwamashi/smoking-tracker` (Task 5.3)

Das Repo ist ein Monorepo mit npm-Workspaces, Prisma und Postgres auf Port 5433. Der Pilot brachte vier Befunde:

1. **Docker-Builds in `apps/api` und `apps/web` scheiterten mit v1.0.0.** Die Dockerfiles brauchen die Repo-Wurzel
   als Kontext. Abhilfe: Kontext-Erkennung in `v1.1.0` (Abschnitt 7).
2. **Der Job `node · .` scheiterte, weil der Prisma-Client in einem frischen Checkout nicht erzeugt wurde.** Das ist
   ein Mangel im Repo, nicht im Build-Check. Im Repo wurde `"prebuild": "prisma generate"` in
   `apps/api/package.json` ergänzt.
3. **Der Aufruf braucht Postgres und einen `pre-test-command`** für Migrationen (Abschnitt 6.2).
4. **npm 11 warnt bei sieben Abhängigkeiten mit Install-Skripten ohne Freigabe.** Genannt wurden unter anderem
   `@prisma/engines`, `argon2` und `esbuild`. Das ist nur eine Warnung, der Build ging durch. Zur Zukunft
   von npm 12 siehe Abschnitt 11.

Endergebnis: Der Lauf
https://github.com/Hiwamashi/smoking-tracker/actions/runs/38568278409 ist vollständig grün (Erkennung, `node`,
`docker` für `apps/api`, `docker` für `apps/web`, `compose`).

## 9. Sicherheit

- **Keine Secrets.** Der Workflow verlangt keine `secrets:`. Im Lauf liegen nur die Wegwerf-Testwerte aus
  Abschnitt 6.1.
- **Rechte.** Auf Workflow-Ebene steht `permissions: contents: read`. Es gibt keinen Login, keinen Push, keine
  Kommentare und kein Anlegen von Commits oder Releases.
- **Checkout ohne Credentials.** Alle sechs `actions/checkout`-Schritte setzen `persist-credentials: false`.
- **Eingaben nur über `env:`.** Die Werte aus `inputs.*` und `matrix.*` gehen als Umgebungsvariablen in die
  Schritte. In keinem `run:`-Block steht ein `${{ … }}`. Das verhindert Script-Injection.
- **Fork-PRs.** Ein PR aus einem Fork erhält keine Secrets und keine Schreibrechte (Spec, Abschnitt „Keine
  Secrets, minimale Rechte“).
- **Digests.** Alle Actions sind per Commit-Digest gepinnt, mit Versionskommentar (Liste unten). Renovate hält
  sie aktuell (`design.md`, Entscheidung 7).
- **Vertrauen in Eingaben.** `pre-test-command` und andere Eingaben kommen aus dem aufrufenden Repo. Dessen Code
  ist ohnehin Teil des Laufs, daher gilt dieselbe Vertrauensstufe.

Verwendete Actions (aus `.github/workflows/build-check.yml`):

| Action | Version | Commit-Digest | Verwendet in |
|---|---|---|---|
| `actions/checkout` | v7.0.1 | `3d3c42e5aac5ba805825da76410c181273ba90b1` | alle Jobs |
| `pnpm/action-setup` | v6.1.0 | `ea17c68df8912ef543352723c149a84f56e3d413` | `node` (pnpm) |
| `oven-sh/setup-bun` | v2.2.0 | `0c5077e51419868618aeaa5fe8019c62421857d6` | `node` (Bun) |
| `actions/setup-node` | v7.1.0 | `949feb2413d6458794dcd2491c4babbbce0c15c1` | `node` |
| `astral-sh/setup-uv` | v10.3.0 | `1c37ad07a6a961277cf70c0d37d6f313000f5884` | `python` |
| `actions/setup-go` | v7.0.0 | `b7ad1dad31e06c5925ef5d2fc7ad053ef454303e` | `go` |
| `docker/setup-buildx-action` | v4.4.1 | `f87e5991a6d7451dcb8d9637bfbc97413f497069` | `docker` |

Die Liste in `tasks.md` (Task 1.1) nennt außerdem `actions/setup-python`. Der Workflow nutzt es nicht, Python
läuft über uv. Die Aufrufe `./.github/workflows/build-check.yml` im Selbsttest und in `build-check-self.yml` sind
lokale Reusable Workflows und haben keinen Digest. Die Vorlage nutzt `@v1`, das Renovate auf einen Digest pinnt
(`design.md`, Entscheidung 9).

## 10. Versionierung und Release-Ablauf

### 10.1 Tags

- Veröffentlicht wird über Tags `v1.x.y` und einen mitwandernden Tag `v1`. Aufrufer verwenden `@v1`.
- Kompatible Änderungen bekommen eine neue Minor- oder Patch-Version, `v1` wandert mit.
- Inkompatible Änderungen bekommen einen neuen Major-Tag (`v2`), `v1` bleibt stehen (Spec, „Aufruf-Vorlage und
  Versionierung“).

Aktueller Stand:

| Tag | Commit | Inhalt |
|---|---|---|
| `v1.0.0` | `74bdcb5` | Erstveröffentlichung (Merge von PR #2) |
| `v1.1.0` | `3b4129e` | Kontext-Erkennung für Dockerfiles (Merge von PR #3) |
| `v1` | `3b4129e` | zeigt auf `v1.1.0` |

### 10.2 Ablauf bei Änderungen

1. PR mit der Änderung. Der Selbsttest (`test-build-check.yml`) und `build-check-self` müssen grün sein.
2. Merge durch den Betreiber. Den Merge-Commit ermitteln.
3. Version taggen, mit Annotation:
   ```
   git tag -a v1.x.y <merge-commit>
   ```
4. `v1` auf denselben Commit setzen. Das geschieht nur nach Freigabe des Betreibers, denn es wirkt auf alle
   Repos:
   ```
   git tag -fa v1 <merge-commit>
   ```
5. Beide Tags pushen:
   ```
   git push origin v1.x.y
   git push -f origin refs/tags/v1
   ```
6. Kontrolle: `git ls-remote --tags origin` zeigt `v1` und `v1.x.y` auf demselben Commit.

Ein verschobenes `v1` erscheint bei den aufrufenden Repos als Digest-Update in der Patch-Gruppe des Renovate-Presets.
Dort kann der neue Stand automatisch gemergt werden, sobald der Check grün ist.

### 10.3 Rückweg

- `v1` auf den vorherigen Commit zurücksetzen (`git tag -fa v1 <vorheriger-commit>`, dann
  `git push -f origin refs/tags/v1`). Das braucht ebenfalls die Freigabe des Betreibers.
- In einzelnen Repos die Aufruf-Datei entfernen.

## 11. Grenzen und offene Punkte

- **Keine vollständige CI.** Repos mit eigener, vollständiger CI bekommen keinen Build-Check (Entscheidung 4a aus
  der Vorbereitung). Deren CI zählt als Check.
- **Expo und React Native.** Es gibt kein Expo-spezifisches Verhalten im Workflow. Ein Expo-Repo läuft über den
  generischen Node-Ablauf auf `ubuntu-latest` (Lint, Typecheck über `tsc --noEmit`, Build- und Test-Skripte, falls
  vorhanden). Native Builds finden nicht statt, sie bleiben bei EAS.
- **Nicht geprüft:** PowerShell (laut `proposal.md` ausgeschlossen), macOS- und iOS-Builds.
- **Kosten.** Der Workflow ist öffentlich und läuft in privaten Repos mit deren Actions-Minuten. Im kostenlosen Plan
  sind das laut `proposal.md` 2.000 Minuten pro Monat je Organisation beziehungsweise Konto.
- **Caching.** Außer dem Cache der `setup-*`-Actions gibt es keinen Cache über Läufe hinaus.
- **Kein Deploy, Release oder Coverage.** Der Workflow veröffentlicht nichts.
- **Keine Rollout-Automatik.** Das Verteilen der Aufruf-Datei auf weitere Repos übernimmt das Dashboard (über
  Onboarding-PRs). Der Build-Check selbst tut das nicht.
- **Ein Postgres-Setting pro Aufruf.** Alle Node- und Python-Projekte eines Aufrufs bekommen dieselbe Datenbank
  und dieselben Variablen. Für Monorepos mit gemischtem Bedarf reicht das, weil die Datenbank nicht stört.
- **Standard-Branch fest `main`.** Die Vorlage trägt `main` ein. Repos mit anderem Standard-Branch brauchen eine
  Anpassung (`design.md`, Trade-off).
- **Install-Skripte unter npm 12.** npm 12 blockiert Install-Skripte von Abhängigkeiten, die nicht im Feld
  `allowScripts` der `package.json` freigegeben sind (Standard: nur Warnung, mit `strict-allow-scripts` Fehler).
  Freigeben mit `npm install-scripts approve <paket>`, prüfen mit `npm install-scripts ls`. Der Build-Check
  übernimmt das Verhalten der npm-Version und umgeht es nicht.
  - **Wann es greift:** Der Build-Check nutzt immer das npm, das mit der Node-Version kommt; ein Feld
    `packageManager: "npm@…"` wertet er nicht aus. Stand 2026-10-23 liefert keine Node-Version npm 12 mit
    (Node 24.22: npm 11.19, Node 26.12: npm 11.20). Renovate betrifft es nicht, es schreibt Lockfiles mit
    `--ignore-scripts`.
  - **Wen es trifft:** Im Dashboard blockiert npm 12.2.1 fünf Skripte (`esbuild` dreifach, `fsevents`,
    `unrs-resolver`), alles läuft trotzdem, weil die Binärdateien über optionale Abhängigkeiten kommen.
    Kritisch sind native Module, die ihr Skript zum Bauen oder Herunterladen brauchen, etwa `argon2` und
    `@prisma/engines` in smoking-tracker (Abschnitt 6.2), außerdem `sharp`, `better-sqlite3`, `bcrypt` oder
    ein Husky-`prepare`.
  - **Entscheidung (2026-10-23):** Geparkt. Ein Change („Dashboard legt `allowScripts` beim Onboarding an,
    Bestandsrepos mit `npm install-scripts ls` prüfen“) startet, sobald eine Node-Version npm 12 mitliefert
    oder ein Repo npm 12 bewusst einsetzt. Zusammenhang mit dem npm-Constraint im Preset:
    `renovate-konfiguration.md`, Abschnitt 9.
- **Lint als Automerge-Bremse.** Ein Lint-Fehler nach einem Plugin-Update bricht Automerge. Das ist gewollt. Eine
  Eingabe zum Abschalten von Lint gibt es nicht. `design.md` nennt ein späteres `run-lint`-Flag, es ist nicht Teil
  dieses Changes.
- **Smoking-Tracker-Zugangsdaten.** Der Pilot nutzt eigene Rolle und Datenbank über `pre-test-command` (Abschnitt
  6.2). Im Pilot-Befund sind keine weiteren Umgebungsvariablen genannt.
