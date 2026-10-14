# Proposal

## Why

Das Preset mergt Patch-Updates nur automatisch, wenn alle Status-Checks eines PRs grün sind. Ohne
Checks bleibt jeder PR offen. Von den betrachteten Repos führt heute nur eines bei jedem PR einen
Build mit Tests aus. Ein zentraler Build-Check soll das ändern: Er macht Automerge möglich und
zeigt Brüche durch Updates, bevor Coolify neu baut. Ohne ihn bleibt die Renovate-Plattform eine
reine PR-Quelle.

## What Changes

- **Reusable Workflow `.github/workflows/build-check.yml`** (`on: workflow_call`) in diesem
  öffentlichen Repo:
  - erkennt Ökosysteme je Verzeichnis selbst (auch Monorepos mit mehreren Teilprojekten)
    - Node mit npm, pnpm, Bun oder Yarn
    - Python mit uv oder pip
    - Go
    - Dockerfiles
    - Compose-Dateien
  - führt je Fund Install, Build, Typecheck, Lint und Tests aus, sofern das Projekt sie hat
  - baut Dockerfiles ohne Push, prüft Compose-Dateien mit `docker compose config` (Antwort 2a)
  - startet auf Wunsch eine Wegwerf-Postgres und einen Befehl vor den Tests, etwa für
    Prisma-Migrationen (Antwort 1a)
  - Tests lassen sich abschalten. Expo- und React-Native-Repos werden nur unter Linux geprüft, mit
    Lint und `tsc --noEmit`, native Builds bleiben bei EAS (Antwort 3a).
  - schlägt fehl, wenn er nichts Prüfbares findet: Ein grüner Check ohne Inhalt würde Automerge
    freischalten.
- **Aufruf-Vorlage `templates/build-check-caller.yml`**:
  - etwa zehn Zeilen, ruft den Workflow über `@v1` auf
  - Das Dashboard verteilt sie später per Onboarding-PR. Renovate pinnt die Referenz auf einen
    Digest und hält sie aktuell.
- **Versionierung:** Tags `v1.x.y` und ein mitwandernder Tag `v1`. Ablauf dokumentiert.
- **Selbsttest in diesem Repo:**
  - Beispielprojekte je Ökosystem unter `tests/build-check/fixtures/`
  - Workflow `test-build-check.yml`, der den Build-Check bei Änderungen gegen alle Beispiele laufen
    lässt
- **Build-Check für dieses Repo selbst**: Die Dockerfiles des Stacks werden bei jedem PR gebaut,
  auch Renovate-PRs zu Basis-Images.
- **Pilot:** Rollout der Aufruf-Datei per PR in `Hiwamashi/smoking-tracker`. Das Repo braucht
  npm-Workspaces, Postgres auf Port 5433 und Prisma.
- **Repos mit eigener, vollständiger CI** (etwa `proton-mail-mcp-server-ultra`) bekommen keinen
  Build-Check (Antwort 4a). Ihre CI zählt als Check.
- Dokumentation in `feature-documentation/build-check.md`, Eintrag in `PROGRESS.md`.

Nicht Teil dieses Changes:
- automatischer Rollout auf alle Repos (macht das Dashboard)
- PowerShell-Prüfung (laut PRD ausgeschlossen)
- macOS- und iOS-Builds

## Capabilities

### New Capabilities

- `build-check`:
  - Verhalten des zentralen Build-Checks: Erkennung, Prüfschritte je Ökosystem, Optionen,
    Sicherheitsgrenzen und Fehlerverhalten
  - Aufruf-Vorlage und Versionierung

### Modified Capabilities

(keine)

## Impact

- **Neue Dateien:**
  - `.github/workflows/build-check.yml`
  - `.github/workflows/test-build-check.yml`
  - `.github/workflows/build-check-self.yml`, der Aufruf für dieses Repo
  - `templates/build-check-caller.yml`
  - `tests/build-check/fixtures/**`
  - `feature-documentation/build-check.md`
- **Öffentlichkeit:** Der Workflow ist öffentlich und läuft in privaten Repos mit deren
  Actions-Minuten. Im kostenlosen Plan sind das 2.000 Minuten pro Monat je Organisation bzw.
  Konto. Er bekommt keine Secrets und nur Leserechte.
- **Wirkung auf Automerge:** Ab dem Rollout in einem Repo mergt Renovate dort Patch-Gruppen
  automatisch, sobald der Build-Check grün ist.
- **Externe Schritte:**
  - Git-Tags `v1.0.0` und `v1` in diesem Repo
  - ein PR in `Hiwamashi/smoking-tracker`, nur nach Freigabe
