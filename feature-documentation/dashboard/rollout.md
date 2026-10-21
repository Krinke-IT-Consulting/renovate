# Rollout-Logik (Onboarding, Build-Check, automatisches Onboarding)

Stand: Phase 7, Tasks 7.3 bis 7.5 (nur Server-Logik; Oberfläche und Server Actions folgen getrennt).
Vertrag zur Oberfläche: `dashboard/src/rollout/types.ts` (`RolloutService.run`, `RolloutOutcome`).

## Bausteine

| Datei | Aufgabe |
|---|---|
| `src/rollout/service.ts` | `createRolloutService({ db, adapter })`: Vorprüfung, Idempotenz, PR anlegen, RolloutAction und AuditLog |
| `src/rollout/pr-text.ts` | deutscher PR-Titel und -Text, inklusive Eingaben des Build-Checks |
| `src/rollout/auto-onboarding.ts` | `setAutoOnboarding` (Schalter je Owner) und `runAutoOnboarding` (Auswahl, höchstens 5 je Durchlauf) |
| `src/rollout/runtime.ts` | `getRolloutService()`: träger Singleton für Server Actions (Env erst beim ersten Aufruf) |
| `src/sync/rollouts.ts` | `syncRolloutActions`: offene Aktionen auf `merged`/`closed`/`failed` nachziehen |
| `src/platform/github/adapter.ts` | `createChangeRequest`, `findOpenChangeRequest`, `deleteBranch`, `readTemplate` |

Aus Client-Komponenten nur `@/rollout/types` importieren; `@/rollout` (Index) zieht die Datenbank mit.

## PlatformAdapter (plattformneutral)

- `createChangeRequest(conn, repo, { branch, baseBranch, title, body, files })` gibt `{ number, url }` zurück.
  GitHub: Tree auf dem Base-Commit (Dateiinhalte inline, GitHub legt die Blobs selbst an), Commit, Ref, PR.
  Scheitert ein Schritt nach dem Ref, löscht der Adapter den Branch. Existiert der Branch schon (Rest eines
  früheren oder geschlossenen Rollouts), wird er ersetzt.
- `findOpenChangeRequest(conn, repo, branch)`: offener PR mit diesem Head oder `null`.
- `deleteBranch(conn, repo, branch)`: ein fehlender Branch ist kein Fehler.
- `readTemplate("renovate-config" | "build-check-caller")` gibt `{ path, content }` zurück (Zielpfad im Repo).
  Gelesen aus `Krinke-IT-Consulting/renovate`, Default-Branch, über die Installation dieses Owners; 5 Minuten
  Cache im Prozess, keine Kopie im Image.
- `PlatformPermissionError` (mit deutscher `userMessage`) bei fehlenden Schreibrechten.

## Verhalten je Fall

| Fall | Ergebnis |
|---|---|
| Repo unbekannt, entfernt oder archiviert | `not_needed` (`removed`, `archived`), kein Eintrag |
| Onboarding, Konfiguration vorhanden (`config_path` oder Status `onboarded`/`disabled`) | `not_needed` (`config_present`) |
| Build-Check: Status `active` / eigene CI / nicht onboardet | `not_needed` (`build_check_present` / `own_ci` / `not_onboarded`) |
| Offener PR auf `renovate-platform/onboarding` bzw. `/build-check` | `existing` mit Link, offene Aktion übernommen oder angelegt, Repo-Status `pr_open`, AuditLog |
| Sonst | Aktion `pending`, dann PR; `created`, Aktion `pr_open`, Repo-Status `pr_open`, AuditLog (eine Transaktion) |
| Fehler beim Anlegen | `failed`, Aktion `failed` mit deutscher Meldung, AuditLog, kein Rest-Branch |
| Fehlende Rechte | Meldung: GitHub App fehlt das Schreibrecht auf Workflows |
| Kontingent knapp | `failed`, aber ohne Aktion und ohne AuditLog (das Repo kommt später wieder dran) |
| Frische `pending`-Aktion | `failed` "läuft bereits"; älter als 10 Minuten gilt sie als abgebrochen |

Dateien: Onboarding schreibt `renovate.json` und die Aufrufdatei, die Aufrufdatei aber nur bei Build-Check-Status
`missing` ohne eigene CI. Build-Check schreibt nur die Aufrufdatei.
AuditLog: `rollout.onboarding` bzw. `rollout.build_check`, Ziel `full_name`, Nutzer `actor`.

## Automatisches Onboarding

Im GitHub-Abgleich (`runGithubSync` mit `rollout`-Option, vom Scheduler gesetzt), nach dem Abgleich aller Repos.
Auswahl: `auto_onboarding = true`, `first_seen_at > auto_onboarding_enabled_at`, nicht archiviert, nicht entfernt,
ohne Konfiguration, Inhalt gelesen (`head_sha` gesetzt), Status `none` und keine frühere RolloutAction der Art
`onboarding` (egal in welchem Status: ein geschlossener Auto-PR wird nie wiederholt). Höchstens 5 je Durchlauf,
Akteur `auto`, Fehler je Repo als Teilfehler.
`setAutoOnboarding(db, connectionId, enabled, actor, now)` setzt den Zeitpunkt nur beim Einschalten und schreibt
`settings.auto_onboarding`; wiederholtes Einschalten ändert nichts.

## API-Verbrauch

- Rollout: je Lauf 1 bedingter Abruf (offener PR), 1 bis 2 Vorlagen (bedingt, 5 Minuten Cache), dann 5 bis 6
  Schreibaufrufe (Head-SHA bedingt, Base-Commit, Tree, Commit, Ref, PR).
- Abgleich: je offener Rollout-PR ein bedingter Abruf des PR-Zustands (304 kostet kein Kontingent).
- Benötigte App-Rechte: Contents (Schreiben), Pull requests (Schreiben), Workflows (Schreiben).
