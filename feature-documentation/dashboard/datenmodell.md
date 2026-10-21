# Dashboard: Datenmodell

Stand: 2026-10-22. Quellen: `dashboard/src/db/schema.ts` (Schema), `dashboard/drizzle/` (Migrationen, Snapshots, Journal),
`dashboard/src/db/migrate.ts` und `dashboard/src/db/migrate-cli.ts` (Migrationslauf), `dashboard/drizzle.config.ts`.
Die Begründung der Entscheidungen steht in `openspec/changes/dashboard/design.md`, Entscheidung 3.

## 1. Grundregeln

- Alle Zeitstempel sind `timestamptz`. Das Schema setzt Zeitpunkte als `Date` (Modus `date`).
- Die meisten Schlüssel sind `uuid` mit `gen_random_uuid()`. Ausnahmen: `sync_state.source` (Text, Quelle) und
  `http_cache.key` (Text, Cache-Schlüssel).
- Schlüssel der Plattform (`external_id`, `installation_id`, `ce_job_id`) werden als Text oder Zahl gespeichert, getrennt
  von den internen UUIDs.
- Der Datenbestand wird nie durch den Abgleich gelöscht. Verschwundene Repos bekommen `removed_at`, behobene Probleme
  `resolved_at`, Pull Requests den Endzustand in `state`. Die einzigen Löschvorgänge im Code sind in Abschnitt 4 genannt.

## 2. Enums

| Enum | Werte |
|---|---|
| `platform` | `github`, `gitlab` |
| `onboarding_status` | `none`, `pr_open`, `onboarded`, `disabled` |
| `build_check_status` | `missing`, `pr_open`, `active`, `own_ci` |
| `job_result` | `success`, `failed`, `skipped`, `unknown` |
| `update_type` | `major`, `minor`, `patch`, `security`, `digest`, `lockfile`, `other` |
| `ci_status` | `success`, `failure`, `pending`, `none` |
| `change_request_state` | `open`, `merged`, `closed` |
| `job_trigger` | `schedule`, `webhook`, `manual` |
| `job_status` | `queued`, `running`, `success`, `failed` |
| `problem_kind` | `config_error`, `lockfile_failure`, `job_failed`, `stale_pr`, `ci_red`, `missing_build_check` |
| `rollout_kind` | `onboarding`, `build_check` |
| `rollout_status` | `pending`, `pr_open`, `merged`, `failed`, `closed` |

Anmerkung: `platform` führt `gitlab` bereits im Enum. Im Repo gibt es nur die GitHub-Implementierung (`src/platform/github/`).

## 3. Tabellen

Die Reihenfolge folgt der Abhängigkeit: Mandant, Verbindung, Repo, Kind-Tabellen, dann Betriebstabellen.

### 3.1 `tenants`

Mandant. Im MVP genau einer: „Krinke IT“, angelegt beim Migrationslauf, wenn die Tabelle leer ist (siehe Abschnitt 6).

| Spalte | Bedeutung |
|---|---|
| `id` | UUID. |
| `name` | Anzeigename, eindeutig (`tenants_name_key`). |
| `created_at` | Anlagezeitpunkt. Der GitHub-Abgleich nimmt den ältesten Mandanten (`orderBy created_at`). |

### 3.2 `platform_connections`

Verbindung je Owner (Organisation oder Nutzer) auf einer Plattform. Bei GitHub entspricht sie einer App-Installation.

| Spalte | Bedeutung |
|---|---|
| `tenant_id` | FK auf `tenants`, `ON DELETE restrict`. |
| `platform` | Enum `platform`. |
| `owner_name` | Login des Owners. Wird bei Umbenennung nachgezogen (`github-sync.ts`, `upsertConnection`). |
| `installation_id` | Installations-ID der GitHub App. Kann leer sein, wenn die Verbindung von Hand angelegt wurde; der Abgleich übernimmt sie dann beim nächsten Lauf. |
| `auto_onboarding` | Schalter für das automatische Onboarding je Owner. Standard `false`. Wirkung in `abgleich.md`, Abschnitt 9. |
| `auto_onboarding_enabled_at` | Zeitpunkt des Einschaltens. Nur Repos, die danach zum ersten Mal gesehen wurden (`first_seen_at`), bekommen einen automatischen PR. |

Indizes:

- `platform_connections_tenant_platform_owner_key` (eindeutig über `tenant_id`, `platform`, `owner_name`): je Mandant und
  Plattform höchstens eine Verbindung je Owner.
- `platform_connections_platform_installation_key` (eindeutig über `platform`, `installation_id`, partiell
  `WHERE installation_id IS NOT NULL`): eine Installation gehört zu höchstens einer Verbindung. Zeilen ohne
  Installations-ID bleiben davon ausgenommen.
- `platform_connections_tenant_id_idx`: Suche nach Mandant.

### 3.3 `repositories`

Repo auf einer Plattform. Gehört zu einer Verbindung.

| Spalte | Bedeutung |
|---|---|
| `connection_id` | FK auf `platform_connections`, `ON DELETE cascade`. |
| `external_id` | ID des Repos auf der Plattform. Bleibt bei Umbenennung gleich. |
| `full_name` | `Owner/Name`. Wird bei Umbenennung nachgezogen. |
| `default_branch` | Standard-Branch. Der Head-SHA wird von ihm gelesen. |
| `archived` | Repo auf der Plattform archiviert. Archivierte Repos werden nicht mehr abgeglichen, Probleme entfallen. |
| `onboarding_status` | Abgeleitet (`deriveOnboardingStatus`). Mit Konfigurationsdatei: `onboarded`, bei CE-Status `disabled` stattdessen `disabled`. Ohne Konfiguration: `pr_open`, wenn ein Onboarding-PR offen ist, sonst `none`. |
| `build_check_status` | Abgeleitet (`deriveBuildCheckStatus`): `active` mit Aufrufdatei, `pr_open` mit offenem Build-Check-Rollout, `own_ci` bei Markierung, sonst `missing`. |
| `detected_ecosystems` | Text-Array. Im Abgleich nicht befüllt; nur die Testdaten in `src/db/fixtures.ts` setzen sie. Siehe Abschnitt 7. |
| `dependency_dashboard_url` | Link zum Dependency-Dashboard-Issue des Bots, oder leer. Bleibt bei einem Lesefehler der alte Link. |
| `last_job_at`, `last_job_result` | Zeit und Ergebnis des letzten beendeten Laufs (`success` oder `failed`), aus der CE-Historie. |
| `synced_at` | Zeitpunkt des letzten erfolgreichen Abgleichs des Repos. Bestimmt die Reihenfolge im nächsten Durchlauf. |
| `first_seen_at` | Erstes Auftreten im Abgleich. Grundlage des automatischen Onboardings. |
| `head_sha` | SHA des Default-Branches zum letzten Inhaltsabruf. Ändert er sich nicht, wird der Inhalt nicht neu gelesen. |
| `config_path` | Pfad der gefundenen Renovate-Konfiguration, sonst leer (`null`). |
| `ce_status` | Rohwert `status` der CE-Reporting-API (etwa `onboarded`, `disabled`, `failed`). Der Wert wird unverändert gespeichert. |
| `own_ci` | Markierung des Betreibers „eigene CI“. Der Abgleich überschreibt sie nie. |
| `removed_at` | Gesetzt, wenn das Repo auf der Plattform verschwunden ist oder seine Installation entfernt oder gesperrt wurde. Zeilen werden nicht gelöscht. |

Indizes:

- `repositories_connection_external_id_key` (eindeutig über `connection_id`, `external_id`): ein Repo je Verbindung.
- `repositories_connection_full_name_idx` (nicht eindeutig): kein Unique, weil bei einer Umbenennung der Name kurz doppelt
  vorkommen kann (Kommentar im Schema).
- `repositories_connection_id_idx`.

### 3.4 `pull_requests`

Update-PRs von Renovate, je Repo. Der Abgleich speichert offene PRs und hält Endzustände fest.

| Spalte | Bedeutung |
|---|---|
| `repository_id` | FK auf `repositories`, `ON DELETE cascade`. |
| `number` | PR-Nummer im Repo. |
| `title`, `url` | Titel und Link des PR. |
| `update_type` | Aus den Labels abgeleitet (`deriveUpdateType`). Vorrang: `security`, `major`, `minor`, `patch`, `digest`, `lockfile`; sonst `other`. |
| `package_names` | Namen der Pakete aus der Tabelle des PR-Textes (höchstens 50). |
| `ci_status` | Aus Check-Runs und Commit-Status des Head-SHA (`deriveCiStatus`). |
| `automerge` | Automerge gesetzt, laut Abgleich über GitHubs Auto-Merge oder die Renovate-Zeile im PR-Text. |
| `state` | `open`, `merged` oder `closed`. |
| `created_at`, `updated_at`, `merged_at` | Zeitpunkte von der Plattform. `merged_at` ist nur bei gemergten PRs gesetzt. |
| `head_sha` | Head-SHA des PR. Ändert er sich, wird der CI-Status neu gelesen. |
| `labels` | Labels des PR. Grundlage für `update_type`. |

Indizes:

- `pull_requests_repository_number_key` (eindeutig über `repository_id`, `number`): ein PR je Nummer und Repo.
- `pull_requests_repository_id_idx`, `pull_requests_repository_state_idx` (über `repository_id`, `state`).

### 3.5 `renovate_jobs`

Läufe von Renovate, je Repo. Quelle: Queue und Historie der CE-API.

| Spalte | Bedeutung |
|---|---|
| `repository_id` | FK auf `repositories`, `ON DELETE cascade`. |
| `ce_job_id` | ID des Laufs in der CE. Eindeutig; das ist der Upsert-Schlüssel des Abgleichs. |
| `trigger` | `schedule` (Grund `hourly` oder `schedule-*`), `manual` (`api-request`, `web-ui`), sonst `webhook` (`mapReasonToTrigger`, `src/ce/mapping.ts`). |
| `status` | `queued`, `running`, `success` oder `failed`. Abbildung in `abgleich.md`, Abschnitt 7. |
| `started_at`, `finished_at` | Zeiten von der CE. Eine fehlende Zeit überschreibt keine gespeicherte. |
| `log_excerpt` | Gekürzter Log-Auszug nur für fehlgeschlagene Läufe. `NULL`: noch nicht abgerufen. Leerer Text: abgerufen, nichts Verwertbares (oder Log in der CE gelöscht). |
| `reason` | Grund des Laufs von der CE, unverändert. |
| `error_message` | Kurzfassung des Fehlers (Name und Meldung, höchstens 300 Zeichen, Leerraum zusammengezogen). |
| `status_raw` | Roher CE-Status (etwa `success`, `running`, `purged`). Bei verschwundenen Läufen steht hier `verschwunden`. |
| `artifact_error_count` | Anzahl der `artifactErrors` des Laufs. Grundlage für `lockfile_failure`. |
| `created_at` | Zeitpunkt, zu dem das Dashboard den Lauf zuerst sah. Maßstab für verschwundene Läufe ohne Startzeit. |

Indizes:

- `renovate_jobs_ce_job_id_key` (eindeutig über `ce_job_id`): ein Eintrag je CE-Lauf.
- `renovate_jobs_repository_id_idx`, `renovate_jobs_repository_started_at_idx` (über `repository_id`, `started_at`),
  `renovate_jobs_status_idx`.

### 3.6 `problems`

Befunde je Repo. Vom Abgleich aus dem Datenbestand abgeleitet (`abgleich.md`, Abschnitt 8).

| Spalte | Bedeutung |
|---|---|
| `repository_id` | FK auf `repositories`, `ON DELETE cascade`. |
| `kind` | Enum `problem_kind`. |
| `message` | Text für die Oberfläche, aus den Regeln erzeugt. |
| `first_seen_at` | Erstes Auftreten. |
| `last_seen_at` | Letzter Durchlauf, in dem der Befund noch galt. |
| `resolved_at` | Behoben. Gesetzt, sobald der Befund in einem Durchlauf nicht mehr gilt. Offene Probleme haben `NULL`. |
| `dedupe_key` | Unterscheidet mehrere Befunde gleicher Art je Repo, etwa die PR-Nummer. Sonst leerer Text. |

Indizes:

- `problems_open_key` (eindeutig über `repository_id`, `kind`, `dedupe_key`, partiell `WHERE resolved_at IS NULL`):
  höchstens ein offener Befund je Repo, Art und Schlüssel. Behobene Befunde dürfen erneut entstehen, weil sie außerhalb
  des Index liegen. Der Index dient zugleich als Suche nach offenen Problemen (Übersicht, Probleme-Seite).
- `problems_repository_id_idx`.

### 3.7 `rollout_actions`

Rollout-Vorgang: ein Onboarding- oder Build-Check-PR, den das Dashboard anlegt. Vertrag und Ablauf in `rollout.md`.

| Spalte | Bedeutung |
|---|---|
| `repository_id` | FK auf `repositories`, `ON DELETE cascade`. |
| `kind` | `onboarding` oder `build_check`. |
| `triggered_by` | Authelia-Nutzer oder `auto` (automatisches Onboarding). |
| `pr_url`, `pr_number` | Link und Nummer des angelegten PR. |
| `status` | `pending` (Vorgang läuft), `pr_open`, `merged`, `failed`, `closed`. |
| `error` | Meldung bei Fehlschlag oder Abbruch, ohne Werte aus der Plattform. |
| `created_at` | Beginn des Vorgangs. Ein `pending`-Vorgang, der älter als 10 Minuten ist, wird als abgebrochen gewertet (`PENDING_TIMEOUT_MS`). |

Indizes:

- `rollout_actions_open_key` (eindeutig über `repository_id`, `kind`, partiell `WHERE status IN ('pending', 'pr_open')`):
  höchstens ein offener Rollout je Repo und Art.
- `rollout_actions_repository_id_idx`, `rollout_actions_repository_kind_status_idx` (über `repository_id`, `kind`, `status`).

### 3.8 `audit_log`

Protokoll der Aktionen in der Oberfläche. Nur Einfügen, kein Ändern.

| Spalte | Bedeutung |
|---|---|
| `actor` | Authelia-Nutzer, der die Aktion ausgelöst hat (oder `auto`). |
| `action` | Art der Aktion. Vorkommende Werte: `job.trigger`, `job.trigger_all`, `repo.own_ci`, `settings.auto_onboarding`, `rollout.onboarding`, `rollout.build_check`, `rollout.onboarding.failed`, `rollout.build_check.failed`. |
| `target` | Ziel der Aktion, als Text (etwa der Repo-Name). |
| `created_at` | Zeitpunkt. |

Index: `audit_log_created_at_idx`.

### 3.9 `sync_state`

Abgleich-Stempel je Quelle. Eine Zeile je Quelle: `github` und `ce`. Auswertung in `abgleich.md`, Abschnitt 10.

| Spalte | Bedeutung |
|---|---|
| `source` | Primärschlüssel (Text). |
| `last_success_at` | Ende des letzten Durchlaufs ohne Pause. Teilfehler zählen dabei nicht als Pause, stehen aber in `partial_errors`. Bei einer Pause bleibt der letzte Wert stehen. Ein Fehler auf Durchlaufebene setzt ihn nicht zurück. |
| `last_error_at`, `last_error_message` | Letzter Fehler auf Durchlaufebene. Die Meldung ist nur eine Fehlerkategorie, keine Rohmeldung. |
| `partial_errors` | JSON-Array `{repository, message}` der Teilfehler des letzten Durchlaufs. Ersetzt den vorherigen Stand. |
| `paused_at`, `paused_until`, `pause_note` | Kontingent-Pause: Zeitpunkt, Ende und Notiz. Format der Notiz (`pauseOutcome`, `sync-state.ts`): `Kontingent knapp (<übrig> von <Limit> übrig)`. Gelöscht, sobald ein Durchlauf ohne Pause endet. |

### 3.10 `http_cache`

ETag-Cache für bedingte Anfragen an GitHub.

| Spalte | Bedeutung |
|---|---|
| `key` | Primärschlüssel (Text): `Scope\|Route\|Parameter`, sortiert (`cacheKey` im GitHub-Adapter). |
| `etag` | ETag der letzten Antwort. |
| `body` | Letzte Antwort als JSON. Bei `304` wird dieser Stand verwendet. |
| `updated_at` | Letzter Schreibzugriff. Einträge älter als 7 Tage werden am Ende des GitHub-Durchlaufs gelöscht. |

## 4. Löschverhalten

Die Foreign Keys und der Code sind hier getrennt zu lesen.

| Beziehung | Regel in der Datenbank | Verhalten im Code |
|---|---|---|
| `platform_connections.tenant_id` → `tenants` | `ON DELETE restrict` | Kein Löschen von Mandanten im Code. |
| `repositories.connection_id` → `platform_connections` | `ON DELETE cascade` | Verbindungen werden im Code nie gelöscht. Entfernte Installationen setzen nur `repositories.removed_at` (`markRemovedInstallations`). |
| `pull_requests`, `renovate_jobs`, `problems`, `rollout_actions` → `repositories` | `ON DELETE cascade` | Repos werden im Code nie gelöscht. Verschwundene Repos bekommen `removed_at`. |
| `rollout_actions` (Zeilen) | Kein Löschen durch die DB. | Der Code löscht eine Zeile in zwei Fällen (`src/rollout/service.ts`): Dateien existieren schon und der PR ist nicht nötig, sowie ein Kontingent-Abbruch (Rücknahme ohne Spur, damit das Repo später erneut drankommt). |
| `http_cache` (Zeilen) | Kein Löschen durch die DB. | Einträge mit `updated_at` älter als 7 Tage werden am Ende des GitHub-Durchlaufs gelöscht. |
| `renovate_jobs` | Kein Löschen. | Verschwundene Läufe werden auf `failed` mit `status_raw = 'verschwunden'` gesetzt. Läufe, die die CE als `purged` führt, bleiben stehen und zählen nicht als Ergebnis. |
| `audit_log`, `problems` | Kein Löschen. | Probleme werden behoben (`resolved_at`), nie gelöscht. |

## 5. Migrationen

Ordner `dashboard/drizzle/`. Journal: `drizzle/meta/_journal.json` (Einträge mit `idx`, `tag`, `when`). Je Migration ein
Snapshot unter `drizzle/meta/`.

| Datei | Inhalt in einem Satz |
|---|---|
| `0000_deep_midnight.sql` | Ausgangsschema: zwölf Enums, zehn Tabellen (`audit_log` bis `tenants`), Fremdschlüssel, eindeutige und normale Indizes sowie die partiellen Indizes aus Abschnitt 3. |
| `0001_late_red_shift.sql` | Ergänzt `renovate_jobs.artifact_error_count` sowie `sync_state.paused_at`, `paused_until` und `pause_note` für die Kontingent-Pause. |
| `0002_renovate_jobs_created_at.sql` | Ergänzt `renovate_jobs.created_at` (Standard `now()`), damit verschwundene Läufe ohne Startzeit erkannt werden. |

Die Snapshots `0000_snapshot.json`, `0001_snapshot.json` und `0002_snapshot.json` gehören zu den Migrationen. `drizzle-kit`
erzeugt sie bei `db:generate`.

## 6. Ablauf: Schema ändern und migrieren

1. Schema in `src/db/schema.ts` ändern.
2. `npm run db:generate` (Skript `db:generate` = `drizzle-kit generate`, Konfiguration in `drizzle.config.ts`). Der Befehl
   braucht keine Datenbank. Er schreibt eine neue SQL-Datei, den Snapshot und den Journal-Eintrag nach `drizzle/`.
3. Die neuen Dateien mit einbauen. Das Image kopiert `drizzle/` (siehe `betrieb.md`, Abschnitt 2).
4. Beim Containerstart läuft `node migrate.js` (`src/db/migrate-cli.ts`) vor dem Server. Er ruft `runMigrations`
   (`src/db/migrate.ts`) auf:
   - Eigene Verbindung über `pg` (`new Client`).
   - `select pg_advisory_lock(7260011001)`: Sperre auf Sitzungsebene mit fester Schlüsselnummer
     (`MIGRATION_LOCK_KEY`). Der Aufruf wartet, bis eine andere Instanz die Sperre freigibt.
   - Zählt die angewendeten Migrationen, wendet die offenen mit dem Drizzle-Migrator aus `process.cwd()/drizzle` an und zählt
     erneut. Das Protokoll liegt in `drizzle.__drizzle_migrations`.
   - Legt den Mandanten „Krinke IT“ an, nur wenn `tenants` leer ist. Ein umbenannter Mandant bleibt unangetastet.
   - Gibt die Sperre frei und schließt die Verbindung.
5. Der Migrationstest (`src/db/migrate.test.ts`, Task 3.2) prüft den Fall, dass zwei Läufe gleichzeitig starten, und den
   einmaligen Mandanten.
6. Die Gesundheitsprüfung vergleicht danach Journal und Protokoll (`betrieb.md`, Abschnitt 4).

Die Verbindung kommt aus `DATABASE_URL` (Benutzer und Datenbank `dashboard`, siehe `deploy/docker-compose.yaml`).
Die Zugangsdaten selbst stehen nicht in diesem Dokument.

## 7. Offene Punkte

- TODO: `repositories.detected_ecosystems` wird im Abgleich nicht befüllt. Die Spalte steht im Schema und in der Migration
  `0000_deep_midnight.sql`, und im Repo setzen nur die Testdaten in `src/db/fixtures.ts` Werte. Offen ist, ob die
  Erkennung noch kommt oder die Spalte entfällt. Entscheidung durch den Betreiber.
