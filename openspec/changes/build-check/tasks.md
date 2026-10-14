# Tasks

## 1. Vorbereitung

- [x] 1.1 Aktuelle Versionen und Commit-Digests für diese Actions ermitteln:
  `actions/checkout`, `actions/setup-node`, `pnpm/action-setup`, `oven-sh/setup-bun`,
  `astral-sh/setup-uv`, `actions/setup-python`, `actions/setup-go`,
  `docker/setup-buildx-action`.
  Fertig, wenn `git ls-remote` je Tag einen Commit liefert. Liste in der Feature-Doku.

## 2. Beispielprojekte

- [x] 2.1 Unter `tests/build-check/fixtures/` die Beispiele aus design.md Entscheidung 10 anlegen.
  Für `npm-ts`, `pnpm`, `bun` und `expo-like` jeweils mit committeter Lockfile, für `python-uv`
  mit `uv.lock`.
  - Prüfen: Lokal läuft je Beispiel der jeweilige Ablauf grün (Install mit eingefrorener
    Lockfile, Skripte, Tests).
  - Werkzeuge per Docker oder `npx`, keine globalen Installationen.
- [x] 2.2 Je ein Negativbeispiel auf einem Test-Branch vorbereiten, nicht in `main`:
  - Lockfile passt nicht
  - roter Test
  - Python-Syntaxfehler
  - Verzeichnis ohne Projekt

  Wird erst in 4.3 genutzt.

## 3. Build-Check-Workflow

- [x] 3.1 `.github/workflows/build-check.yml` mit den Eingaben aus der Spec und dem Job `detect`
  anlegen (design.md Entscheidung 1). Prüfen:
  - `actionlint` per Docker ohne Befund.
  - Das Erkennungsskript liefert lokal für dieses Repo und die Beispiele die erwartete JSON-Liste
    (als Bash-Skript im Scratchpad ausgeführt).
  - `exclude-paths` wirkt.
- [x] 3.2 Job `node` laut Entscheidung 2 ergänzen:
  - Paketmanager und Node-Version
  - Skripte nur, wenn vorhanden
  - Ersatz-`tsc`
  - Platzhalter-Test
  - Postgres-Service und `pre-test-command` (Entscheidung 6)
  - Eingaben als `env`, nie direkt in `run:` interpoliert

  `actionlint` ohne Befund.
- [x] 3.3 Jobs `python` und `go` laut Entscheidungen 3 und 4 ergänzen. `actionlint` ohne Befund.
- [x] 3.4 Jobs `docker` und `compose` laut Entscheidung 5 ergänzen (kein Login, kein Push).
  `actionlint` ohne Befund.
- [ ] 3.5 Zusammenfassung des Laufs (`$GITHUB_STEP_SUMMARY`) mit der Liste der erkannten Teile und
  übersprungener Schritte. Fertig, wenn sie im Selbsttest-Lauf aus 4.2 sichtbar ist.
- [x] 3.6 Nach dem Pilot: Kontext-Erkennung für Dockerfiles und Eingabe `docker-context` laut
  Entscheidung 5, Beispiel `docker-root` in der Selbsttest-Matrix. Prüfen: `actionlint` ohne Befund;
  das Skript wählt lokal für smoking-tracker die Wurzel und für dieses Repo und `docker` das eigene
  Verzeichnis.

## 4. Selbsttest

- [x] 4.1 `.github/workflows/test-build-check.yml` (Matrix über die Beispiele) und
  `.github/workflows/build-check-self.yml` (dieses Repo, Beispiele ausgeschlossen) anlegen.
  `actionlint` ohne Befund.
- [x] 4.2 Auf einem Branch pushen und einen PR öffnen. Fertig, wenn:
  - alle Matrix-Teile des Selbsttests grün sind
  - `build-check-self` die vier Dockerfiles und die Compose-Datei dieses Repos geprüft hat

  Der PR dient zugleich als Review-Ort.
- [x] 4.3 Die Negativbeispiele aus 2.2 auf einem eigenen Branch laufen lassen. Jeder schlägt am
  erwarteten Schritt mit verständlicher Meldung fehl. Ergebnis in der Feature-Doku; Branch danach
  löschen.

## 5. Vorlage, Version und Pilot

- [x] 5.1 `templates/build-check-caller.yml` laut Entscheidung 8 anlegen. `actionlint` ohne
  Befund. Renovate-Validator für die Repo-Konfiguration weiterhin grün.
- [x] 5.2 Nach dem Merge und der Freigabe des Betreibers die Tags `v1.0.0` und `v1` setzen und
  pushen. `git ls-remote --tags` zeigt beide auf demselben Commit.
- [x] 5.3 Pilot nach Freigabe: Branch und PR in `Hiwamashi/smoking-tracker` mit der Aufruf-Datei,
  angepasst um `postgres: true`, `postgres-port: 5433` und
  `pre-test-command: npx prisma migrate deploy` (oder was das Repo braucht). Fertig, wenn der
  Build-Check im PR grün ist. Abweichungen (Zugangsdaten, weitere Variablen) gehen in die
  Feature-Doku. Den PR merged der Betreiber.

- [x] 5.4 Kontext-Erkennung per PR in `main`, Merge durch den Betreiber. Danach Tag `v1.1.0` setzen
  und `v1` auf denselben Commit verschieben. `git ls-remote --tags` zeigt `v1` und `v1.1.0` auf
  demselben Commit.

## 6. Dokumentation

- [x] 6.1 `feature-documentation/build-check.md` schreiben. Inhalt:
  - was geprüft wird, je Ökosystem als Tabelle
  - Eingaben mit Beispielen
  - Erkennung und Ausschlüsse
  - Verhalten bei „nichts erkannt“
  - Postgres-Option
  - Versionierung und Release-Ablauf
  - Ergebnisse aus 4.3 und 5.3
  - Liste aus 1.1
- [x] 6.2 `PROGRESS.md` aktualisieren. `openspec validate build-check --strict` grün.
