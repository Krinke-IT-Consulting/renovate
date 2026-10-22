# Proposal

## Why

Das Dashboard zeigt jeden Renovate-PR mit CI-Status. Zum Mergen muss der Betreiber aber jeden PR auf
GitHub öffnen. Bei Sicherheitsupdates und nach längeren Pausen sind das viele einzelne Wege für eine
Entscheidung, die im Dashboard schon feststeht. Der Betreiber hat entschieden, dass grüne PRs direkt
in der Oberfläche gemergt werden können, einzeln und als Sammel-Merge für Patch- und Minor-Updates.

## What Changes

- **Einzel-Merge:**
  - Knopf „Mergen“ je offenem Renovate-PR mit grüner CI, an drei Stellen: in der PR-Liste, im
    Repo-Detail und im Lagebericht.
  - Im Lagebericht ersetzt er bei grüner CI die Aktion „Auf GitHub mergen“ (Sicherheitsupdates) und
    „Freigeben“ (Major-Updates). Ohne grüne CI bleibt der Link zum PR.
- **Sammel-Merge:**
  - Knopf „Alle grünen Patch- und Minor-PRs mergen“ auf der Seite Pull Requests.
  - Er erfasst nur offene PRs mit Update-Typ `patch` oder `minor` und grüner CI.
  - Sicherheits-, Major-, Digest- und Lockfile-PRs bleiben ausgenommen.
- **Merge-Methode wie im Repo erlaubt (Entscheidung 1a):**
  - Reihenfolge: Squash, sonst Merge-Commit, sonst Rebase.
  - Der Bestätigungsdialog nennt die Methode.
- **Strenge Live-Prüfung unmittelbar vor jedem Merge (Entscheidung 2a):**
  - Der PR ist noch offen.
  - Der Head-Commit ist derselbe wie beim Klick.
  - Die CI ist grün.
  - Der PR ist konfliktfrei.
  - Branch-Schutzregeln setzt die Plattform selbst durch.
  - Weicht etwas ab, wird nicht gemergt, und die Meldung nennt den Grund.
- **Wie alle Aktionen:** Bestätigungsdialog, AuditLog-Eintrag, Meldung mit Link oder Fehler.
- **Datenstand:** Nach einem Merge zeigt das Dashboard den PR sofort als gemergt und wartet dafür
  nicht auf den nächsten Abgleich. Der Abgleich hält die erlaubten Merge-Methoden je Repo aktuell.

## Capabilities

### New Capabilities

Keine.

### Modified Capabilities

- `dashboard-actions`: neue Requirements für Einzel- und Sammel-Merge, Live-Prüfung und
  Merge-Methode
- `dashboard-views`: Die Hauptaktion eines Schritts im Lagebericht und die PR-Liste bieten bei grüner
  CI das Mergen im Dashboard an.

## Impact

- **Code (`dashboard/`):**
  - `PlatformAdapter` bekommt zwei Methoden: Merge-Voraussetzungen lesen und mergen. Umgesetzt wird
    das im `GitHubAdapter`.
  - Neue Server Actions mit Logik in `src/actions/core/`.
  - Komponenten: Merge-Knopf, Sammel-Merge, Lagebericht-Aktion `merge`.
  - `src/domain/report.ts`.
- **Datenmodell:**
  - Neue Spalte `repositories.merge_methods` (erlaubte Methoden), gefüllt im GitHub-Abgleich.
  - Eine Migration.
- **GitHub App:** Keine neuen Rechte. Mergen braucht Contents und Pull requests mit Schreibrecht.
  PRs, die Workflow-Dateien ändern (Updates von GitHub Actions), brauchen zusätzlich Workflows mit
  Schreibrecht. Alle drei Rechte sind seit Phase 7 vorhanden.
- **Kontingent:**
  - Einzel-Merge: 3 bis 4 zusätzliche API-Aufrufe (PR, CI-Status, Repo-Einstellungen, Merge).
  - Sammel-Merge: das Gleiche je PR, begrenzt auf 20 PRs pro Auslösung.
- **Doku:** `feature-documentation/dashboard/aktionen.md` und eine neue Datei
  `feature-documentation/dashboard/merge.md`.
- **Externe Schritte nur nach Freigabe:** Deployment. Echte Merges löst nur der Betreiber selbst aus.
