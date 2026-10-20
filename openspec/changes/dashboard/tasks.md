# Tasks

## 1. Vorbereitung

- [x] 1.1 Die aktuellen stabilen Versionen ermitteln und in der Feature-Doku festhalten:
  - Next.js, React, TypeScript, Tailwind CSS, shadcn/ui, TanStack Table
  - Drizzle ORM und drizzle-kit, `pg`
  - `@octokit/app`, zod, Vitest, msw, Playwright
  - `@fontsource/montserrat`, `@fontsource/inter`
  - Node-LTS-Basisimage mit Digest

  Fertig, wenn `npm view <paket> version` und `docker buildx imagetools inspect` je Eintrag eine
  Version bzw. einen Digest liefern.
- [x] 1.2 Jeden genutzten CE-Endpunkt lesend gegen die laufende Instanz prüfen. Der Aufruf läuft
  per `ssh` und `docker exec` im Container `renovate-ce`, das Secret kommt aus dessen Umgebung und
  wird nie ausgegeben. Geprüft werden:
  - `GET /system/v1/status`
  - `GET /system/v1/jobs/queue`
  - `GET /api/v1/repos/Krinke-IT-Consulting/renovate/-/jobs`
  - `GET /system/v1/jobs/logs/latest`

  `GET /api/v1/orgs/{org}/-/repos` braucht die Reporting-API (Task 4.2) und wird nach dem ersten
  Deployment geprüft. Fertig, wenn die Antwortfelder zu design.md Entscheidung 7 passen oder die
  Abweichungen im Design nachgetragen sind.
- [x] 1.3 Die Rechte der GitHub App lesend prüfen, per JWT über `GET /app`, das Ergebnis enthält
  keine Secrets. Benötigt werden:
  - Contents RW, Pull requests RW, Issues RW
  - Workflows RW
  - Checks R, Commit statuses R, Metadata R

  Fertig, wenn die Liste vorliegt. Fehlende Rechte nennt die Zusammenfassung dem Betreiber, und er
  setzt sie von Hand.

## 2. Grundgerüst

- [x] 2.1 Unter `dashboard/` eine Next.js-App anlegen (App Router, TypeScript strict,
  `output: "standalone"`, npm), mit Tailwind und shadcn/ui. Skripte `build`, `typecheck`, `lint`,
  `test`. Fertig, wenn `npm ci && npm run build && npm run typecheck && npm run lint` lokal grün
  ist.
- [x] 2.2 `src/env.ts` mit zod für alle Werte aus design.md Entscheidung 5.
  - Bei Fehlern nennt die Meldung nur Namen.
  - Gelesen wird erst zur Laufzeit, nicht beim Build.

  Fertig, wenn ein Vitest-Test zeigt: Ein fehlender Wert bricht mit dem Namen ab, und die Ausgabe
  enthält keinen Wert. Zusätzlich gelingt `npm run build` ohne gesetzte Variablen.
- [x] 2.3 Vertrauensgrenze laut Entscheidung 4: Middleware mit Vergleich des Proxy-Secrets in
  konstanter Zeit und Pflicht-Header `Remote-User`, Ausnahme `GET /api/health`. Fertig, wenn
  Vitest-Tests drei Fälle abdecken:
  - ohne Secret: 403
  - mit Secret, aber ohne `Remote-User`: 403
  - mit beidem: durchgelassen
- [x] 2.4 App-Shell nach `PRODUCT.md` und Entwurf:
  - Header mit Logo (Dateien aus dem krinke.me-Repo unverändert kopiert)
  - Navigation (Übersicht, Repos, Pull Requests, Jobs, Probleme), Kontoname, Logout-Link zu Authelia
  - Overlay-Menü auf Mobil, Skip-Link
  - Schriften per `@fontsource`
  - Abgleich-Stempel als Komponente, vorerst mit „noch kein Abgleich“

  Alle Seiten zeigen einen Leerzustand. Fertig, wenn die Seiten lokal per Tastatur bedienbar sind
  und bei 375 px Breite nicht waagerecht scrollen.
- [x] 2.5 Dockerfile:
  - mehrstufig, Basisimage gepinnt, als Nicht-Root-Nutzer
  - Startbefehl `node migrate.js && exec node server.js`
  - `GET /api/health` meldet DB-Erreichbarkeit und Migrationsstand

  Fertig, wenn `docker build` ohne Build-Secrets gelingt und der Container gegen eine lokale
  Postgres gesund wird.

## 3. Datenmodell

- [x] 3.1 Drizzle-Schema unter `src/db/schema.ts` mit allen Tabellen aus PRD 4.3 und den
  Ergänzungen aus Entscheidung 3, inklusive Enums, eindeutigen Schlüsseln und Indizes. Erste
  Migration mit `drizzle-kit generate` nach `dashboard/drizzle/`. Fertig, wenn die Migration gegen
  eine leere Postgres fehlerfrei läuft.
- [x] 3.2 `migrate.js`: Migrationen unter `pg_advisory_lock` anwenden, danach den Tenant
  „Krinke IT“ anlegen, falls er fehlt. Fertig, wenn ein Integrationstest zwei Fälle zeigt:
  - Zwei gleichzeitige Läufe wenden jede Migration einmal an.
  - Der Tenant existiert genau einmal.
- [x] 3.3 Der Agent `drizzle-migrations` prüft Schema und Migration. Fertig, wenn seine Befunde
  behoben oder begründet abgelehnt sind.

## 4. Stack und erstes Deployment

- [x] 4.1 `deploy/docker-compose.yaml`: `renovate-placeholder` durch `renovate-dashboard` ersetzen.
  - Build `../dashboard`, `mem_limit: 512m`, Healthcheck, `restart: unless-stopped`
  - Netze `default` und `coolify`
  - `depends_on` auf `postgres` (healthy)
  - Umgebung laut Entscheidung 5
  - Router-Namen bleiben; Middleware-Kette `renovate-authelia@docker`, danach
    `renovate-dashboard-proxy@docker`
  - Die Redirect-Middleware wandert mit
  - `deploy/placeholder/` löschen

  Fertig, wenn `docker compose config --no-interpolate` gültig ist und der Build-Check des Repos
  grün ist.
- [x] 4.2 Renovate CE: `MEND_RNV_API_ENABLE_REPORTING: "true"` ergänzen. Fertig, wenn es in der
  Compose-Datei steht und in der Feature-Doku begründet ist.
- [x] 4.3 `DASHBOARD_PROXY_SECRET` erzeugen (`openssl rand -hex 32`) und sofort per Skript ohne
  Ausgabe in `.env.production` eintragen. `dashboard/.env.local` bekommt einen eigenen, getrennt
  erzeugten Wert für den lokalen Betrieb. Außerdem werden nachgezogen:
  - `.env.example`: neuer Name plus `DATABASE_URL` und `RENOVATE_CE_API_URL` mit Kommentar
  - Kommentare zu `DASHBOARD_DB_PASSWORD` und `MEND_RNV_API_SERVER_SECRET`
  - `secrets-register.md`

  Fertig, wenn `grep -c` den Namen in allen drei Dateien findet, ohne Werte auszugeben.
- [x] 4.4 `.github/workflows/build-check-self.yml` setzt `postgres: true`. Integrationstests lesen
  `DATABASE_URL` und werden ohne sie übersprungen. Fertig, wenn der Build-Check im PR grün ist
  und der Lauf `node · dashboard` die Integrationstests ausgeführt zeigt.
- [x] 4.5 `betrieb-coolify.md` aktualisieren: Dienste, Routing, Proxy-Secret, Secret-Wechsel. PR
  mit den Phasen 2 bis 4; Merge durch den Betreiber. Fertig, wenn der PR gemergt ist.
- [x] 4.7 Nach dem ersten Deployment: Sitzungsprüfung bei Authelia statt Proxy-Secret
  (Entscheidung 4).
  - `DASHBOARD_PROXY_SECRET` aus Code, Compose, `.env.example`, `.env.production`, `.env.local`
    und Secrets-Register entfernen.
  - `AUTHELIA_INTERNAL_URL` ergänzen.

  Fertig, wenn Vitest-Tests vier Fälle abdecken: gültige Sitzung, ungültige Sitzung, Authelia
  nicht erreichbar, gefälschter `Remote-User` wird ignoriert. Außerdem muss der Build-Check grün
  sein.
- [x] 4.6 Nach Freigabe des Betreibers:
  1. Erledigt am 2026-10-15: `DASHBOARD_PROXY_SECRET` gesetzt und deployt; der Ansatz scheiterte (siehe
     4.7). Nach 4.7 die Coolify-Variable einzeln entfernen, nur mit Freigabe.
  2. Deployen.
  3. Prüfen:
     - Der Stack ist gesund.
     - Der Login führt zum Dashboard mit Kontonamen im Kopf.
     - Ein direkter Aufruf aus einem anderen Container im Netz `coolify` liefert 403.
     - `/webhook` antwortet weiter mit 401 ohne Signatur.
     - Die Tabellen existieren in `dashboard`.
  4. Task 1.2 für `orgs/{org}/-/repos` nachholen.

  Fertig, wenn alle Prüfungen bestanden sind und die Ergebnisse in `betrieb-coolify.md` stehen.

## 5. Abgleich

- [ ] 5.1 CE-Client `src/ce/` mit Auth über das Server-Secret, Zeitlimits und Fehlern ohne
  Secret. Mapping der Gründe und Status laut Entscheidung 7. Log-Auszug mit Level- und Feldfilter
  und Längengrenze. Fertig, wenn Vitest-Tests mit aufgezeichneten Antworten aus 1.2 Mapping und
  Filter abdecken, inklusive eines Logs mit einem Feld `token`.
- [x] 5.2 `PlatformAdapter` und `GitHubAdapter` laut Entscheidung 6:
  - Installationen, Repos, Head-SHA
  - Konfigurations- und Build-Check-Datei
  - Renovate-PRs mit Labels, CI-Status, Dependency-Dashboard-Issue
  - ETag-Cache in `http_cache`, Pause unter 20 % Rest-Limit

  Fertig, wenn Vitest-Tests mit msw-Fixtures zeigen:
  - Eine 304-Antwort führt zu keiner Änderung.
  - Ein unveränderter Head-SHA führt zu keinem Inhaltsabruf.
  - Unterhalb des Limits wird pausiert.
- [ ] 5.3 Reine Ableitungen in `src/domain/`: Update-Typ, CI-Status, Onboarding- und
  Build-Check-Status, Probleme laut Spec `dashboard-sync`. Fertig, wenn jedes Scenario der Spec
  einen Vitest-Test hat.
- [x] 5.4 Abgleich-Schleifen in `instrumentation.ts`:
  - GitHub alle 5 Minuten, CE jede Minute
  - je Quelle `pg_try_advisory_lock`
  - Upserts und Problem-Abgleich
  - `sync_state` mit Teilfehlern
  - neue Installation legt eine PlatformConnection an

  Fertig, wenn Integrationstests gegen Postgres zeigen:
  - Ein zweiter Durchlauf startet nicht parallel.
  - Ein fehlerhaftes Repo bricht den Rest nicht ab.
  - Ein behobenes Problem bekommt `resolved_at`.
- [x] 5.5 Der Agent `github-app-integration` prüft Adapter und Abgleich, der `reviewer` den Diff der
  Phase. Danach PR, Merge durch den Betreiber, Deployment nach Freigabe. Fertig, wenn nach dem
  Deployment drei Dinge gelten:
  - Der Abgleich-Stempel zeigt beide Quellen erfolgreich.
  - Die Datenbank enthält die Repos beider Owner.
  - Die Jobs von `Krinke-IT-Consulting/renovate` sind vorhanden.

## 6. Ansichten

- [x] 6.1 `/impeccable shape` für Repos, Repo-Detail, Pull Requests, Jobs und Probleme. Die
  Übersicht ist bereits entworfen. Dabei werden die Monospace-Schrift und die Statusfarben
  entschieden. Fertig, wenn der Betreiber die Entwürfe bestätigt hat und sie in
  `feature-documentation/dashboard/` stehen.
- [x] 6.2 Übersicht als Lagebericht laut Spec `dashboard-views`:
  - Textbausteine in `src/domain/report.ts`
  - Schritte auf der Leiterbahn in fester Reihenfolge, Abhaken als Ring, „weitere X anzeigen“
  - Kennzahlen und Repo-Raster, Filter per Kachel
  - Mobil ein Schritt pro Bildschirm

  Fertig, wenn Vitest-Tests die Scenarios „Zwei Sicherheitsupdates offen“, „Alles erledigt“ und
  „Erster Start“ abdecken und die Seite mit Fixture-Daten auf Desktop und bei 375 px stimmt.
- [ ] 6.3 Repos und Repo-Detail mit TanStack Table, Filtern in der Adresse, Karten auf Mobil, Links
  zu GitHub und zum Dependency-Dashboard-Issue. Fertig, wenn ein Link mit Filter die gefilterte
  Ansicht öffnet und Sortieren per Tastatur geht.
- [x] 6.4 Pull Requests mit Filtern nach Repo, Update-Typ, CI-Status und Automerge. Statusbadges
  mit Text. Fertig, wenn das Scenario „Gefilterte PR-Liste per Link“ im Playwright-Smoke besteht.
- [x] 6.5 Jobs mit Auslöser, Status, Dauer, aufklappbarem und kopierbarem Log-Auszug. Probleme mit
  Umschalter offen/behoben. Fertig, wenn „Log-Auszug“ und „Noch kein Lauf“ im Playwright-Smoke
  bestehen.
- [ ] 6.6 Lade-, Leer- und Fehlerzustände aller Seiten; Abgleich-Stempel mit Fehler und Uhrzeit;
  `router.refresh()` alle 60 s bei sichtbarem Tab. Fertig, wenn der Playwright-Smoke mit
  Fixture-Daten durchläuft, mit `sync_state` im Fehlerzustand.
- [ ] 6.7 `reviewer` für die Phase, PR, Merge durch den Betreiber, Deployment nach Freigabe.
  Fertig, wenn der Betreiber die Ansichten mit echten Daten gesehen hat.

## 7. Aktionen

- [ ] 7.1 Bestätigungsdialog, Server Actions, AuditLog in derselben Transaktion, Meldung mit Link
  oder Fehler. Fertig, wenn ein Test „Abgebrochene Bestätigung“ ohne AuditLog-Eintrag zeigt.
- [ ] 7.2 Läufe anstoßen, für ein Repo und für alle, über `POST /system/v1/jobs/add`. Fertig, wenn
  Tests mit aufgezeichneten Antworten Einzel- und Sammellauf abdecken und `unchanged` keinen
  zweiten Eintrag erzeugt.
- [ ] 7.3 Onboarding-PR laut Entscheidung 10:
  - Vorlagen aus diesem Repo
  - ein Commit über die Git-Data-API, Branch `renovate-platform/onboarding`
  - Idempotenz, Aufräumen im Fehlerfall
  - RolloutAction mit Status
  - PR-Text mit Hinweis auf die Build-Check-Eingaben

  Fertig, wenn msw-Tests vier Fälle abdecken: Erfolg, „Wiederholter Klick“, „Fehlende Rechte“ und
  Aufräumen des Branches.
- [ ] 7.4 Build-Check nachträglich ausrollen (Branch `renovate-platform/build-check`) und
  Markierung „eigene CI“ setzen bzw. aufheben. Fertig, wenn Tests Rollout und Markierung abdecken
  und `missing_build_check` bei „eigene CI“ verschwindet.
- [ ] 7.5 Schalter für automatisches Onboarding je Owner, Standard aus. Er wirkt nur für Repos mit
  `first_seen_at > auto_onboarding_enabled_at`, mit höchstens fünf PRs pro Durchlauf. Ein
  geschlossener Auto-PR wird nicht wiederholt. Fertig, wenn Tests die Scenarios
  „Neues Repo bei eingeschaltetem Schalter“ und „Geschlossener Onboarding-PR“ abdecken.
- [ ] 7.6 `reviewer` und `github-app-integration` prüfen die Phase. PR, Merge durch den Betreiber,
  Deployment nach Freigabe. Fertig, wenn ein Lauf für `Krinke-IT-Consulting/renovate` aus dem
  Dashboard gestartet und in der Job-Liste sichtbar ist.
- [ ] 7.7 Erster echter Onboarding-PR in einem Repo, das der Betreiber benennt, nur nach dessen
  Freigabe. Fertig, wenn der PR existiert, im Dashboard verlinkt ist und der Build-Check darin
  läuft.

## 8. Abschluss

- [ ] 8.1 `/impeccable audit`: Zugänglichkeit, Responsive, Performance. Befunde beheben. Fertig,
  wenn der Audit ohne offene kritische Befunde ist.
- [ ] 8.2 `/impeccable document`: `DESIGN.md` aus der fertigen Oberfläche erzeugen. Fertig, wenn
  die Datei existiert und der Betreiber sie gesehen hat.
- [ ] 8.3 Feature-Doku unter `feature-documentation/dashboard/`, je Funktion eine Datei:
  - Aufbau und Betrieb, Datenmodell, Abgleich, Ansichten, Aktionen
  - Versionen aus 1.1, Ergebnisse aus 1.2 und 4.6

  `PROGRESS.md` aktualisieren. Fertig, wenn `openspec validate dashboard --strict` grün ist.
- [ ] 8.4 Abschließender `reviewer` über den gesamten Change und Sicherheitsblick auf
  Vertrauensgrenze, Log-Auszüge und Fehlermeldungen. Fertig, wenn keine offenen Befunde bleiben.
