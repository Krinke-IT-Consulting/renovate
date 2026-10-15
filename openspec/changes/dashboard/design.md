# Design

## Context

- **Stack heute:** Renovate CE 15.7.0, Postgres, Authelia und ein Platzhalter laufen als
  Compose-Stack in Coolify (`deploy/docker-compose.yaml`).
  - Der Platzhalter `renovate-placeholder` hängt hinter den Routern `renovate-dashboard` und
    `renovate-dashboard-http`, mit der Middleware `renovate-authelia@docker`.
  - Die Datenbank `dashboard` mit gleichnamiger Rolle existiert schon (`deploy/postgres/init/01-databases.sh`).
- **Renovate CE**, erreichbar im internen Netz als `renovate-ce:8080`:
  - Die Job- und System-API sind eingeschaltet, die Reporting-API noch nicht.
  - Die API von CE 15.7 bietet laut `mend/renovate-ce-ee/docs/openapi-community.yaml`:

    | Endpunkt | Inhalt |
    |---|---|
    | `GET /system/v1/status` | Scheduler, letzter Job, Webhook-Zeitpunkt |
    | `GET /system/v1/jobs/queue` | laufende und wartende Jobs |
    | `GET /api/v1/repos/{org}/{repo}/-/jobs` | Job-Historie je Repo: `jobId`, `reason`, `status`, `startedAt`, `completedAt`, `error`, `artifactErrors` |
    | `GET /system/v1/jobs/logs/{jobId}` | Log als JSON Lines |
    | `POST /system/v1/jobs/add` | Job für ein Repo einreihen |
    | `GET /api/v1/orgs/{org}/-/repos` | Repo-Status: `onboarded`, `disabled`, `failed` usw., nur mit Reporting-API |

  - Fehlende Endpunkte:
    - Eine globale Job-Historie gibt es nicht, ebenso keinen Lauf für alle Repos per API.
    - PR- und Dependency-Dashboard-Endpunkte gibt es nur in EE.
  - Logs liegen unter `/tmp/renovate` im Volume `renovate-cache`.
- **GitHub:**
  - Die GitHub App „Krinke IT Renovate“ ist in beiden Ownern installiert und hat die Rechte für CE.
  - Das Preset setzt die Labels `security` und `update:*` (`default.json`).
- **Coolify:**
  - Der Build läuft nur mit Build-Variablen, `${VAR:?}` geht nicht.
  - Domains in Coolify sind tabu; das Routing läuft über eigene Labels.
  - Das Netz `coolify` teilen sich mehrere Stacks.
- **Gestaltung:**
  - `PRODUCT.md` legt Produkt und Ton fest.
  - Die Übersicht ist als „Lagebericht“ bestätigt (`feature-documentation/uebersicht-entwurf.md`).
  - Eine `DESIGN.md` entsteht erst nach dem Bau.
- **Rahmen:** Der Betreiber will einen einzigen Change (1c), das ganze Datenmodell auf einmal (2a)
  und ein frühes Deployment des Grundgerüsts (3a).

## Goals / Non-Goals

**Goals:**
- Alle Must-haves des Dashboards aus PRD 3.1 in einer Anwendung, die im bestehenden Stack läuft
- Keine neuen Dienste und, bis auf eines, keine neuen Secrets
- Lesbare Phasen mit Prüfpunkten, damit der große Change kontrollierbar bleibt
- Plattformneutralität im Code und im Datenmodell

**Non-Goals:**
- Mandanten-Sicht, GitLab, Benachrichtigungen, Backups, Metriken (PRD 3.2)
- Eigene Nutzerverwaltung
- Echtzeit-Aktualisierung (Polling genügt)
- Änderungen an Renovate-Regeln (`default.json`)

## Decisions

### 1. Aufbau der Anwendung
- **Next.js:** App Router, TypeScript strict, `output: "standalone"`. Die Versionen von Next.js,
  React, Drizzle und Octokit werden in Task 1.1 auf den aktuellen stabilen Stand festgelegt.
- **Paketmanager npm**, Lockfile `dashboard/package-lock.json`. Der Build-Check und Renovate erfassen
  sie ohne Zusatz.
- **Ordner:**

  | Pfad | Inhalt |
  |---|---|
  | `src/app/` | Seiten, Layout, Server Actions, `api/health` |
  | `src/env.ts` | zod-Schema aller Variablen |
  | `src/db/` | Drizzle-Schema, Client, Migrations-Runner |
  | `drizzle/` | erzeugte SQL-Migrationen, eingecheckt |
  | `src/platform/` | `PlatformAdapter`, `GitHubAdapter` |
  | `src/ce/` | Client der CE-API |
  | `src/sync/` | Abgleich, Sperren, Problem-Regeln |
  | `src/domain/` | reine Logik: Update-Typ, Status, Lagebericht-Texte |
  | `src/components/` | UI, shadcn/ui unter `components/ui` |

- **Seiten:** Alle Seiten sind dynamisch (`dynamic = "force-dynamic"`). So greift der Build nie auf
  Datenbank oder Secrets zu. Damit ist die Coolify-Grenze aus dem Kontext erfüllt.

### 2. Ein Container, ein Prozess
- **Startbefehl:** `node migrate.js && exec node server.js`.
- **Migration:** `migrate.js` wendet die Migrationen an und legt den Tenant „Krinke IT“ an, falls er
  fehlt.
- **Abgleich:** Er startet in `instrumentation.ts` (`register()`, nur in der Node-Laufzeit) als
  Intervall-Schleifen im Serverprozess.
- **Verworfen:**
  - **Fünfter Dienst `worker`:** Er kostet zusätzlichen RAM und zusätzlichen Betrieb und ändert die
    Dienstzahl der Spec.
  - **Zwei Prozesse in einem Container:** Dafür bräuchte es einen Prozessmanager.
- **Speichergrenze:** `mem_limit: 512m`. Der Healthcheck läuft über
  `node -e "fetch('http://localhost:3000/api/health')…"`, weil das Image nicht zwingend `wget` hat.

### 3. Datenmodell
- **Grundlage:** das Modell aus PRD 4.3 als Drizzle-Schema, mit Postgres-Enums, `uuid`-Schlüsseln
  und `timestamptz`.
- **Ergänzungen** (nötig für die Specs):

  | Tabelle | Ergänzung | Grund |
  |---|---|---|
  | Repository | `build_check_status` um `own_ci` | Repos mit eigener CI (4a) |
  | Repository | `first_seen_at`, `head_sha`, `config_path`, `ce_status` | Auto-Onboarding nur für neue Repos; Inhaltsprüfung nur bei neuem Commit |
  | PlatformConnection | `auto_onboarding_enabled_at` | Repos, die vor dem Einschalten bekannt waren, bleiben ausgenommen |
  | PullRequest | `head_sha`, `labels` | CI nur bei neuem Commit neu lesen |
  | RolloutAction | Status `closed` | geschlossene Auto-PRs nicht wiederholen |
  | RenovateJob | `reason` (Rohwert), `error_message` | Problem-Regeln, Anzeige |
  | neu: `sync_state` | Quelle, letzter Erfolg, letzter Fehler mit Zeit | Abgleich-Stempel |
  | neu: `http_cache` | URL-Schlüssel, ETag, Antwort | bedingte Requests |

- **Nach dem Review durch `drizzle-migrations` (Task 3.3)** ergänzt, vor dem ersten Rollout in
  Migration `0000`:
  - **„Eigene CI“:** Sie ist eine eigene Spalte `own_ci boolean`. Der Abgleich berechnet
    `build_check_status` und ergibt `own_ci` nur, wenn die Markierung gesetzt ist und keine
    Aufrufdatei existiert. So überschreibt der Abgleich die Markierung des Betreibers nie.
  - **Repo-Identität:** `external_id` (ID auf der Plattform) mit eindeutigem
    `(connection_id, external_id)`. Ein umbenanntes Repo bleibt dieselbe Zeile, und `full_name`
    wird nachgezogen.
  - **Repos löschen:** Der Abgleich löscht keine Repos. Verschwundene Repos bekommen `removed_at`.
    So bleibt das Gedächtnis für „Auto-Onboarding nicht wiederholen“ erhalten.
  - **RolloutAction:** `pr_number`, dazu ein Teil-Unique-Index `(repository_id, kind)` für den Status
    `pending`/`pr_open`. Es gibt also höchstens einen offenen Rollout je Art.
  - **Problem:** `dedupe_key` (etwa die PR-Nummer) mit Teil-Unique-Index
    `(repository_id, kind, dedupe_key)` für offene Probleme.
  - **RenovateJob:** `status_raw` neben dem Enum. Unbekannte CE-Zustände gehen nicht verloren.
  - **Tenant:** Er wird nur angelegt, wenn die Tabelle leer ist.
  - **Weitere Indizes:**
    - eindeutig `(platform, installation_id)`
    - `renovate_jobs (repository_id, started_at)` und `(status)`
    - `pull_requests (repository_id, state)`
  - **Bewusst offen:** `sync_state`, `http_cache` und `audit_log` haben noch keinen Tenant-Bezug. Das
    ist unkritisch, solange es nur einen Tenant gibt, und kommt mit der Mandantenfähigkeit.
- **Schlüssel und Indizes:**
  - eindeutig: `(connection_id, external_id)`, `(repository_id, number)`, `ce_job_id`
  - `(connection_id, full_name)` als normaler Index (Umbenennungen)
  - Indizes auf `repository_id` in allen Kind-Tabellen
  - Teil-Unique-Indizes für offene Probleme und offene Rollouts (siehe oben)
- **Migrationen:** `drizzle-kit generate` lokal, SQL eingecheckt. Zur Laufzeit wendet sie der
  Migrator von `drizzle-orm` an, unter `pg_advisory_lock`. Der Agent `drizzle-migrations` prüft
  jede Migration vor dem Commit.

### 4. Vertrauensgrenze zum Login
- **Ausgangslage:** Traefik schickt nach der Forward-Auth die Header `Remote-*` an das Dashboard. Das
  Dashboard darf ihnen nicht blind trauen, sobald es außer Traefik noch jemand direkt erreichen kann.
- **Ursprünglicher Ansatz, verworfen nach dem ersten Deployment (Task 4.6):**
  - Traefik sollte per Label-Middleware ein geheimes Header-Secret mitschicken.
  - Coolify schreibt aber in Labels jedes `$` als `$$`. Im Label steht deshalb wörtlich
    `${DASHBOARD_PROXY_SECRET}`, und Traefik schickt den Text statt des Werts.
  - Außerdem ignoriert Coolify `networks: coolify`. Die Dienste hängen nur im Projektnetz, das sie
    allein mit `coolify-proxy` teilen.
- **Lösung: Das Dashboard prüft die Sitzung selbst bei Authelia.**
  - Der Proxy (Next-Middleware) ruft für jede Anfrage
    `GET <AUTHELIA_INTERNAL_URL>/api/authz/forward-auth` im internen Netz auf.
  - Er reicht dabei das Cookie der Anfrage weiter, dazu `X-Forwarded-Method`, `-Proto`, `-Host`,
    `-Uri` und `-For` der ursprünglichen Anfrage.
  - **Antwortet Authelia mit 200,** gilt der Nutzer aus dem `Remote-User` dieser Antwort. Der Proxy
    gibt ihn intern als `x-dashboard-user` an die Seiten weiter.
  - **Jede andere Antwort, kein Cookie oder Authelia nicht erreichbar:** 403.
  - **Eingehende Header** `Remote-*` und `x-dashboard-user` der ursprünglichen Anfrage werden vorher
    entfernt.
  - **Zwischenspeicher:** Das Ergebnis wird 30 Sekunden lang im Speicher gehalten. Schlüssel ist der
    SHA-256 des Cookie-Werts plus der Host. Abgelehnte Antworten werden nicht gespeichert.
  - **Ausnahme:** `GET /api/health`. Er liefert nur `ok` oder einen Fehlercode.
- **Wirkung:** Eine gefälschte Anfrage bräuchte eine gültige Authelia-Sitzung, ihr Absender wäre also
  ohnehin angemeldet. Die Prüfung hängt weder von Labels noch von der Netzbehandlung durch Coolify ab.
- **Verworfen:**
  - **Nur der Netztrennung vertrauen:** Das hängt am Verhalten von Coolify.
  - **Secret in einer dynamischen Traefik-Konfiguration auf dem Server:** Sie läge außerhalb des
    Repos und würde von Hand gepflegt.
  - **IP-Freigabe für Traefik:** Die Adresse ist dynamisch.

### 5. Konfiguration
- **Verwendete Werte:**

  | Name | Herkunft | Wert im Stack |
  |---|---|---|
  | `DATABASE_URL` | abgeleitet | Compose setzt `postgresql://dashboard:${DASHBOARD_DB_PASSWORD}@postgres:5432/dashboard`; das Passwort ist hex, ohne URL-Encoding |
  | `RENOVATE_CE_API_URL` | Konfiguration | `http://renovate-ce:8080`, fest in Compose |
  | `MEND_RNV_API_SERVER_SECRET` | vorhanden, selbst erzeugt | dasselbe Secret wie bei CE |
  | `MEND_RNV_GITHUB_APP_ID`, `MEND_RNV_GITHUB_APP_KEY` | vorhanden, vom Menschen | dieselbe App wie CE |
  | `AUTHELIA_INTERNAL_URL` | Konfiguration | `http://renovate-authelia:9091`, fest in Compose |

- **Begründung für gemeinsame Namen:** Es ist ein Wert mit einem Namen. Ein Wechsel betrifft beide
  Dienste gemeinsam (`betrieb-coolify.md`).
- **Lokaler Betrieb:** `dashboard/.env.local` (lädt Next.js). Die Namen stehen mit Kommentar in der
  zentralen `.env.example`.
- **Intervalle und Schwellen** sind Konstanten im Code, keine Variablen:
  - GitHub alle 5 Minuten, CE jede Minute
  - PR hängend nach 14 Tagen, Sicherheitsupdate nach 7 Tagen

### 6. Abgleich mit GitHub
- **Schnittstelle `PlatformAdapter`:**
  - `listConnections`
  - `listRepositories`
  - `getRepositoryState` (Konfigurationsdatei, Build-Check-Datei)
  - `listUpdatePullRequests`
  - `getChangeStatus`
  - `findDependencyDashboard`
  - `createChangeRequest` (Dateien, Branch, Titel, Text)

  Die Typen sprechen von „Change Request“ und „Connection“, nicht von GitHub-Begriffen.
- **`GitHubAdapter`:** `@octokit/app` mit `eachInstallation`, Installation-Tokens aus JWT.
- **Je Installation und Durchlauf:**
  - **Repos:** über `GET /installation/repositories`.
  - **Default-Branch:** Der Head-SHA wird gelesen. Nur wenn er sich geändert hat, liest der Abgleich
    die Inhalte:
    - Konfigurationsdateien in Renovates Reihenfolge, zuerst `renovate.json`, dann `renovate.json5`,
      `.github/renovate.json(5)`, `.renovaterc(.json)` usw.
    - die Datei `.github/workflows/build-check.yml`. Sie gilt als aktiv, wenn sie
      `Krinke-IT-Consulting/renovate/.github/workflows/build-check.yml@` enthält.
  - **Offene PRs:** Gezählt werden PRs mit Head-Branch `renovate/` von `<app-slug>[bot]`.
  - **CI-Status:** Checks und kombinierter Status werden bei neuem Head-SHA gelesen und danach so lange erneut (bedingt, ETag), bis der Status `success` ist.
  - **Nicht mehr gelistete PRs:** Sie werden einzeln nachgeladen, um merged oder closed festzuhalten.
  - **Dependency-Dashboard-Issue:** offenes Issue des Bots mit dem Titel „Dependency Dashboard“.
- **Budget:**
  - ETags über `http_cache`. Eine Antwort 304 kostet kein Kontingent.
  - Die Installation teilt ihr Limit von 5.000 Anfragen pro Stunde mit CE.
  - Schätzung bei 50 Repos ohne Änderungen: etwa 60 Anfragen pro Durchlauf, also rund 720 pro
    Stunde. Bei vielen Änderungen am Wochenende werden es mehr. Siehe Risiken.
- **Fehler:** Er gilt pro Repo und landet als Teilfehler in `sync_state`.

### 7. Abgleich mit Renovate CE
- **Jede Minute:** `jobs/queue` (laufende und wartende Jobs) und je Org `orgs/{org}/-/repos`
  (Status).
- **Je bekanntem Repo:** `repos/{org}/{repo}/-/jobs?limit=20`. Neue Jobs werden per `ce_job_id`
  eingefügt, bekannte aktualisiert.
- **Grund auf Auslöser abbilden:**

  | Auslöser | Werte von `reason` |
  |---|---|
  | `schedule` | `hourly`, `schedule-*` |
  | `manual` | `api-request`, `web-ui` |
  | `webhook` | alle übrigen, etwa `main-commit`, `dependency-dashboard`, `pr-update` |

- **Status:** `success` bleibt `success`, alle Fehlerwerte werden `failed`. Wartende und laufende
  Jobs kommen aus der Queue.
- **Log-Auszug für fehlgeschlagene Jobs:**
  - Quelle ist `GET /system/v1/jobs/logs/{jobId}`. Die Logs sind Bunyan-JSON-Lines mit numerischem
    Level, etwa 136 KB je Lauf (geprüft in Task 1.2).
  - Behalten werden Zeilen mit Level ≥ 40 (`warn`, `error`), bis höchstens 200 Zeilen bzw. 16 KB.
  - Renovate maskiert Secrets selbst. Zusätzlich werden Felder mit `token`, `password`, `secret` und
    `key` im Namen entfernt.
- **CE-Einstellung:** Renovate CE bekommt `MEND_RNV_API_ENABLE_REPORTING: "true"` für den Repo-Status.
- **Repo-Status von CE** (geprüft nach dem ersten Deployment):
  - CE meldet jedes Repo ohne Renovate-Konfiguration als `disabled`, weil `requireConfig: required`
    gilt.
  - Der Onboarding-Status folgt deshalb aus der Konfigurationsdatei auf der Plattform. `disabled` von
    CE zählt nur, wenn eine Konfiguration existiert.
- **Verworfen:** die Datenbank `renovate_ce` lesen. Das verbietet das PRD, und das Schema ist intern.

### 8. Probleme
- **Regeln:** Sie sind reine Funktionen in `src/domain/problems.ts`, mit Eingabe Repo-Zustand und
  Ausgabe Problemliste.
- **Abgleich mit der Datenbank:** Neu heißt einfügen, weiter da heißt `last_seen_at` aktualisieren,
  weg heißt `resolved_at` setzen.
- **Erkennung der Arten:**
  - `config_error`: Repo-Status `failed`, oder ein Fehlername bzw. eine Meldung mit
    „config“/„validation“.
  - `lockfile_failure`: `artifactErrors` ist nicht leer.

### 9. Oberfläche
- **Bausteine:** shadcn/ui (Dialog, AlertDialog, Sheet, Badge, Toast) und TanStack Table. Die
  Filter stehen in `searchParams`.
- **Schriften:** über `@fontsource` selbst gehostet, ohne externe Anfrage bei Build und Laufzeit.
  Für Logs und Versionen der System-Monospace-Stack. Ob eine eigene Monospace-Schrift kommt, klärt
  `/impeccable shape`.
- **Logo:** `logo-wide.png` und `logo-compact.png` werden unverändert aus dem krinke.me-Repo nach
  `dashboard/public/images/` kopiert.
- **Lagebericht:** Textbausteine in `src/domain/report.ts`, getestet mit Fixtures.
- **Aktualisierung:** Ein unaufdringliches `router.refresh()` alle 60 Sekunden, solange der Tab
  sichtbar ist.
- **Ablauf der Gestaltung:**
  - Vor dem Bau der übrigen Seiten (Repos, Repo-Detail, PRs, Jobs, Probleme) läuft
    `/impeccable shape`.
  - Vor Abschluss läuft `/impeccable audit`.
  - Danach erzeugt `/impeccable document` die `DESIGN.md`.

### 10. Aktionen
- **Umsetzung:** als Server Actions. Next prüft dabei die Herkunft.
- **Bestätigung:** über AlertDialog, der die Wirkung nennt. Erst danach wird die Action aufgerufen.
- **AuditLog** im selben Transaktionsschritt wie RolloutAction bzw. Job-Anstoß.
- **Läufe:**
  - Je Repo ruft das Dashboard `POST /system/v1/jobs/add` auf. CE meldet bei vorhandenem Job
    `unchanged`.
  - „Alle“ iteriert über onboardete, nicht archivierte Repos.
- **Onboarding- und Rollout-PR:**
  - **Vorlagen:** `templates/renovate.json` und `templates/build-check-caller.yml`, gelesen über die
    API aus `Krinke-IT-Consulting/renovate`, Default-Branch. So gibt es keine Kopie im Image.
  - **Branch:** `renovate-platform/onboarding` bzw. `renovate-platform/build-check`. Alle Dateien
    kommen in einem Commit über die Git-Data-API (Tree, Commit, Ref).
  - **Fehlerfall:** Der Branch wird wieder gelöscht.
  - **Idempotenz:** Vorher wird auf einen offenen PR mit diesem Head und auf eine vorhandene
    Konfiguration geprüft.
- **Automatisches Onboarding:**
  - Es läuft im GitHub-Abgleich, nur für Repos mit
    `first_seen_at > auto_onboarding_enabled_at` und ohne frühere RolloutAction dieser Art.
  - Die Rate ist auf höchstens fünf PRs pro Durchlauf begrenzt.

### 11. Tests und CI
- **Vitest:**
  - **Reine Logik:** Update-Typ, Status, Probleme, Lagebericht, Mapping der CE-Gründe.
  - **Adapter:** gegen aufgezeichnete Antworten mit `msw`, nie gegen die echte API.
  - **Integration gegen Postgres:** Migrationen, Upserts, Sperren.
    - Die Datenbank kommt im CI aus dem Build-Check: `build-check-self.yml` setzt `postgres: true`.
    - Ohne `DATABASE_URL` werden diese Tests übersprungen.
- **Playwright-Smoke** (`npm run test:e2e`): gegen `next start` mit einer Fixture-Datenbank, Daten
  als Fixtures gekennzeichnet.
  - Er läuft lokal und vor jedem Deployment.
  - Im Build-Check läuft er nicht: Der Download der Browser würde jeden Renovate-PR verlangsamen.
- **Lint und Typecheck:** `eslint` und `tsc --noEmit` als Skripte, damit der Build-Check sie ausführt.

### 12. Phasen und frühes Deployment
- **Ablauf:** Die Tasks sind in Phasen geschnitten, jede endet mit einem prüfbaren Zustand.
- **Erstes Deployment nach Phase 4:**
  - Stand: Grundgerüst mit App-Shell und Leerzuständen, Datenmodell, Vertrauensgrenze.
  - Prüfungen: Routing, Login-Header, 403 bei direktem Zugriff und Migrationen gegen die echte
    Datenbank.
  - Erst danach folgen Abgleich, Ansichten und Aktionen.
- **Freigabe:** Jedes Deployment braucht die Freigabe des Betreibers.

## Risks / Trade-offs

- **[Risiko] Ein großer Change.** Fehler zeigen sich spät, Reviews werden groß.
  - Gegenmaßnahmen: Phasen mit eigenem Prüfpunkt, ein Commit bzw. PR je Phase, frühes Deployment
    (Entscheidung 12). Nach jeder Phase prüft der `reviewer` den Diff.
- **[Risiko] Rate-Limit geteilt mit CE.** Ein großer Abgleich am Wochenende könnte CE ausbremsen.
  - Gegenmaßnahmen: ETags, Inhalte nur bei neuem Head-SHA, Abgleich pausiert, wenn das Rest-Limit
    (Header `x-ratelimit-remaining`) unter `max(20 % des Limits, 400)` fällt, und vermerkt das im Stempel.
- **[Eingetreten] Coolify ersetzt Variablen in Labels nicht.** Im ersten Deployment wurde das
  Proxy-Secret deshalb nie gesetzt.
  - Folge: Umstieg auf die Sitzungsprüfung bei Authelia (Entscheidung 4).
  - Merksatz für Labels in diesem Stack: keine `${…}`-Werte, nur Literale.
- **[Risiko] Zusätzliche Last durch die Sitzungsprüfung.** Jede Anfrage braucht ohne
  Zwischenspeicher einen internen Aufruf bei Authelia.
  - Gegenmaßnahme: 30 Sekunden Zwischenspeicher je Sitzung. Bei einem Nutzer ist die Last
    vernachlässigbar.
- **[Risiko] CE-Doku ist nicht versioniert.** Endpunkte können in 15.7 abweichen.
  - Gegenmaßnahme: Task 1.2 prüft jeden genutzten Endpunkt lesend gegen die laufende Instanz.
    Abweichungen ändern das Design, bevor Code entsteht.
- **[Risiko] Log-Auszüge mit sensiblen Inhalten.** Gegenmaßnahmen: nur `warn` und `error`,
  Feldfilter, Längengrenze, keine Logs im Dashboard-eigenen Log.
- **[Trade-off] Abgleich im Serverprozess.** Ein Absturz des Abgleichs trifft die Oberfläche.
  - Gegenmaßnahme: Fehler werden je Durchlauf gefangen. Es läuft nie mehr als ein Durchlauf.
- **[Trade-off] Vorlagen zur Laufzeit von GitHub.** Ohne GitHub kein Onboarding. Das ist ohnehin so,
  der PR entsteht dort.
- **[Risiko] Fehlende App-Rechte.** Workflows: Write und Checks: Read sind eventuell nicht gesetzt.
  - Gegenmaßnahme: Task 1.3 prüft die Rechte. Der Betreiber setzt sie von Hand. Ohne Workflow-Recht
    scheitert nur der Rollout, mit klarer Meldung.

## Migration Plan

1. **Phasen 1 bis 4:** Grundgerüst, Datenmodell, Stack. Dann Deployment nach Freigabe. Der
   Platzhalter verschwindet, und `deploy/placeholder/` wird gelöscht.
2. **Phasen 5 bis 7:** Abgleich, Ansichten, Aktionen. Je Phase ein PR, Deployment nach Freigabe.
3. **Erster echter Rollout:** Onboarding-PR für ein vom Betreiber benanntes Repo.
4. **Rückweg:**
   - Den vorherigen Commit von `main` deployen. Der Platzhalter-Dienst steht in der Git-Historie.
   - Die Datenbank `dashboard` darf stehen bleiben, CE nutzt sie nicht.
   - `MEND_RNV_API_ENABLE_REPORTING` ist folgenlos.

## Open Questions

- **Schwelle für hängende Sicherheitsupdates:** 7 Tage ist eine Annahme, laut Entwurf und
  `PRODUCT.md` offen. Sie ist eine Konstante und leicht zu ändern.
- **Monospace-Schrift:** Ob eine eigene Schrift kommt oder der System-Stack bleibt, entscheidet
  `/impeccable shape` (Task 6.1).
- **Erstes Onboarding-Repo:** Welches Repo den ersten echten Onboarding-PR bekommt, benennt der
  Betreiber in Task 7.7.
- **Playwright im CI:** Bei Bedarf als eigener Workflow im Dashboard-Pfad nachrüsten. Er ist nicht
  Teil des Build-Checks.
