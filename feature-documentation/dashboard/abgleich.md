# Dashboard: Abgleich mit GitHub und Renovate CE

Stand: 2026-10-22. Quellen: `dashboard/src/sync/*` (Scheduler, Locks, Durchläufe, Probleme, Rollout-Nachzug, Stempel),
`dashboard/src/platform/*` (Plattformschicht, Head-SHA, Kontingent, ETag-Cache), `dashboard/src/platform/github/*`
(GitHub-Adapter), `dashboard/src/ce/*` (CE-Client, Mapping, Log-Auszug), `dashboard/src/domain/*` (Ableitungen),
`dashboard/src/rollout/auto-onboarding.ts`, `dashboard/src/instrumentation.ts`.
Die Tabellen sind in `datenmodell.md` beschrieben. Die Entscheidungen stehen in `openspec/changes/dashboard/design.md`
(Entscheidungen 2, 5, 6, 7).

## 1. Überblick

Der Abgleich holt den Zustand aus zwei Quellen in die Datenbank:

- **GitHub** (`src/sync/github-sync.ts`): Installationen, Repos, Head-SHA, Konfiguration, Build-Check, Renovate-PRs,
  CI-Status, Dependency-Dashboard-Issue.
- **Renovate CE** (`src/sync/ce-sync.ts`): Repo-Status der Reporting-API, Queue, Job-Historie, Log-Auszüge.

Danach bewertet der Abgleich die Probleme neu (`src/sync/problems-sync.ts`). Die Seiten lesen nur aus der Datenbank.
Schreibende Aktionen der Oberfläche (`aktionen.md`) rufen CE und GitHub dagegen direkt auf.

Der Abgleich startet im Next-Hook `src/instrumentation.ts` (`register()`) über `startSyncFromEnv()`
(`src/sync/scheduler.ts`). Er läuft nur in der Node-Laufzeit, nie beim Build. Fehlt ein Wert im Env-Schema, startet nichts
(`betrieb.md`, Abschnitt 3). Mehrfachaufrufe starten nichts doppelt: Der Zustand liegt in `globalThis` unter einem Symbol.

## 2. Intervalle und Advisory-Locks

Konstanten in `src/sync/scheduler.ts`:

| Konstante | Wert | Wirkung |
|---|---|---|
| `GITHUB_INTERVAL_MS` | 5 Minuten | Intervall des GitHub-Durchlaufs |
| `CE_INTERVAL_MS` | 1 Minute | Intervall des CE-Durchlaufs |
| `FIRST_RUN_DELAY_MS` | 10 Sekunden | Verzögerung des ersten Durchlaufs nach dem Start, je Quelle |

Die Timer sind mit `unref()` gesetzt und halten den Prozess nicht am Leben.

Schutz gegen Überlappung, zweistufig:

1. **Im Prozess:** Ein Set `busy` merkt sich die laufende Quelle. Ein neuer Auslöser für dieselbe Quelle kehrt mit `false` zurück.
2. **Über Instanzen hinweg:** `pg_try_advisory_lock` mit festen Schlüsseln (`src/sync/lock.ts`, `SYNC_LOCK_KEYS`):

| Sperre | Schlüssel | Geschützt |
|---|---|---|
| `github` | `7260011101` | GitHub-Durchlauf |
| `ce` | `7260011102` | CE-Durchlauf |
| `problems` | `7260011103` | Neubewertung der Probleme |

`withAdvisoryLock` reserviert für die Dauer des Durchlaufs eine eigene Verbindung aus dem Pool, setzt den Lock auf dieser
Verbindung und gibt ihn danach frei. Ist der Lock belegt, endet der Aufruf mit `ran: false`, ohne Eintrag in `sync_state`.
Bricht die Verbindung ab, wird sie verworfen, damit auch der Lock endet. Der Prozess läuft weiter.

Die Problemsperre ist getrennt, damit GitHub- und CE-Abgleich die Probleme nie parallel bewerten. Ist sie belegt, wird die
Bewertung übersprungen (`skipped: true`). Der nächste Durchlauf bewertet erneut.

Ein Durchlauf, der mit einer Exception endet (nicht nur Teilfehler), wird von `run()` gefangen. Der Scheduler schreibt
dann die Fehlerkategorie nach `sync_state` (`recordFailure`) und loggt `Abgleich <Quelle> fehlgeschlagen: <Kategorie>`.

## 3. Ablauf GitHub (`runGithubSync`)

Reihenfolge der Schritte:

1. **Mandant.** Der älteste Mandant (`orderBy created_at`, `limit 1`). Fehlt er, wirft der Durchlauf `Kein Tenant vorhanden`.
2. **Installationen.** `adapter.listConnections()`: `GET /app/installations`, paginiert. Installationen ohne Konto oder mit
   `suspended_at` fallen heraus.
3. **Entfernte Installationen.** Repos von Verbindungen, deren Installation in der Liste fehlt, bekommen `removed_at`.
   Das geschieht nur nach erfolgreichem Abruf. Bei Fehler oder Pause bleibt der Stand unverändert.
4. **Verbindung je Installation** (`upsertConnection`). Zuerst über `installation_id`, danach über den Owner einer
   Verbindung ohne Installations-ID (von Hand angelegt; sie bekommt dann die ID), sonst neu. Ein geänderter Owner-Name
   wird nachgezogen. Ein Fehler hier ist ein Teilfehler dieser Installation, die übrigen laufen weiter.
5. **Repo-Liste** (`syncRepositoryList`). `adapter.listRepositories()`:
   - Neue Repos werden angelegt. `first_seen_at` ist der Zeitpunkt des Einfügens.
   - Geänderte Felder (`full_name`, `default_branch`, `archived`) werden nachgezogen. Ein Repo mit `removed_at` kommt
     zurück: `removed_at` wird wieder `NULL`.
   - Repos, die fehlen, bekommen `removed_at`. Zeilen werden nie gelöscht.
6. **Repos der Verbindung.** Nicht archiviert und nicht entfernt. Sortierung `synced_at ASC NULLS FIRST`, damit nach
   einer Pause nicht immer dieselben Repos am Ende liegen.
7. **Rollout-Nachzug** (`syncRolloutActions`), siehe Abschnitt 9.
8. **Je Repo** (`syncRepository`):
   1. Head-SHA und Inhalt (Abschnitt 4).
   2. Inhalt und Status speichern (`saveContentState`) in einer Transaktion mit Zeilensperre. Die Werte `ce_status` und
      `own_ci` werden dabei frisch gelesen, damit ein parallel gesetzter CE-Status nicht überschrieben wird.
   3. Pull Requests (`syncPullRequests`). Ein Fehler hier ist ein Teilfehler, der gespeicherte Stand bleibt.
   4. Dependency-Dashboard-Link (`findDependencyDashboard`). Bei Fehler bleibt der alte Link stehen (Teilfehler).
   5. `synced_at` wird auf den Zeitpunkt des Durchlaufs gesetzt.
9. **Automatisches Onboarding** (`runAutoOnboarding`), nach allen Verbindungen, nur wenn ein Rollout-Service vorhanden ist.
   Abschnitt 9.
10. **Aufräumen des ETag-Cache.** Einträge in `http_cache` mit `updated_at` älter als 7 Tage werden gelöscht
    (`HTTP_CACHE_MAX_AGE_MS`).
11. **Probleme** (`syncProblems`), danach `recordRun("github", …)` in `sync_state`.

Fehlerbehandlung:

- Ein Fehler je Repo wird gefangen und als Teilfehler `{repository, message}` vermerkt. Der Rest läuft weiter.
- `RateLimitPause` wird weitergereicht und beendet den Durchlauf sauber (Abschnitt 6).
- Ein anderer Fehler außerhalb dieser Fangstellen, etwa beim Auflisten der Installationen, beendet den Durchlauf mit einer
  Exception. Dann laufen Aufräumen, Problembewertung und `recordRun` nicht. Der Scheduler vermerkt nur den Fehler.
- Fehlermeldungen in `sync_state` sind Kategorien (Abschnitt 10), keine Rohmeldungen.

Pull Requests (`syncPullRequests`):

- Gelistet werden offene PRs mit Head-Branch-Präfix `renovate/`, ohne `renovate/configure`, und vom Bot-Konto der App
  (`GET /repos/{owner}/{repo}/pulls`, sortiert nach `updated`). Die Rollout-PRs (`renovate-platform/…`) fallen damit heraus.
- Jeder PR wird per Upsert über `(repository_id, number)` gespeichert. Der Update-Typ kommt aus den Labels.
- Der CI-Status wird neu gelesen, wenn der PR neu ist, nicht mehr offen war, der Head-SHA sich geändert hat oder der
  letzte Stand nicht `success` ist (Checks laufen oft nach dem Push zu Ende; ein Rerun kann Rot in Grün ändern).
- PRs, die in der Datenbank offen stehen, aber nicht mehr gelistet sind, bekommen ihren Endzustand über
  `getPullRequestState` (`merged` oder `closed`).
- Dependency-Dashboard (`findDependencyDashboard`): Das älteste Issue des Bots mit dem Titel `Dependency Dashboard` (ohne
  PRs), aufsteigend nach Erstellung gelesen. Nach dem ersten Treffer wird nicht weitergeblättert.

Die Erkennung der Konfiguration und des Build-Checks steht in Abschnitt 4.

## 4. Head-SHA-Gating

`src/platform/refresh.ts` (`refreshRepositoryState`) entscheidet, ob Inhalte gelesen werden:

1. `getHeadSha`: `GET /repos/{owner}/{repo}/commits/{ref}` mit `ref` = Default-Branch und dem Medientyp
   `application/vnd.github.sha`. Die Antwort ist nur der SHA-Text. Ein leeres Repo (Antwort 404 oder 409) ergibt `null`.
2. **Leeres Repo:** Kein Inhalt. Der Zustand ist `configPath = null`, `hasBuildCheck = false`. PRs und Dashboard-Suche laufen
   trotzdem.
3. **SHA unverändert** gegenüber `repositories.head_sha`: Kein Inhalt wird gelesen (`state: null`). Der gespeicherte Stand
   gilt, auch für `build_check_status = active`.
4. **SHA geändert:** `getRepositoryState(headSha)` liest den Inhalt zu genau diesem SHA:
   - **Konfiguration:** Die Liste `RENOVATE_CONFIG_PATHS` (`src/platform/renovate-files.ts`) wird in dieser Reihenfolge geprüft:
     `renovate.json`, `renovate.json5`, `.github/renovate.json`, `.github/renovate.json5`, `.gitlab/renovate.json`,
     `.gitlab/renovate.json5`, `.renovaterc`, `.renovaterc.json`, `.renovaterc.json5`. Der erste Treffer ist `config_path`.
     Unterordner werden nur gelistet, wenn sie im Wurzelverzeichnis existieren.
   - **Build-Check** (`hasBuildCheck`): Liegt `.github/workflows/build-check.yml` vor und enthält es den Verweis
     `Krinke-IT-Consulting/renovate/.github/workflows/build-check.yml@` (`BUILD_CHECK_CALLER_MARKER`), gilt die Aufrufdatei als
     aktiv. Im Quell-Repo `Krinke-IT-Consulting/renovate` zählt zusätzlich `build-check-self.yml` mit dem Verweis
     `uses: ./.github/workflows/build-check.yml`.
   - Inhaltsabrufe nutzen `noCache` (kein ETag). Ein Fester SHA ändert sich nicht, daher wird der Inhalt je SHA einmal gelesen.
5. Der neue SHA wird sofort gespeichert (`saveContentState`), auch wenn der PR-Teil später scheitert.

Aus dem Stand werden die beiden Status abgeleitet (`src/domain/repo-status.ts`). Ihre Regeln stehen in `datenmodell.md`,
Abschnitt 3.3.

## 5. ETag-Cache (`http_cache`)

- Jede Leseanfrage über den GitHub-Adapter (`private get` in `src/platform/github/adapter.ts`) prüft zuerst den Cache,
  außer sie ist als `noCache` markiert (Inhaltsabrufe, Abschnitt 4). Ist ein Eintrag da, geht der Header `if-none-match`
  mit dem gespeicherten ETag mit.
- Antwortet GitHub mit `304`, kommt die gespeicherte Antwort zurück. Laut Kommentar im Adapter kostet eine 304-Antwort
  kein Kontingent.
- Bei `200` mit ETag wird `(key, etag, body)` per Upsert geschrieben (`DbHttpCache.set`). Ohne ETag oder mit `noCache`
  passiert nichts.
- Schlüssel: `Scope|Route|Parameter`, Parameter sortiert (`cacheKey`). Scope ist die Installations-ID der Verbindung oder
  `app` für Anfragen an die App selbst.
- Aufräumen nach 7 Tagen: Abschnitt 3, Schritt 10.
- Ohne Datenbank nutzt der Adapter `MemoryHttpCache` (Tests und lokale Läufe).

Ausgenommen vom Cache: Inhaltsabrufe (`noCache`), weil sie an einen festen SHA gebunden sind. Schreibende Anfragen (POST, DELETE)
gehen ohne Cache (`private async write`, Kommentar im Adapter).

## 6. Kontingent-Pause (`RateLimitPause`)

**Schwelle.** Nach jeder Antwort merkt sich der Adapter die Header `x-ratelimit-remaining` und `x-ratelimit-limit`
je Scope. Vor jeder Lese- (`get`) und schreibenden Anfrage (`write`) im selben Scope gilt:

> Pause, wenn `remaining < max(20 % von limit, 400)`

Konstanten: `RATE_LIMIT_PAUSE_FRACTION = 0.2`, `RATE_LIMIT_PAUSE_FLOOR = 400`. Der Pausenzeitpunkt ist `x-ratelimit-reset`
(Sekunden seit Epoch). Fehlt er, gilt ein Rückfall von 5 Minuten (`FALLBACK_PAUSE_MS`). Ist der Reset erreicht, wird die Pause
aufgehoben.

**Sekundäres Limit** (`throwIfRateLimited`, bei Status 403 oder 429):

- Kein Rate-Limit-Hinweis (kein `remaining = 0`, kein `retry-after`, kein Text mit „rate limit“): Der Fehler bleibt ein
  gewöhnlicher Plattformfehler.
- `retry-after` gesetzt: Pause für so viele Sekunden.
- `remaining = 0`: Pause bis zum gemerkten Reset, sonst 5 Minuten.
- Sonst (Hinweis auf ein Limit ohne `retry-after` und ohne leeres Kontingent): mindestens 60 Sekunden
  (`SECONDARY_LIMIT_MIN_PAUSE_MS`).

**Wirkung im Durchlauf.** `RateLimitPause` wird bis zum Durchlauf weitergereicht:

- Der GitHub-Durchlauf endet, nicht nur der betroffene Owner. Der Fehler wird als Pause vermerkt, nicht als Fehler.
- `sync_state.paused_at`, `paused_until` und `pause_note` werden gesetzt. Format der Notiz: `Kontingent knapp (<übrig> von <Limit> übrig)`.
  Der Stempel zeigt `pausiert bis <Uhrzeit>` (Abschnitt 10).
- `last_success_at` bleibt auf dem letzten erfolgreichen Durchlauf stehen.
- Aufräumen, Problembewertung und der Vermerk im Stempel laufen trotzdem, weil die Pause außerhalb der Hauptschleife gefangen wird.
- Die Pause gilt im Prozess (`this.rate`). Der nächste Lauf im Intervall prüft sie erneut. Ein Lauf in einer anderen
  Instanz kennt sie nicht; das ist im Code nicht geregelt.
- Ausnahme: Das Aufräumen eines angelegten Rollout-Branches (`deleteRef`, Option `bypassPause`) läuft auch während einer
  Pause. Die Begründung im Code: Der Aufräumversuch soll auch bei knappem Kontingent genau einmal stattfinden.
- Die Pause betrifft nur GitHub. Der CE-Abgleich kennt keine Kontingent-Pause (`ce-sync.ts` importiert `RateLimitPause` nicht).

Test: `sync.test.ts`, „vermerkt RateLimitPause und endet ohne Exception“.

## 7. Ablauf CE (`runCeSync`)

Der CE-Durchlauf läuft gegen die Datenbank-Zeilen aller Repos, die nicht entfernt sind (auch archivierte, für die Historie
gilt eine eigene Regel). Er arbeitet in dieser Reihenfolge:

**Zuordnung.** Repos werden über den vollen Namen zugeordnet, ohne Groß- und Kleinschreibung. Tragen mehrere Repos denselben
Namen (etwa nach einer Übertragung über zwei Verbindungen), wird der Name nicht zugeordnet und als Teilfehler
`Mehrdeutige Zuordnung (mehrere Repos mit gleichem Namen)` gemeldet.

**1. Repo-Status je Owner.** `listOrgs()` (`GET /api/v1/orgs`), dann je Organisation `listOrgRepos(org)`
(`GET /api/v1/orgs/{org}/-/repos`). Stimmt Owner und Name, wird `repositories.ce_status` auf den CE-Rohwert gesetzt, und
`onboarding_status` wird neu abgeleitet. Das geschieht in einer Transaktion mit Zeilensperre. Ein Fehler je Organisation ist
ein Teilfehler.

**2. Queue.** `getQueue()` (`GET /system/v1/jobs/queue`): Einträge in `running` und `pending`. Für jeden Eintrag mit bekanntem
Repo (über `repository` oder `organizationName` + Name) wird ein Upsert nach `ce_job_id` gemacht:

- `running` → Status `running`, `pending` → Status `queued`. `status_raw` bekommt denselben Wert.
- `trigger` aus `reason` (`mapReasonToTrigger`, `src/ce/mapping.ts`, Werte in `datenmodell.md`, Abschnitt 3.5), `reason` unverändert.
- Ein Konflikt überschreibt nur Zeilen, die noch `queued` oder `running` sind (`setWhere`). Beendete Läufe werden nie
  zurückgesetzt.
- Eine fehlende Startzeit überschreibt keine gespeicherte (`coalesce`).

Schlägt die Queue fehl, wird `(Queue)` als Teilfehler vermerkt. Dann findet die Prüfung auf verschwundene Läufe nicht statt.

**3. Historie je bekanntem, nicht archiviertem Repo.** `listRepoJobs(full_name, 20)`:
`GET /api/v1/repos/{org}/{repo}/-/jobs?limit=20`. Jeder Eintrag wird per Upsert nach `ce_job_id` geschrieben, auch wenn er
schon in der Queue stand.

Abbildung des CE-Status (`src/ce/mapping.ts`, `mapJobStatus`):

| CE-Rohwert | `status` | Hinweis |
|---|---|---|
| `success` | `success` | Endzustand |
| `running`, `processing`, `in-progress` | `running` | Laufend, auch in der Historie |
| `queued`, `pending`, `waiting` | `queued` | Wartend, auch in der Historie |
| alles andere (etwa `failed`, `purged`) | `failed` | Endzustand; der Rohwert bleibt in `status_raw` |

Die Historie führt auch laufende und wartende Läufe. Ein Lauf, der dort als `running` steht, bleibt `running` und
erzeugt kein Problem (Test „ein laufender Job in der Historie bleibt laufend und erzeugt kein Problem“).

Weitere Felder: `started_at`, `finished_at` von der CE (fehlende Werte überschreiben nicht), `error_message` aus
`error.name: error.message` (höchstens 300 Zeichen, Leerraum zusammengezogen), `artifact_error_count` aus der Länge von
`artifactErrors`.

**Log-Auszüge.** Für jeden fehlgeschlagenen Lauf der Historie, der noch keinen `log_excerpt` hat und nicht `purged` ist,
wird `getJobLog(ceJobId)` aufgerufen (`GET /system/v1/jobs/logs/{jobId}`). Begrenzung: höchstens 10 Abrufe je Durchlauf
(`MAX_LOG_FETCHES_PER_RUN`), über alle Repos. Der Rest folgt im nächsten Durchlauf.

- Antwort `404` oder `410`: Der Auszug wird leer gesetzt (`""`) und nicht erneut versucht. Ein leerer Auszug heißt:
  abgerufen, nichts Verwertbares.
- Anderer Fehler: Ein Teilfehler je Repo (`Log: <Kategorie>`), der Versuch wird im nächsten Durchlauf wiederholt.

Aufbereitung (`src/ce/log-excerpt.ts`, `extractLogExcerpt`):

- Die CE liefert JSON-Zeilen im Bunyan-Format. Nur Zeilen, die mit `{` beginnen und gültiges JSON sind, werden gelesen.
- Nur Einträge mit `level >= 40` (warn, error, fatal).
- Je Zeile bleiben `time` (als `HH:MM:SS` in UTC), das Level als `WARN`, `ERROR` oder `FATAL`, `msg`, sowie `err.name` und `err.message`.
- Felder, deren Name `token`, `password`, `secret` oder `key` enthält (ohne Beachtung der Groß- und Kleinschreibung), werden
  rekursiv entfernt.
- Es bleiben höchstens die letzten 200 Zeilen und höchstens 16 KB, von hinten aufgefüllt.

**Letzter Lauf.** `lastJobAt` und `lastJobResult` kommen aus dem jüngsten beendeten Lauf der Historie (`success` oder
`failed`, ohne `purged`). Laufende und wartende Läufe zählen dafür nicht.

**4. Verschwundene Läufe** (`markVanishedJobs`), nur wenn die Queue gelesen wurde. Ein Lauf in der Datenbank mit Status
`queued` oder `running` wird auf `failed` mit `status_raw = 'verschwunden'` gesetzt, wenn er:

- nicht in der Queue steht und in der Historie nicht als offen geführt wird, und
- entweder zu einem archivierten oder entfernten Repo gehört (sofort), oder
- zu einem Repo gehört, dessen Historie in diesem Durchlauf gelesen wurde, und `startedAt` (sonst `createdAt`) mehr als
  6 Stunden zurückliegt (`VANISHED_JOB_AGE_MS`).

Der Stand wird über die Historie (nicht nur über die Queue) geprüft, damit ein Lauf, der noch in der Historie als offen steht,
nicht fälschlich verschwindet.

**Ende.** `syncProblems`, danach `recordRun("ce", …)`.

## 8. Probleme (`syncProblems`, `deriveProblems`)

Die Probleme werden je Repo aus dem Datenbankzustand neu abgeleitet. Die Datenbankwerte stammen aus dem GitHub- und
CE-Durchlauf. Die Bewertung läuft am Ende beider Durchläufe, unter der Problemsperre (Abschnitt 2).

Eingaben je Repo:

- Letzter beendeter Lauf (`success` oder `failed`, ohne `purged`), sortiert nach `coalesce(finished_at, started_at)` absteigend.
  Laufende und wartende Läufe verdecken ihn nicht.
- Offene PRs (`state = open`): Nummer, Update-Typ, CI-Status, Erstellungszeit.
- Repo-Status: Archiv, Entfernung, `onboarding_status`, `build_check_status`, `ce_status`.

Regeln (`src/domain/problems.ts`). Ein archiviertes oder entferntes Repo hat keine Probleme.

| Art | Bedingung | `dedupe_key` | Meldung (Kurzform) |
|---|---|---|---|
| `config_error` | `ce_status = failed`, oder letzter Lauf `failed` und Fehlername oder -meldung passt zu `/config\|validation/i` | leer | „Renovate meldet einen Konfigurationsfehler.“ |
| `lockfile_failure` | letzter Lauf hat `artifact_error_count > 0` (auch wenn der Lauf `success` ist) | leer | „Lockfiles konnten im letzten Lauf nicht aktualisiert werden.“ |
| `job_failed` | letzter Lauf `failed`, und weder `config_error` noch `lockfile_failure` treffen zu | leer | „Der letzte Renovate-Lauf ist fehlgeschlagen.“ |
| `stale_pr` | offener PR älter als 14 Tage, bei Update-Typ `security` älter als 7 Tage | PR-Nummer | „PR #n ist seit X Tagen offen (Grenze N Tage).“ (X aufgerundet) |
| `ci_red` | offener PR mit CI-Status `failure` | PR-Nummer | „PR #n: CI ist fehlgeschlagen.“ |
| `missing_build_check` | `onboarding_status = onboarded` und `build_check_status = missing` | leer | „Der Build-Check ist nicht eingerichtet.“ |

Die Schwellen sind Konstanten: `STALE_PR_DAYS = 14`, `STALE_SECURITY_PR_DAYS = 7`. „Älter“ heißt strikt mehr als die
Grenze in Millisekunden, gemessen an `created_at` des PR.

**Abgleich** (`reconcileProblems`, `src/domain/problems.ts`). Verglichen werden die offenen Probleme (`resolved_at IS NULL`)
mit den abgeleiteten nach dem Paar `(kind, dedupe_key)`:

- Neu: Einfügen mit `first_seen_at = now`. Der Teil-Unique-Index (`problems_open_key`) verhindert ein Doppel; ein paralleler
  Eintrag ist kein Fehler (`onConflictDoNothing`).
- Weiterhin da: `last_seen_at = now` und die Meldung wird aktualisiert.
- Nicht mehr da: `resolved_at = now`.

Ein behobenes Problem bekommt also `resolved_at`. Taucht es später wieder auf, entsteht eine neue Zeile.

Test: „bewertet ein behobenes Problem neu und setzt resolved_at (ci_red -> success)“ in `sync.test.ts`.

## 9. Rollout-Nachzug und automatisches Onboarding

**Nachzug** (`syncRolloutActions`, `src/sync/rollouts.ts`). Läuft im GitHub-Durchlauf je Verbindung, vor dem Repo-Abgleich,
damit der Status stimmt. Für offene Rollouts (`pending` oder `pr_open`):

- `pr_open` mit PR-Nummer: `getPullRequestState` (bedingt). Ist der PR nicht mehr offen, wird `merged` oder `closed`
  gesetzt. Fehler je PR sind Teilfehler; eine Pause wird weitergereicht.
- `pending`, älter als 10 Minuten (`PENDING_TIMEOUT_MS`, `src/rollout/service.ts`): wird `failed` mit der Meldung
  `Abgebrochen: der Rollout wurde nicht abgeschlossen.`

Danach liest `loadOpenRollouts` die offenen Rollouts je Repo. Daraus leitet `saveContentState` ab: `onboarding_status` wird
`pr_open`, wenn ein offener Onboarding-Rollout existiert und keine Konfiguration vorliegt; `build_check_status` wird `pr_open`,
wenn ein offener Build-Check-Rollout existiert und die Aufrufdatei fehlt. Der Ablauf eines Rollouts steht in `rollout.md`.

**Automatisches Onboarding** (`runAutoOnboarding`, `src/rollout/auto-onboarding.ts`). Läuft im GitHub-Durchlauf nach allen
Verbindungen. Die Schritte:

1. Verbindungen mit `auto_onboarding = true` und gesetztem `auto_onboarding_enabled_at`, sortiert nach `owner_name`.
2. Kandidaten je Verbindung. Ein Repo gilt nur, wenn alle Bedingungen zutreffen:
   - `first_seen_at > auto_onboarding_enabled_at` (nach dem Einschalten zum ersten Mal gesehen),
   - nicht archiviert, nicht entfernt,
   - keine Konfiguration (`config_path IS NULL`), `onboarding_status = none`,
   - `head_sha` gesetzt (der Inhalt wurde also gelesen),
   - nie eine Onboarding-Aktion in `rollout_actions`, egal in welchem Status.
3. Höchstens 5 Kandidaten je Verbindung und Durchlauf (`AUTO_ONBOARDING_LIMIT`), älteste zuerst.
4. `rollout.run({ kind: "onboarding", actor: "auto", recordEarlyFailure: true })`. Ein Fehlschlag wird als Teilfehler
   `Automatisches Onboarding: <Meldung>` vermerkt.

Folgen: Ein geschlossener Auto-PR wird nicht wiederholt, weil seine Zeile in `rollout_actions` bleibt. Gleiches gilt für einen
Fehlschlag, der eine Zeile mit Status `failed` hinterlässt; danach ist ein manueller Klick nötig. Entfernt der Rollout seine
Zeile selbst (Kontingent-Pause, Datei existiert schon; siehe `datenmodell.md`, Abschnitt 4), bleibt das Repo ein Kandidat
für den nächsten Durchlauf. Der Schalter ist in der Oberfläche je Owner zu sehen (`aktionen.md`).

Tests in `sync.test.ts`: „Neues Repo bei eingeschaltetem Schalter: PR beim nächsten Abgleich, Repos davor nicht“,
„Geschlossener Onboarding-PR: kein neuer automatischer PR“, „legt höchstens 5 PRs je Durchlauf an und holt den Rest im nächsten“.

## 10. `sync_state` und Abgleich-Stempel

Eine Zeile je Quelle (`github`, `ce`) in `sync_state` (`src/sync/sync-state.ts`, Schema in `datenmodell.md`, Abschnitt 3.9).

Schreibvorgänge:

| Ereignis | Schreibt |
|---|---|
| Durchlauf ohne Pause beendet (auch mit Teilfehlern) | `last_success_at = now`, `partial_errors` ersetzt, Pause-Felder geleert |
| Durchlauf durch Pause beendet | `partial_errors` ersetzt, `paused_at`, `paused_until`, `pause_note` gesetzt; `last_success_at` bleibt |
| Fehler auf Durchlaufebene | `last_error_at = now`, `last_error_message` = Kategorie |

Fehlerkategorien (`errorCategory`, `src/sync/sync-state.ts`). Sie enthalten keine Rohmeldung, keine Header und keine Werte:

| Ursache | Kategorie |
|---|---|
| `RateLimitPause` | `Kontingent knapp` |
| Plattform, Status 0 | `Plattform nicht erreichbar` |
| Plattform, Status n | `Plattform-Fehler (Status n)` |
| CE, ohne Status | `CE nicht erreichbar` |
| CE, Status n | `CE-Fehler (Status n)` |
| Datenbank, SQLSTATE `23505` | `Datenbankfehler (Eindeutigkeitskonflikt)` |
| Datenbank, anderer Code | `Datenbankfehler` |
| sonst | `Unerwarteter Fehler` |

Der Stempel (`src/components/shell/sync-stamp.tsx`, Daten aus `src/queries/sync.ts`) zeigt je Quelle den ersten zutreffenden Zustand:

1. **Fehler**: `lastError` gesetzt. Das ist nur der Fall, wenn der Fehler jünger ist als der letzte Erfolg.
2. **Noch kein Abgleich**: `last_success_at` leer.
3. **Pausiert**: `paused_until` liegt in der Zukunft.
4. **Veraltet**: Der letzte Erfolg liegt mehr als das Dreifache des Intervalls zurück (GitHub 15 Minuten, Renovate 3 Minuten).
5. **Teilfehler**: `partial_errors` ist nicht leer. Die Zahl der betroffenen Repos steht im Detail.
6. **Erfolg**: Uhrzeit des letzten Erfolgs.

Der Stempel steht im Layout (`src/app/layout.tsx`, Daten über `loadSyncStamp`). Die Seite lädt sich alle 60 Sekunden neu
(`router.refresh()`), solange der Tab sichtbar ist, und sofort, wenn er wieder sichtbar wird
(`src/components/shell/auto-refresh.tsx`).

## 11. Tests

- `src/sync/sync.test.ts`: Integrationstests gegen Postgres (ohne `DATABASE_URL` übersprungen). Sie decken Sperren,
  Teilfehler, Head-SHA-Gating, Pause, Rollout-Nachzug, Auto-Onboarding, CE-Historie, Log-Auszug und verschwundene Läufe ab.
- `src/platform/github/adapter.test.ts` (mit msw), `src/platform/refresh.test.ts`: Head-SHA, ETag, Kontingent.
- `src/ce/*.test.ts`: Mapping, Log-Auszug und Client gegen aufgezeichnete Antworten (`src/ce/__fixtures__/recorded-2026-10-15.json`).
- `src/domain/*.test.ts`: Ableitungen und Probleme.

Details zu Fixtures und Befehlen stehen in `tests-und-fixtures.md`.

## 12. Offene Punkte

- TODO: Die Kontingent-Pause gilt pro Prozess. Ob mehrere Instanzen eine gemeinsame Pause brauchen, ist im Code nicht geregelt.
  Der Betrieb läuft mit einem Container (`betrieb.md`, Abschnitt 1).
- TODO: Die Fallback-Werte für ein sekundäres Limit (5 Minuten ohne Reset, mindestens 60 Sekunden ohne `retry-after`) sind
  Annahmen im Code (`adapter.ts`). Im Repo ist kein Nachweis an einer echten GitHub-Antwort vermerkt.
- TODO: Die Schwelle für verschwundene Läufe (6 Stunden, `VANISHED_JOB_AGE_MS`) ist im Code festgelegt. Ein Nachweis an einem
  echten Betriebsfall fehlt im Repo.
