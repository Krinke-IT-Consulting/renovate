# Rollout-Logik (Onboarding, Build-Check, automatisches Onboarding)

Stand: Phase 7, Tasks 7.3 bis 7.5, nach dem Review (Befunde A2 bis A5, G1 bis G8).
Vertrag zur Oberfläche: `dashboard/src/rollout/types.ts` (`RolloutService.run`, `RolloutOutcome`).

## Bausteine

| Datei | Aufgabe |
|---|---|
| `src/rollout/service.ts` | `createRolloutService({ db, adapter })`: Vorprüfung, Idempotenz, PR anlegen, RolloutAction und AuditLog |
| `src/rollout/pr-text.ts` | deutscher PR-Titel und -Text, inklusive Eingaben des Build-Checks |
| `src/rollout/auto-onboarding.ts` | `setAutoOnboarding` (Schalter je Owner) und `runAutoOnboarding` (Auswahl, höchstens 5 je Durchlauf) |
| `src/rollout/runtime.ts` | `getRolloutService()`: träger Singleton je Prozess für Server Actions **und** Scheduler (Env erst beim ersten Aufruf), baut auf `getGitHubAdapter()` |
| `src/platform/github/runtime.ts` | `getGitHubAdapter()`: genau eine `GitHubAdapter`-Instanz je Prozess (`globalThis`, Schlüssel `dashboard.githubAdapter`); Scheduler und Server Actions teilen so Kontingent-Pause, Vorlagen-Cache und Token-Cache |
| `src/rollout/e2e-fake-adapter.ts` | Plattform-Ersatz nur fürs Playwright-Smoke (siehe unten) |
| `src/sync/rollouts.ts` | `syncRolloutActions`: offene Aktionen auf `merged`/`closed`/`failed` nachziehen |
| `src/platform/github/adapter.ts` | `createChangeRequest`, `findOpenChangeRequest`, `deleteBranch`, `readTemplate` |

Aus Client-Komponenten nur `@/rollout/types` importieren; `@/rollout` (Index) zieht die Datenbank mit.

## PlatformAdapter (plattformneutral)

- `createChangeRequest(conn, repo, { branch, baseBranch, title, body, files })` gibt `{ number, url }` zurück.
  GitHub: Tree auf dem Base-Commit (Dateiinhalte inline, GitHub legt die Blobs selbst an), Commit, Ref, PR.
  Nur Branches mit `ROLLOUT_BRANCH_PREFIX` (`renovate-platform/`); sonst Fehler, ohne Anfrage.
  - **Dateien live prüfen:** vor dem Tree je Datei `GET contents/{path}?ref=<baseSha>` (404 zulässig, kein Cache).
    Gleicher Inhalt wird übersprungen; ist nichts mehr zu schreiben oder weicht eine Datei ab, wirft der Adapter
    `PlatformFilesExistError { identical, differing }` und legt nichts an. Der Service bildet das ab (siehe Tabelle).
  - **Ref existiert schon (422):** zuerst `findOpenChangeRequest`. Gibt es einen offenen PR, wird er zurückgegeben
    und der Branch bleibt; sonst ist es ein Rest und wird ersetzt.
  - **Fehler beim PR-Anlegen:** Bei Status 0, >= 500 oder 422 sucht der Adapter einmal nach dem PR. Gibt es ihn,
    wird er zurückgegeben (kein Cleanup). Sonst löscht der Cleanup den Branch an der Kontingent-Pause vorbei
    (`bypassPause`, genau ein Aufruf). Scheitert das Löschen oder die Suche, wirft der Adapter
    `PlatformLeftoverBranchError { branch, original }`: Meldung und RolloutAction nennen den Rest-Branch.
- `findOpenChangeRequest(conn, repo, branch)`: offener PR mit diesem Head oder `null`.
- `deleteBranch(conn, repo, branch)`: nur Rollout-Branches; ein fehlender Branch ist kein Fehler.
- `readTemplate("renovate-config" | "build-check-caller")` gibt `{ path, content }` zurück (Zielpfad im Repo).
  Gelesen aus `Krinke-IT-Consulting/renovate`, Default-Branch, über die Installation dieses Owners; 5 Minuten
  Cache im Prozess, keine Kopie im Image.
- `getHeadSha` nimmt eine `ConnectionRef` (kein Owner-Typ nötig).
- Fehlerklassen mit deutscher `userMessage`: `PlatformPermissionError` (fehlende Schreibrechte),
  `PlatformRejectedError` (erkennbare Ablehnung: leeres Repo, Repo nicht in der Installation, Branch-Regel,
  Vorlagen-Repo nicht lesbar). Dazu `PlatformFilesExistError` und `PlatformLeftoverBranchError` (s. o.).

### Fehlerabbildung beim Schreiben (Reihenfolge)

1. 403/429 mit leerem Kontingent, `retry-after` **oder** Text mit `rate limit`: `RateLimitPause`. Das sekundäre
   Limit kommt oft ohne `retry-after`: dann mindestens 60 s Pause.
2. 403/422 mit Text zu Ruleset, `rule violation`, Branch-Schutz: "Eine Branch-Regel verhindert das Anlegen von
   `renovate-platform/…`."
3. Text zu Workflows (4xx): Schreibrecht auf Workflows fehlt.
4. 404: "Repo nicht gefunden oder nicht in der Installation." (kein Rechtefehler)
5. 403: fehlende Schreibrechte (Inhalte, Pull Requests oder Workflows).
6. Rest: nur Status, Methode und Pfad.

Leeres Repo (kein Commit): "Das Repo hat noch keinen Commit; ein Onboarding-PR ist erst danach möglich."

### Vorlagen

Bei 404 mit gemerkter Installation wird der Scope verworfen und genau einmal neu aufgelöst (Installation entfernt
oder Repo nicht mehr enthalten). Bleibt es bei 404 oder gibt es keine Installation des Owners: "Das Vorlagen-Repo
Krinke-IT-Consulting/renovate ist für die GitHub App nicht lesbar."

## Verhalten je Fall

| Fall | Ergebnis |
|---|---|
| Repo unbekannt, entfernt oder archiviert | `not_needed` (`removed`, `archived`), kein Eintrag |
| Onboarding, Konfiguration vorhanden (`config_path` oder Status `onboarded`/`disabled`) | `not_needed` (`config_present`) |
| Build-Check: Status `active` / eigene CI / nicht onboardet | `not_needed` (`build_check_present` / `own_ci` / `not_onboarded`) |
| Offener PR auf `renovate-platform/onboarding` bzw. `/build-check` | `existing` mit Link, offene Aktion übernommen oder angelegt, Repo-Status `pr_open`, AuditLog (`rollout.<art>`). Schließt ein paralleler Klick die Aktion gerade ab, schreibt nur dieser den Eintrag. |
| Sonst | Aktion `pending`, dann PR; `created`, Aktion `pr_open`, Repo-Status `pr_open`, AuditLog (eine Transaktion) |
| Fehler beim Anlegen | `failed`, Aktion `failed` mit deutscher Meldung, AuditLog `rollout.onboarding.failed` bzw. `rollout.build_check.failed`, kein Rest-Branch (sonst nennt die Meldung ihn) |
| Fehlende Rechte | Meldung: GitHub App fehlt das Schreibrecht auf Workflows |
| `renovate.json` existiert (live geprüft) | `not_needed` (`config_present`), nichts überschrieben, keine Aktion |
| Alle Dateien schon mit Vorlageninhalt da | `not_needed` (`config_present` bzw. `build_check_present`), keine Aktion |
| Aufrufdatei existiert mit eigenem Inhalt | `failed`: "`.github/workflows/build-check.yml` existiert bereits mit eigenem Inhalt. Bitte von Hand anpassen oder das Repo als „eigene CI“ markieren." Aktion `failed`, AuditLog `.failed`, nichts überschrieben |
| Kontingent knapp | `failed`, aber ohne Aktion und ohne AuditLog (das Repo kommt später wieder dran); bleibt ein Rest-Branch, steht er in der Meldung und im Log (`Rollout: Rest-Branch …`) |
| Frische `pending`-Aktion | `failed` "läuft bereits"; älter als 10 Minuten gilt sie als abgebrochen |

Die Dateiprüfung steht im Adapter; ein PR-Text, der die Aufrufdatei erwähnt, wird vorher gebaut. Ist die Aufrufdatei
schon identisch da, erwähnt der Text sie trotzdem (bekannte Unschärfe, ohne Folgen für das Ergebnis).

Dateien: Onboarding schreibt `renovate.json` und die Aufrufdatei, die Aufrufdatei aber nur bei Build-Check-Status
`missing` ohne eigene CI. Build-Check schreibt nur die Aufrufdatei.
AuditLog: `rollout.onboarding` bzw. `rollout.build_check` (Erfolg, auch `existing`), `….failed` (Fehlschlag),
Ziel `full_name`, Nutzer `actor`.

## Automatisches Onboarding

Im GitHub-Abgleich (`runGithubSync` mit `rollout`-Option, vom Scheduler gesetzt), nach dem Abgleich aller Repos.
Auswahl: `auto_onboarding = true`, `first_seen_at > auto_onboarding_enabled_at`, nicht archiviert, nicht entfernt,
ohne Konfiguration, Inhalt gelesen (`head_sha` gesetzt), Status `none` und keine frühere RolloutAction der Art
`onboarding` (egal in welchem Status: ein geschlossener Auto-PR wird nie wiederholt). Höchstens 5 je Durchlauf,
Akteur `auto`, Fehler je Repo als Teilfehler.
**Das Limit von 5 gilt je Connection (Owner)**, nicht insgesamt: ein Owner mit hartnäckigen Fehlern verdrängt keinen anderen.
**Fehlschläge vor `pending`** (Vorabfragen scheitern, keine Installation hinterlegt) hinterlassen beim Auto-Onboarding
eine `failed`-RolloutAction samt AuditLog `rollout.onboarding.failed` (`RolloutRequest.recordEarlyFailure`). Damit
bleibt das Repo nicht ewig Kandidat und das Onboarding wird genau einmal versucht. **Nach `failed` ist ein manueller
Klick nötig.** Ausnahme `RateLimitPause`: ohne Spur, das Repo kommt später dran.
`setAutoOnboarding(db, connectionId, enabled, actor, now)` setzt den Zeitpunkt nur beim Einschalten und schreibt
`settings.auto_onboarding`; wiederholtes Einschalten ändert nichts.

## API-Verbrauch

- Rollout: je Lauf 1 bedingter Abruf (offener PR), 1 bis 2 Vorlagen (bedingt, 5 Minuten Cache), Head-SHA (bedingt),
  Base-Commit, **je Datei 1 Abruf `contents` (neu, ohne Cache, 1 bis 2 Aufrufe)**, dann 4 Schreibaufrufe (Tree, Commit,
  Ref, PR). Im Fehlerfall kommen eine PR-Suche (bei unklarem Fehler) und 1 Löschaufruf dazu.
- Scheduler und Server Actions nutzen dieselbe Adapter-Instanz: Eine Kontingent-Pause gilt für beide, der
  Vorlagen-Cache wird geteilt (weniger Abrufe als mit zwei Instanzen).
- Abgleich: je offener Rollout-PR ein bedingter Abruf des PR-Zustands (304 kostet kein Kontingent).
- Benötigte App-Rechte: Contents (Schreiben), Pull requests (Schreiben), Workflows (Schreiben). Keine neuen Rechte
  durch die Review-Änderungen.

## E2E-Plattform-Ersatz

`src/rollout/e2e-fake-adapter.ts` ersetzt im Playwright-Smoke nur den `PlatformAdapter` (PR-Nummern ab 100, keine
Netzzugriffe); Rollout-Service, Datenbank, RolloutAction und AuditLog laufen echt. Aktiv nur bei
`NODE_ENV !== "production"` **und** `E2E_FAKE_PLATFORM=1`; die Variable setzt allein `playwright.config.ts`. Sie steht
bewusst nicht im Env-Schema und nicht in `.env.example`, weil sie kein Betriebswert ist. Gewählt statt eines
Fake-GitHub-Servers, weil dieser eine Basis-URL im Produktionsadapter und die ganze Anmeldung (JWT, Token) bräuchte; der
echte Adapter ist durch die msw-Tests mit Fixtures abgedeckt.
