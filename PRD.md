# Product Requirements Document (PRD)

## 1. Projektzusammenfassung
- **Projektname:** Renovate-Plattform Krinke IT (`Krinke-IT-Consulting/renovate`)
- **Projekttyp:** Backend-Service (selbst gehostetes Mend Renovate CE) + Web-App (Status-Dashboard), gemeinsam als Docker-Compose-Stack auf Coolify
- **Kurzbeschreibung:** Eine zentrale, selbst gehostete Renovate-Instanz hält die Abhängigkeiten aller privaten GitHub-Repos aus `Hiwamashi` und `Krinke-IT-Consulting` automatisch aktuell. Ein eigenes Dashboard zeigt den Zustand aller Repos, PRs und Renovate-Läufe an einer Stelle und übernimmt das Onboarding neuer Repos.

## 2. Problemstellung & Zielgruppe
- **Problem:**
  - Abhängigkeiten in den rund 25 Repos (Wachstum auf bis zu 50 erwartet) werden heute manuell oder gar nicht aktualisiert, und Sicherheitslücken bleiben liegen.
  - Es gibt keine Renovate- oder Dependabot-Konfiguration und keine Übersicht, welche Repos veraltet sind.
- **Zielgruppe:**
  - Der Betreiber, Sascha Krinke, für seine privaten Projekte und die Projekte von Krinke IT-Consulting
  - Später möglicherweise Kunden von Krinke IT-Consulting (Mandantenfähigkeit)
- **Alleinstellungsmerkmal gegenüber der Mend-App und Dependabot:**
  - Volle Kontrolle über Tokens und Datenfluss, kein Drittanbieter mit Zugriff auf den Code
  - Eigene Zeitpläne, eigene Parallelität und eigene Rate-Limits
  - Zugriff auf private Registries (Scaleway)
  - Eigene, plattformübergreifende Übersicht über alle Repos (Renovate CE hat keine Weboberfläche, die gibt es nur im kostenpflichtigen EE)
  - Von Anfang an für GitLab und mehrere Mandanten erweiterbar

### Bestandsaufnahme der Ziel-Repos (Stand 2026-10-13)

| Ökosystem | Repos (Auswahl) |
|---|---|
| npm (`package.json`, `package-lock.json`) | OpenWork, Webseiten, growly-*, proton-mcp-ultra, aws/* |
| pnpm + `.nvmrc` | seatmagic |
| Bun (`bun.lockb`) | bedoba-gold, elektro-heimanns-redesign, growly-cibook, growly-legal |
| Expo / React Native + CocoaPods | growly (Babytracker-App) |
| AWS CDK | aws-infrastructure, aws-paperclip, workload-template |
| Docker Compose (viele gepinnte und einige `latest`-Images) | memtly, obsidian-sync, vaultsync, smoking-tracker, bedoba-gold, elektro-heimanns, supfood-orchestrator, lector, seatmagic |
| Dockerfiles (Base-Images, von Coolify gebaut) | obsidian-sync, vaultsync, smoking-tracker, supfood-orchestrator, lector, seatmagic |
| Python (`pyproject.toml`, `requirements.txt`) | lector, vaultsync, homeassistant_configuration |
| Go (`go.mod`) | remarkable-vaultsync |
| GitHub Actions | aws/*, proton-mcp-ultra, vaultsync, growly |
| PowerShell (von Renovate nicht abgedeckt) | atera-scripting |

## 3. Funktionsumfang

### 3.1 MVP (Must-have)

**Renovate-Engine (Renovate CE)**
- [ ] **Ein Renovate CE** verarbeitet alle Repos, in denen die GitHub App installiert ist, in `Hiwamashi` und `Krinke-IT-Consulting`.
  - Feinsteuerung über die Repo-Auswahl der App-Installation und über `autodiscoverFilter`.
  - Archivierte Repos werden ausgeschlossen.
- [ ] **Shared Preset** (`default.json` im Repo-Root): Alle Repos binden es per `"extends": ["github>Krinke-IT-Consulting/renovate"]` ein. Es enthält:
  - Basis `config:recommended`
  - Gruppierung aller Minor- und Patch-Updates je Repo in einem PR; Major-Updates einzeln
  - Labels (`dependencies`, `renovate`, plus Update-Typ) und Commit-Konventionen (Conventional Commits, `chore(deps): …`)
  - Zeitplan (Vorschlag: nachts bzw. wochenends, Zeitzone `Europe/Berlin`) und Limits (`prConcurrentLimit`, `prHourlyLimit`)
  - Dependency Dashboard (`dependencyDashboard: true`) je Repo
  - Pinning von GitHub Actions auf Digests (`helpers:pinGitHubActionDigests`)
- [ ] **Sicherheitsupdates vorrangig:** `vulnerabilityAlerts` (GitHub-/Dependabot-Alerts) und `osvVulnerabilityAlerts: true` laufen ohne Zeitplan und tragen das Label `security`.
- [ ] **Automerge** für risikoarme Updates (Patch-Updates, devDependencies, Digest-Updates von Actions), **nur wenn der Build-Check grün ist**. Major-Updates werden nie automatisch gemergt.
- [ ] **Private Registry:** Eine `hostRules`-Vorlage für die Scaleway Container Registry (`rg.<region>.scw.cloud`, Benutzer `nologin`, Passwort = Scaleway-Secret-Key) steht bereit. Sie wird aktiviert, sobald eigene Images dort liegen.
- [ ] **Selbstaktualisierung:** Renovate hält die Image-Versionen im eigenen Compose-Stack (CE, Postgres, Authelia, Node-Base-Image) und die Dashboard-Abhängigkeiten selbst aktuell.

**Build-Check**
- [ ] **Reusable Workflow** `.github/workflows/build-check.yml` (`on: workflow_call`) in diesem Repo:
  - Er erkennt die Ökosysteme anhand der Lockfiles: npm, pnpm, Bun, Python (pip/uv), Go.
  - Er führt jeweils Install, Build bzw. Typecheck und die vorhandenen Tests aus.
  - Inputs: `working-directory` (für Monorepos wie seatmagic), optional `ecosystems` und `node-version` (Standard: `.nvmrc`, sonst LTS).
- [ ] **Aufruf-Vorlage** (`templates/build-check-caller.yml`): etwa 10 Zeilen, ruft `Krinke-IT-Consulting/renovate/.github/workflows/build-check.yml@v1` auf. Die Version hält Renovate selbst aktuell.

**Dashboard (`renovate.krinke-it.cloud`)**
- [ ] **Kennzahlen-Übersicht:** Zahl der Repos (onboarded / nicht onboarded), offene Renovate-PRs, offene Sicherheitsupdates, Repos mit Problemen, letzter Lauf
- [ ] **Repo-Übersicht:** alle Repos mit Owner, Onboarding-Status, Build-Check-Status, letztem Lauf und Ergebnis, Zahl offener PRs und Sicherheitsupdates; sortier- und filterbar
- [ ] **PR-Liste über alle Repos:** filterbar nach Repo, Update-Typ (Major/Minor/Patch/Security/Digest), CI-Status und Automerge
- [ ] **Repo-Detailansicht:** offene PRs, Link zum Dependency-Dashboard-Issue, Job-Historie, Probleme, Rollout-Aktionen
- [ ] **Laufhistorie:** Renovate-CE-Jobs mit Status, Dauer und Log-Auszug
- [ ] **Problemliste:** Konfigurationsfehler, fehlgeschlagene Lockfile-Updates, fehlgeschlagene Jobs, hängende PRs (z. B. über 14 Tage offen oder CI rot)
- [ ] **Onboarding (Teil des Dashboards):**
  - Für neu entdeckte Repos legt das Dashboard **einen** Onboarding-PR an. Er enthält:
    - eine minimale `renovate.json` (`"extends": ["github>Krinke-IT-Consulting/renovate"]`)
    - die Aufruf-Datei `.github/workflows/build-check.yml`
  - Ein Schalter legt fest, ob das automatisch für jedes neue Repo passiert oder erst per Klick.
  - Das eigene Onboarding von Renovate CE ist abgeschaltet (`onboarding: false`, `requireConfig: "required"`). So entstehen keine doppelten Onboarding-PRs, und Repos ohne `renovate.json` werden übersprungen.
- [ ] **Aktionen:**
  - Renovate-Lauf für ein einzelnes Repo oder für alle Repos anstoßen (über die CE-Job-API)
  - Onboarding-PR anstoßen
  - Build-Check-Aufruf nachträglich ausrollen
  - Jede Aktion verlangt eine Bestätigung im Dialog.
- [ ] **Login:** Authelia als Forward-Auth vor dem Dashboard (`renovate-auth.krinke-it.cloud`), mit 2FA (TOTP)

### 3.2 Nice-to-have (später)
- [ ] **Mandantenfähigkeit prüfen:** Kunden-Organisationen von Krinke IT-Consulting, getrennte Sicht je Mandant. Das Datenmodell sieht `Tenant` bereits vor.
- [ ] **GitLab-Unterstützung:** zweite Renovate-CE-Instanz mit `platform=gitlab`, ein `GitLabAdapter` im Dashboard, ein GitLab-CI-Pendant zum Build-Check
- [ ] Benachrichtigungen (E-Mail, Push oder Teams) bei fehlgeschlagenen Läufen und neuen Sicherheitsupdates
- [ ] Digest-Pinning aller `latest`-Docker-Images
- [ ] Backup der Postgres-Datenbank (z. B. `offen/docker-volume-backup` nach Scaleway Object Storage)
- [ ] Prometheus-Metriken von CE in Grafana
- [ ] Aggregierte Update-Sicht („welche Repos nutzen noch Paket X in Version Y")

### 3.3 Explizit ausgeschlossen (MVP)
- Andere Plattformen als GitHub (GitLab ist vorbereitet, aber nicht umgesetzt)
- Ein Ersatz für CI-Tests: Renovate verlässt sich auf den Build-Check bzw. die bestehende CI
- Eigene Nutzerverwaltung im Dashboard (sie liegt bei Authelia)
- Dark Mode
- Updates für PowerShell-Skripte (atera-scripting) und anderes, das Renovate nicht unterstützt
- Mend Renovate EE und andere kostenpflichtige Komponenten

## 4. Technische Architektur

### 4.1 Übersicht
- **Architekturstil:** ein Docker-Compose-Stack mit vier Diensten, deployt über Coolify (Traefik als Reverse Proxy):

```
                 GitHub (Hiwamashi, Krinke-IT-Consulting)
                   │  Webhooks (GitHub App)        ▲ PRs, Issues, Commits
                   ▼                               │
  renovate.krinke-it.cloud/webhook ──► [ renovate-ce ] ──► Postgres (DB renovate_ce)
        (ohne Authelia, HMAC-Secret)        ▲ Job-API (Server-API-Secret, nur intern)
                                            │
  renovate.krinke-it.cloud ──► Authelia ──► [ dashboard (Next.js) ] ──► Postgres (DB dashboard)
                     renovate-auth.krinke-it.cloud      │
                                            └──► GitHub API (Installation-Tokens der GitHub App)
```

- **Dienste:**
  - `renovate-ce`: Image `ghcr.io/mend/renovate-ce` (Version gepinnt), mit Scheduler, Webhook-Empfänger, Job-Queue und Job-API
  - `dashboard`: Next.js-App (Oberfläche, API-Routen und Hintergrund-Synchronisation)
  - `postgres`: eine Instanz mit zwei Datenbanken (`renovate_ce`, `dashboard`)
  - `authelia`: eigene Instanz für dieses Projekt (eine Instanz pro Projekt), dateibasierte Nutzer, TOTP
- **Routing:**
  - `renovate.krinke-it.cloud/*` → Authelia-Forward-Auth → Dashboard
  - `renovate.krinke-it.cloud/webhook` → Renovate CE, **ohne** Authelia. Absicherung über das Webhook-Secret der GitHub App; nur dieser Pfad wird nach außen durchgereicht.
  - Die Job-API von CE ist **nur im internen Docker-Netz** erreichbar.
- **Authentifizierung:**
  - Gegenüber GitHub: eine eigene GitHub App (z. B. „Krinke IT Renovate"), installiert in `Hiwamashi` und `Krinke-IT-Consulting`. CE und Dashboard nutzen dieselbe App-ID und denselben Private Key. PRs erscheinen unter dem Bot-Namen der App.
  - Am Dashboard: Authelia; das Dashboard liest den Header `Remote-User` bzw. `Remote-Email` und vertraut ihm nur, wenn die Anfrage von Traefik kommt.
- **Datenabgleich:**
  - Die GitHub App kann nur eine Webhook-URL bedienen, und die belegt CE. Das Dashboard **pollt** deshalb:
    - die CE-Job-API, etwa jede Minute
    - die GitHub-API, etwa alle 5 Minuten, mit ETags und bedingten Requests
  - Bei 10–50 Repos bleibt das weit unter dem Rate-Limit von 5.000 Requests pro Stunde und Installation.
- **Plattform-Abstraktion:** Alle Zugriffe auf GitHub laufen über ein Interface `PlatformAdapter` mit den Methoden `listRepositories`, `listRenovatePullRequests`, `getCheckStatus`, `createOnboardingPullRequest` usw. Im MVP gibt es nur `GitHubAdapter`. GitLab kommt später als zweite Implementierung dazu, ohne Änderungen an UI oder Datenmodell.
- **Repo-Sichtbarkeit:** `Krinke-IT-Consulting/renovate` ist **öffentlich**. Nur so können Repos aus beiden Ownern (und später aus Kunden-Orgs) das Preset und den Reusable Workflow nutzen. Daraus folgt:
  - Im Repo stehen keine Secrets und keine kundenbezogenen Daten.
  - Workflows aus Fork-PRs laufen nur nach Freigabe (GitHub-Standard, bleibt so).

### 4.2 Empfohlener Tech-Stack

| Komponente | Technologie | Begründung |
|------------|-------------|------------|
| Renovate-Engine | Mend Renovate CE (`ghcr.io/mend/renovate-ce`), Version gepinnt, kostenloser Lizenzschlüssel | Webhooks (Haken im Dependency Dashboard wirken sofort), Scheduler, Job-API, Unterstützung für GitHub und GitLab |
| Tool-Bereitstellung in CE | `binarySource: "install"` + persistentes Cache-Volume | Lädt Node, pnpm, Bun, Python, Go und CocoaPods erst bei Bedarf in der passenden Version |
| Globale Konfiguration | `renovate-ce/config.js` (Self-Hosted-Optionen) + `default.json` (Shared Preset) | Trennung: Betrieb in `config.js`, Regeln für die Repos im Preset |
| Frontend + Backend | Next.js (App Router, TypeScript, Server Components, Route Handlers) | Eine Anwendung, weit verbreitet, gut für Claude Code geeignet |
| UI-Komponenten | Tailwind CSS + shadcn/ui, TanStack Table für Tabellen | Bewährt, anpassbar an die krinke.me-Farben |
| Datenbank | PostgreSQL (gepinnte Major-Version) mit Drizzle ORM und Drizzle-Migrationen | Typsicher, schlank; dieselbe Instanz trägt die CE-Datenbank |
| Hintergrund-Sync | Node-Worker im Dashboard-Container (z. B. `node-cron` oder ein eigener Intervall-Loop mit Sperre in Postgres) | Kein zusätzlicher Dienst nötig |
| GitHub-Zugriff | `@octokit/app` / `@octokit/rest` (JWT → Installation-Tokens) | Offizielle Bibliothek |
| Konfigurationsprüfung | `zod`-Schema für alle Umgebungsvariablen (`dashboard/src/env.ts`) | Klare Fehlermeldungen beim Start, nur mit Namen |
| Auth | Authelia (Forward-Auth über Traefik-Labels in Coolify) | Vorhandenes Muster, eine Instanz pro Projekt |
| Build-Check | GitHub Actions Reusable Workflow | Ein zentraler Ort für die CI-Logik aller Repos |
| Tests | Vitest (Unit), Playwright (Smoke-Test des Dashboards) | Standard im Next.js-Umfeld |
| Deployment | `deploy/compose.yml` als Docker-Compose-Ressource in Coolify | Ein Stack, Secrets als Coolify-Variablen |

**Vorgeschlagene Repo-Struktur**

```
/
├── default.json                       # Shared Preset (github>Krinke-IT-Consulting/renovate)
├── renovate.json                      # Renovate-Konfiguration für dieses Repo selbst
├── .github/workflows/
│   ├── build-check.yml                # Reusable Workflow (workflow_call)
│   └── ci.yml                         # CI dieses Repos (Lint, Typecheck, Tests, Preset-Validierung)
├── templates/
│   ├── renovate.json                  # Vorlage für den Onboarding-PR
│   └── build-check-caller.yml         # Vorlage der Aufruf-Datei
├── renovate-ce/
│   └── config.js                      # globale Self-Hosted-Konfiguration
├── dashboard/                         # Next.js-App
├── deploy/
│   ├── compose.yml                    # renovate-ce, dashboard, postgres, authelia
│   ├── authelia/configuration.yml     # ohne Secrets
│   └── postgres/init.sql              # legt die DBs renovate_ce und dashboard an
├── feature-documentation/
├── PROGRESS.md
├── PRODUCT.md / DESIGN.md             # Impeccable
└── .env.example
```

**Benötigte Konfigurationswerte (nur Namen, keine Werte)**

Die exakten Variablennamen von Renovate CE sind bei der Umsetzung gegen die aktuelle Doku (`mend/renovate-ce-ee`, `docs/configuration-options.md`) zu prüfen.

| Name (Vorschlag) | Herkunft | Zweck |
|---|---|---|
| `MEND_RNV_LICENSE_KEY` | Mensch (Registrierung bei Mend) | Lizenz für Renovate CE |
| `MEND_RNV_ACCEPT_TOS` | Konfiguration | Zustimmung zu den Mend-AGB |
| `MEND_RNV_PLATFORM` | Konfiguration (`github`) | Plattform der CE-Instanz |
| `MEND_RNV_GITHUB_APP_ID` / `GITHUB_APP_ID` | Mensch (GitHub-App-Anlage) | App-Identität für CE und Dashboard |
| `MEND_RNV_GITHUB_APP_KEY` / `GITHUB_APP_PRIVATE_KEY` | Mensch (GitHub-App-Anlage) | Private Key der App |
| `MEND_RNV_WEBHOOK_SECRET` | selbst erzeugt | Prüfung der GitHub-Webhooks |
| `MEND_RNV_SERVER_API_SECRET` / `RENOVATE_CE_API_SECRET` | selbst erzeugt | Zugriff des Dashboards auf die CE-Job-API |
| `POSTGRES_PASSWORD`, `DATABASE_URL` (CE und Dashboard) | selbst erzeugt | Datenbankzugang |
| `AUTHELIA_JWT_SECRET`, `AUTHELIA_SESSION_SECRET`, `AUTHELIA_STORAGE_ENCRYPTION_KEY` | selbst erzeugt | Authelia |
| `SCW_REGISTRY_SECRET_KEY` | Mensch (Scaleway-IAM-API-Key, nur Registry-Lesen) | Private Images (vorbereitet, optional) |
| `RENOVATE_GITHUB_COM_TOKEN` (falls von CE benötigt) | Mensch | Changelogs und Release Notes von github.com abrufen |

**Rechte der GitHub App (Vorschlag, gegen die CE-Doku prüfen)**
- **Repository:**
  - Contents: Read & write
  - Pull requests: Read & write
  - Issues: Read & write (Dependency Dashboard)
  - Workflows: Read & write (Updates an `.github/workflows`, Rollout der Aufruf-Datei)
  - Checks: Read
  - Commit statuses: Read & write
  - Dependabot alerts: Read (Sicherheitsupdates)
  - Administration: Read
  - Metadata: Read
- **Organisation:** Members: Read
- **Events:** die laut CE-Doku benötigten (u. a. `push`, `pull_request`, `issues`, `installation`, `installation_repositories`, `check_run`, `status`)
- **Webhook-URL:** `https://renovate.krinke-it.cloud/webhook`

### 4.3 Datenmodell

Das Dashboard hat eine eigene Datenbank `dashboard`. Die Datenbank `renovate_ce` gehört ausschließlich Renovate CE und wird nur über deren API gelesen, nie direkt.

```
Tenant                                   (im MVP genau einer: "Krinke IT")
├── id (uuid)
├── name (text)
├── created_at (timestamptz)
└── 1:n PlatformConnection

PlatformConnection
├── id (uuid)
├── tenant_id (fk → Tenant)
├── platform (enum: github | gitlab)
├── owner_name (text)                    z. B. "Hiwamashi", "Krinke-IT-Consulting"
├── installation_id (bigint, nullable)   GitHub-App-Installation
├── auto_onboarding (boolean)
└── 1:n Repository

Repository
├── id (uuid)
├── connection_id (fk → PlatformConnection)
├── full_name (text, unique je Connection)
├── default_branch (text)
├── archived (boolean)
├── onboarding_status (enum: none | pr_open | onboarded | disabled)
├── build_check_status (enum: missing | pr_open | active)
├── detected_ecosystems (text[])
├── dependency_dashboard_url (text, nullable)
├── last_job_at (timestamptz, nullable)
├── last_job_result (enum: success | failed | skipped | unknown)
├── synced_at (timestamptz)
└── 1:n PullRequest, 1:n RenovateJob, 1:n Problem, 1:n RolloutAction

PullRequest                              (nur Renovate-PRs)
├── id (uuid)
├── repository_id (fk)
├── number (int)
├── title (text)
├── url (text)
├── update_type (enum: major | minor | patch | security | digest | lockfile | other)
├── package_names (text[])
├── ci_status (enum: success | failure | pending | none)
├── automerge (boolean)
├── state (enum: open | merged | closed)
├── created_at, updated_at, merged_at (timestamptz)

RenovateJob                              (Spiegel der CE-Job-API)
├── id (uuid)
├── repository_id (fk)
├── ce_job_id (text, unique)
├── trigger (enum: schedule | webhook | manual)
├── status (enum: queued | running | success | failed)
├── started_at, finished_at (timestamptz)
└── log_excerpt (text, gekürzt, ohne Secrets)

Problem
├── id (uuid)
├── repository_id (fk)
├── kind (enum: config_error | lockfile_failure | job_failed | stale_pr | ci_red | missing_build_check)
├── message (text)
├── first_seen_at, last_seen_at, resolved_at (timestamptz)

RolloutAction
├── id (uuid)
├── repository_id (fk)
├── kind (enum: onboarding | build_check)
├── triggered_by (text)                  Authelia-Nutzer oder "auto"
├── pr_url (text, nullable)
├── status (enum: pending | pr_open | merged | failed)
├── error (text, nullable)
├── created_at (timestamptz)

AuditLog
├── id (uuid)
├── actor (text)
├── action (text)                        z. B. "job.trigger", "rollout.onboarding"
├── target (text)
└── created_at (timestamptz)
```

### 4.4 Externe Abhängigkeiten
- **GitHub (API + App):** Repos, PRs, Issues, Checks, Webhooks an CE
- **Mend:** Lizenzschlüssel für Renovate CE (einmalige Registrierung) und die Merge-Confidence-Daten, die CE nutzt
- **Paket-Registries** (öffentlich): npm, PyPI, Go-Proxy, Docker Hub, GHCR, CocoaPods, GitHub Releases
- **Scaleway Container Registry:** private Images (vorbereitet)
- **OSV-Datenbank:** Sicherheitsmeldungen (`osvVulnerabilityAlerts`)
- **Coolify:** Deployment, Traefik-Routing, Secrets, persistente Volumes
- **Authelia:** Login am Dashboard (Teil des Stacks)

## 5. UI/UX-Anforderungen

### 5.1 Design-Richtlinien
- **Design-System:** kein Marken-System der WRS-Gruppe. Eigener Stil, **angelehnt an krinke.me**. Verbindliche Ausgangsreferenz ist die `DESIGN.md` der Website (`/Users/saschakrinke/Quellcode/Cursor/webseite - krinke.me/Webseite---krinke.me/DESIGN.md`, „Schaltkreis & Torii"). Daraus wird mit Impeccable eine eigene, an ein Dashboard angepasste `DESIGN.md` für dieses Projekt erzeugt.
  - **Farben:**
    - Tiefes Rheinblau `#2B4C9B` (Struktur, Überschriften, aktive Filter); Rheinblau tief `#1A2744` (Textfarbe); Rheinblau hell `#3D62B5` (Hover)
    - Fassholz `#8B5E3C` (Meta-Informationen, Akzentkanten)
    - Signal-Olive tief `#55711C` ausschließlich für Aktionen; Logo-Grün `#6B8E23` nur für Icons und Linien
    - Surface `#F8F9FA`, Papierweiß `#FFFFFF`, Sekundärtext `#525866`
    - Keine Farben außerhalb dieser Palette. Statusfarben (Fehler, Warnung) sind mit Impeccable so festzulegen, dass sie mit der Palette harmonieren.
  - **Typografie:** Montserrat (Überschriften, Kennzahlen mit `tnum`), Inter (Fließtext, Tabellen). Eine Monospace-Schrift für Logs, Paketnamen und Versionen ist als begründete Abweichung in Impeccable zu entscheiden.
  - **Formen und Tiefe:** Karten mit 8 px, Buttons mit 6 px, Pill-Chips für Filter, leichte Schatten (`shadow-sm` im Ruhezustand, `shadow-md` bei Hover), 2 px große Akzentlinien statt dicker Rahmen
  - **Schmuck:** ausschließlich aus dem Logo abgeleitet (Leiterbahnen, Knoten), sparsam eingesetzt
  - **Bewegung:** dezent und vollständig abschaltbar über `prefers-reduced-motion`
  - **Logo:** `logo-wide.png` (Desktop-Header) und `logo-compact.png` (Mobile) aus `Webseite---krinke.me/public/images`, unverändert übernommen, nicht neu gezeichnet
- **Design-Priorität:** ansprechend und modern. Der Feinschliff erfolgt mit Impeccable (`/impeccable init`, `/impeccable shape`, `/impeccable audit`).
- **Zielgeräte:** responsive für Desktop und Mobile. Touch-Ziele mindestens 44 × 44 px; Tabellen werden auf Mobile zu Karten. Nur heller Modus, kein Dark Mode.
- **Sprache der Oberfläche:** Deutsch

### 5.2 Wichtige UI-Komponenten
- **App-Shell:** Header mit Logo und Navigation (Übersicht, Repos, Pull Requests, Jobs, Probleme), angemeldeter Nutzer, Logout-Link zu Authelia; auf Mobile ein Overlay-Menü
- **Kennzahlen-Band:** Repos onboarded/gesamt, offene PRs, Sicherheitsupdates, Probleme, letzter Lauf. Angelehnt an das Stats-Band in Rheinblau, aber kompakt.
- **Datentabellen:** sortierbar, filterbar, durchsuchbar, mit Pill-Chips als Filter, Paginierung bzw. virtuellem Scrollen; auf Mobile als Karten
- **Statusbadges:** CI (grün/rot/ausstehend/fehlt), Update-Typ, Onboarding-Status, Automerge
- **Repo-Detailseite:** Kopf mit Status, Tabs bzw. Abschnitte für PRs, Jobs, Probleme und Rollout
- **Job-Historie mit Log-Ansicht:** aufklappbarer Log-Auszug, Kopieren-Button
- **Aktions-Buttons mit Bestätigungsdialog:** Lauf starten, Onboarding-PR, Build-Check ausrollen; danach Toast-Meldung mit Link zum PR bzw. Job
- **Leer-, Lade- und Fehlerzustände** für jede Ansicht (z. B. „Noch kein Lauf", „GitHub nicht erreichbar")
- **Zeitstempel** relativ angezeigt („vor 3 Stunden"), absolut beim Überfahren mit der Maus; Zeitzone Europe/Berlin

### 5.3 Mockups / Design-Vorgaben
- Keine Mockups vorhanden.
- Vorgaben: krinke.me-`DESIGN.md` als Ausgangspunkt, nur heller Modus, Logo-Dateien von krinke.me. Das endgültige Design wird mit Impeccable in `PRODUCT.md` und `DESIGN.md` dieses Repos festgelegt.

## 6. Offene Fragen
- **Automerge ohne Checks:** Ab wann gilt ein Repo als „Build-Check aktiv"? Verhalten von Renovate bei fehlenden Status-Checks verifizieren (Automerge darf dann **nicht** greifen). Gegebenenfalls `automerge` nur für Repos mit aktivem Build-Check per `packageRules` bzw. Repo-Konfiguration freischalten.
- **Build-Check-Tiefe je Ökosystem:** Was genau läuft bei Expo/React Native (growly), bei CDK (`cdk synth`?) und bei Python-Repos ohne Tests?
- **Mandantenfähigkeit:** Eine öffentlich installierbare GitHub App für Kunden-Orgs oder eine eigene CE-Instanz je Mandant? Die Entscheidung fällt erst bei Bedarf; das Datenmodell ist vorbereitet.
- **GitLab:** Eine CE-Instanz bedient genau eine Plattform. Später also eine zweite CE-Instanz im Stack oder ein zweiter Stack?
- **Coolify-Server:** Auf welchem der vorhandenen Server läuft der Stack? Ressourcenbedarf etwa 2–4 GB RAM für CE-Worker beim Lockfile-Update und 10–20 GB Plattenplatz für Tool- und Repo-Cache.
- **Authelia-Nutzer:** nur der Betreiber, oder weitere Personen? Benutzer per Datei oder per LDAP?
- **Backups:** Ist ein Datenbank-Backup schon im MVP nötig? Die Dashboard-Daten lassen sich aus GitHub und CE neu aufbauen; die CE-Datenbank ebenfalls.
- **Benachrichtigungen:** Kanal und Zeitpunkt (Nice-to-have)
- **`latest`-Tags und fehlender Registry-Präfix** in den Compose-Dateien einiger Repos (z. B. `krinke-it/bedoba-gold:latest`): Renovate meldet diese Images als nicht auffindbar. Sie werden entweder per `ignoreDeps` ausgeschlossen oder in den Repos bereinigt.
- **Dependabot-Alerts** müssen je Repo aktiviert sein, damit `vulnerabilityAlerts` greift. Soll das Dashboard das prüfen und als Problem melden?

## Zwingende Regeln für die CLAUDE.md

Diese Regeln sind aus dem PRD 1:1 in die `CLAUDE.md` des Projekts zu übernehmen.

## Geheimnisse und Konfigurationswerte

Diese Regel gilt für jeden Wert, der nicht im Repository stehen darf: Zugangsschlüssel,
Client-Geheimnisse, Verbindungszeichenfolgen, selbst erzeugte Signaturschlüssel — etwa API-Keys
von Fremdsystemen (Shop, ERP, Kasse), Service-Account-Schlüssel oder Zugangsdaten zu
Produktivdatenbanken.

### Welche `.env`-Datei wofür

Jede Umgebung hat genau eine eigene Datei. Andere Namen und Mischformen gibt es nicht.

| Datei | Zweck | Versioniert? |
|---|---|---|
| `.env.example` | Vorlage: jeder Name mit leerem Wert und Herkunftskommentar | ja |
| `.env.local` (oder `.env`, wenn das Framework nur diese lädt — pro Projekt eine von beiden) | **lokaler Betrieb** auf dem eigenen Rechner | **nein, gitignored** |
| `.env.<umgebung>`, also `.env.production`, `.env.stage` usw. | **Spiegel eines Deployment-Ziels**: genau die Werte, die auf der Plattform für diese Umgebung hinterlegt sind | **nein, gitignored** |

- Lokal läuft die Anwendung **immer** mit `.env.local` bzw. `.env` — nie mit `.env.production`
  oder einer anderen Deployment-Datei. Wer lokal gegen ein Produktivsystem arbeiten muss, trägt
  die nötigen Werte bewusst in `.env.local` ein.
- `.env.<umgebung>` wird von keinem lokalen Startbefehl geladen. Sie dokumentiert den Stand der
  jeweiligen Umgebung, damit sich deren Verhalten nachvollziehen und die Plattform neu befüllen
  lässt.
- Der Name der Umgebung entspricht dem Deployment-Ziel (`production`, `stage`, …). Für jedes
  Ziel, das es gibt, existiert genau eine Datei; für Ziele, die es nicht gibt, keine.
- `.gitignore` nimmt alle `.env*`-Dateien aus — mit Ausnahme von `.env.example`.

### Die Stellen eines Konfigurationswerts

Ein neuer Konfigurationswert wird an allen folgenden Stellen eingetragen, sonst an keiner:

| Stelle | Was dort steht | Versioniert? |
|---|---|---|
| Env-Schema der Komponente (die zentrale Konfigurationsdatei, etwa `config.py` oder `env.ts`) | Name, Typ, Pflicht oder optional, Vorgabewert | ja |
| `.env.example` | Name mit leerem Wert, plus Kommentar woher der Wert kommt | ja |
| `.env.local` bzw. `.env` | der Wert für den lokalen Betrieb | **nein** |
| `.env.<umgebung>` je Deployment-Ziel | der Wert, der in dieser Umgebung gilt | **nein** |
| Deployment-Plattform (Variable bzw. Secret, etwa in Coolify) + Durchreichung in der Compose- bzw. Deployment-Datei | eine Hülle mit Platzhalter, die ein Mensch später befüllt | die Compose-Datei ja, der Wert nein |

Fehlt eine davon, ist die Aufgabe **nicht** erledigt. Ein Wert, der nur in einer `.env`-Datei
auftaucht, ist für den nächsten Menschen unsichtbar; einer, der nur im Schema steht, lässt die
Anwendung beim Start abbrechen. Kennt der Wert noch keinen Inhalt (etwa weil ein Mensch ihn
liefern muss), steht der Name trotzdem in jeder Datei — mit leerem Wert.

`.env.example` ist zugleich das **Interface für jeden, der das Projekt neu aufsetzt**: Jeder
Eintrag trägt einen Kommentar, woher der Wert kommt und ob er zwingend ist. Eine Variable, die nur
der Erstautor erraten kann, ist ein Fehler.

Wird deployt und dabei eine neue Umgebungsvariable oder ein neues Secret angelegt, gehört derselbe
Wert **im selben Arbeitsschritt** in die `.env.<umgebung>` dieses Ziels — sonst lässt sich das
Verhalten der Umgebung nicht mehr nachstellen.

### Wer den Wert liefert — und was das für dich heißt

Für jeden Wert ist festzuhalten, woher er stammt. Es gibt genau drei Herkünfte:

1. **Vom Menschen** — etwa ein API-Key, den ein Dienstleister ausstellt. Du erzeugst ihn nicht,
   du forderst ihn an und trägst ihn nirgends selbst ein.
2. **Von der Infrastruktur** — etwa Keys, die eine Plattform beim Anlegen eines Projekts oder
   einer Datenbank erzeugt. Der Wert entsteht erst beim Bereitstellen.
3. **Selbst erzeugt** — etwa ein Client-Token oder ein Signaturschlüssel. **Das ist der Fall, der
   besondere Sorgfalt verlangt.**

Wenn du einen Wert selbst erzeugst, gilt zusätzlich:

- Trage ihn **unmittelbar** in jede `.env`-Datei ein, in der er gilt (`.env.local` bzw. `.env`
  und/oder `.env.<umgebung>`) — nicht „später", nicht im Bericht.
- Nenne im Bericht nur den Namen, niemals den Wert, auch nicht gekürzt.
- Halte in `feature-documentation/secrets-register.md` fest: Name, Herkunft, Zweck, wo er im
  Betrieb herkommt, und wie er sich neu erzeugen lässt.
- Ein selbst erzeugter Wert, der nur im Kopf eines Agenten existierte und nie in einer
  `.env`-Datei landete, ist verloren — die Anwendung lässt sich dann lokal nicht mehr
  starten, ohne dass jemand versteht warum.

### Was niemals passiert

- Ein echter Wert in `.env.example`, in einer Migration, in einer Compose- oder Dockerfile-Vorlage,
  in einem Test, in einem Commit oder in einer Protokollausgabe.
- Ein Wert in einem Subagenten-Bericht — auch nicht maskiert. Berichte nennen Namen, keine Werte.
- Eine Fehlermeldung, die den Wert eines fehlenden oder ungültigen Eintrags ausgibt.
  Fehlermeldungen nennen den **Namen** der Variablen, nie ihren Inhalt.
- Ein Zugangstoken, das die Anwendung selbst an Clients ausgibt, im Klartext irgendwo außer in
  der einmaligen Anzeige bei der Ausgabe; gespeichert wird nur der Hash.

### Lokale Entwicklungszugangsdaten sind keine Geheimnisse

Die Zugangsdaten lokaler Docker-Dienste (etwa einer lokalen Datenbank) dürfen bewusst mit echten
Werten in `.env.example` stehen. Sie gehören zu Wegwerf-Containern und sind kein Geheimnis im
Sinne dieser Regel. Die Unterscheidung ist: **Betrifft der Wert ein System außerhalb dieses
Rechners?** Dann ist er ein Geheimnis.

## Dokumentations-Richtlinie

> Im Ordner `feature-documentation/` müssen alle neuen Funktionen und Features sowie deren Anpassungen in einzelnen `.md`-Dateien im Markdown-Format dokumentiert werden. Pro Funktion und Markdown eine Datei. Sollte ein Feature aus mehreren Funktionen bestehen, dürfen Unterordner pro Feature angelegt werden. Diese Dokumentation dient vor allem anderen KI-Coding-Agenten zum besseren Verständnis der Codebase.

> Der aktuelle Entwicklungsfortschritt ist fortlaufend in einer `PROGRESS.md` im Projekt-Root zu dokumentieren. Dort wird festgehalten, welche Features bereits umgesetzt sind, welche in Arbeit sind und welche noch ausstehen. So haben alle Beteiligten (Mensch und KI-Agent) jederzeit einen aktuellen Überblick über den Stand der Entwicklung.

## Graphify — Codebase Knowledge Graph

Dieses Projekt nutzt [Graphify](https://github.com/safishamsi/graphify/tree/v8)
zur strukturierten Codebase-Analyse.

### Setup (einmalig pro Repo)

Wenn `graphify-out/` nicht existiert oder `graphify-out/graph.json` fehlt:

1. Prüfe, ob `graphify` als CLI verfügbar ist (`graphify --version`).
   Falls nicht: `uv tool install graphifyy`
2. Prüfe, ob der Graphify-Skill registriert ist (`~/.claude/skills/graphify/`).
   Falls nicht: `graphify install`
3. Erkenne relevante Dateitypen im Repo und installiere passende Extras:
   - `.pdf` vorhanden → `uv tool install "graphifyy[pdf]"`
   - `.docx` / `.xlsx` vorhanden → `uv tool install "graphifyy[office]"`
   - `.sql` vorhanden → `uv tool install "graphifyy[sql]"`
   - `.mp4` / `.mov` / `.mp3` vorhanden → `uv tool install "graphifyy[video]"`
   - Im Zweifel: `uv tool install "graphifyy[all]"`
4. Baue den Graphen: `/graphify .`
5. Registriere im Global Graph: `graphify global add graphify-out/graph.json --as <repo-name>`
   Verwende den Verzeichnisnamen als `<repo-name>`.
6. Generiere die Architekturübersicht: `graphify export callflow-html`
7. Registriere Graphify für dieses Repo: `graphify claude install`
8. **Nur nach expliziter Freigabe durch den Benutzer:**
   Schlage `graphify hook install` vor (auto-rebuild bei git commit).
   Erkläre kurz, was der Hook tut, und warte auf Bestätigung.

### Nutzung

- Lies `graphify-out/GRAPH_REPORT.md` bevor du Architektur- oder
  Abhängigkeitsfragen beantwortest.
- Nutze `graphify query "<frage>"` für Strukturfragen, bevor du
  manuell Dateien durchsuchst.
- Nutze `graphify explain "<Knoten>"` um einzelne Konzepte zu verstehen.
- Nutze `graphify path "<A>" "<B>"` um Verbindungen zwischen
  Komponenten zu finden.
- Bei `AMBIGUOUS`-Kanten im Graphen: Quellcode gegenchecken.

### Aktualisierung

- Nach größeren Refactorings: `/graphify . --force`
- Nach Änderungen an Docs/PDFs: `/graphify . --update`
- Callflow-Export aktualisieren: `graphify export callflow-html`

## OpenSpec — Spec-Driven Development

Dieses Projekt nutzt [OpenSpec](https://github.com/Fission-AI/OpenSpec), um
Änderungen vor der Umsetzung als Spezifikation festzuhalten. Die gültigen Specs
liegen unter `openspec/specs/`, laufende Änderungen unter `openspec/changes/`.

### Setup (einmalig pro Repo)

Wenn `openspec/` nicht existiert:

1. Prüfe, ob `openspec` als CLI verfügbar ist (`openspec --version`).
   Falls nicht: `npm install -g @fission-ai/openspec`
2. Initialisiere das Repo: `openspec init --tools claude`
   Das legt `openspec/` sowie die Skills `.claude/skills/openspec-*` und die
   Kommandos `.claude/commands/opsx/` an — alles wird mit eingecheckt.
3. Trage Tech-Stack, Konventionen und Fachbegriffe als `context` in
   `openspec/config.yaml` ein, damit neue Artefakte darauf aufbauen.

### Nutzung

- Für neue Funktionen und Verhaltensänderungen, die mehr als eine Datei
  betreffen: zuerst einen Change anlegen (`/opsx:propose`), dann umsetzen
  (`/opsx:apply`), nach Abschluss archivieren (`/opsx:archive`).
- Bei unklaren Anforderungen erst `/opsx:explore` nutzen, statt direkt einen
  Change zu schreiben.
- Kleine Bugfixes, Tippfehler und reine Refactorings ohne Verhaltensänderung
  brauchen keinen Change.
- Lies vor Änderungen an einem Bereich die passende Spec unter `openspec/specs/`.
  Weicht der Code von der Spec ab, sprich den Widerspruch an, statt ihn still
  in eine Richtung aufzulösen.
- Prüfe Changes mit `openspec validate`, bevor du sie zur Umsetzung freigibst.

### Aktualisierung

- Nach einem Update der CLI: `openspec update`, damit die Skills und Kommandos
  im Repo zur installierten Version passen.

## Impeccable — Frontend-Design

Dieses Projekt nutzt [Impeccable](https://github.com/pbakaus/impeccable) für
Gestaltung und Qualitätsprüfung der Oberfläche. Produktwissen steht in
`PRODUCT.md`, die visuelle Sprache in `DESIGN.md`.

### Setup (einmalig pro Repo)

1. Prüfe, ob der Impeccable-Skill verfügbar ist (`~/.claude/skills/impeccable/`
   oder `.claude/skills/impeccable/`). Falls nicht:
   `npx skills add pbakaus/impeccable`
2. Fehlt `PRODUCT.md`: `/impeccable init` — erfasst Zielgruppe, Zweck und
   feste Vorgaben des Produkts.
3. Fehlt `DESIGN.md` und gibt es bereits eine Oberfläche:
   `/impeccable document` — leitet die vorhandene visuelle Sprache aus dem Code ab.
   Gilt für das Projekt ein Marken-Design-System der WRS-Gruppe (JAC, WEIN & CO,
   WRS), ist dieses die Vorgabe für `DESIGN.md`.
4. **Nur nach expliziter Freigabe durch den Benutzer:**
   Schlage `/impeccable hooks on` vor (Design-Prüfung nach jeder Änderung an
   UI-Dateien). Der Hook wird maschinenlokal in `.claude/settings.local.json`
   eingetragen. Erkläre kurz, was er tut, und warte auf Bestätigung.

### Nutzung

- Bei Arbeit an der Oberfläche (Seiten, Komponenten, Formulare, Styles) den
  Impeccable-Skill verwenden, statt ohne Designgrundlage zu gestalten.
- Vor dem Bau einer neuen Oberfläche: `/impeccable shape` für UX und Aufbau.
- Vor Abschluss einer UI-Änderung: `/impeccable audit` (Barrierefreiheit,
  Performance, Responsive) und bei Bedarf `/impeccable polish`.
- Für Review-Fragen zur Gestaltung: `/impeccable critique`.
- `PRODUCT.md` und `DESIGN.md` sind verbindlich. Widerspricht eine Anforderung
  ihnen, sprich es an, statt eine der Dateien still zu umgehen.

### Aktualisierung

- Ändert sich die visuelle Sprache grundlegend: `DESIGN.md` mit
  `/impeccable document` neu erzeugen, statt sie von Hand auseinanderlaufen zu lassen.

## Subagents proaktiv nutzen

- Prüfe bei jeder nicht-trivialen Aufgabe, ob sie sich für die Delegation an einen Subagent (Agent/Task-Tool) eignet – insbesondere bei:
  - breiter Codebase-Recherche (mehr als ~3 Suchanfragen)
  - unabhängigen, parallelisierbaren Teilaufgaben
  - Aufgaben, die viel Kontext (Logs, große Dateien) erzeugen würden
- Wenn eine Delegation sinnvoll ist, schlage sie **aktiv vor**, bevor du selbst loslegst: nenne kurz den Subagent-Typ und warum.
- Bei mehreren unabhängigen Teilaufgaben: schlage vor, sie parallel über mehrere Subagents laufen zu lassen.

### Beispielhafte Subagent-Rollen

Die folgenden Rollen sind **nur Beispiele** zur Orientierung, keine abschließende Liste. Leite passende Subagents jeweils aus der konkreten Aufgabe und aus dem ab, was dieses Projekt tatsächlich braucht:

- **Dokumentations-Experte** – Erstellt/aktualisiert Doku (z.B. `feature-documentation/`, README, Changelog). Vorschlagen, wenn neue Funktionen ergänzt oder bestehende geändert wurden und die Doku nachgezogen werden muss.
- **Code-Reviewer** – Prüft Diffs auf Bugs, Sicherheitslücken (OWASP), Performance und Stil. Vorschlagen nach größeren Änderungen oder vor einem Commit/PR. **Prüfe aber zuerst, ob bereits Hooks, Review-Gates oder Review-Skills (z.B. pre-commit-Hooks, CI-Checks, ein `/code-review`-Skill oder ein konfiguriertes Stop-Review-Gate) vorhanden sind** – wenn ja, nutze bzw. verweise auf diese, statt einen zusätzlichen Review-Subagent doppelt einzusetzen.
- **Recherche-/Explore-Experte** – Durchsucht die Codebase oder externe Quellen und liefert eine verdichtete Zusammenfassung. Vorschlagen bei "Wo ist X?", "Wie hängt Y zusammen?" oder breiter Architektur-Recherche.
- **Test-/Verifikations-Experte** – Führt Tests, Builds oder Linting aus und meldet nur das Ergebnis zurück. Vorschlagen, bevor eine Änderung als fertig gemeldet wird.
- **Refactoring-Experte** – Nimmt mechanische Umbenennungen/Umstrukturierungen über viele Dateien vor. Vorschlagen bei wiederkehrenden Änderungen an vielen Stellen.
- **Datenbank-/Migrations-Experte** – Prüft Schema-Änderungen und Migrationen auf Sicherheit. Vorschlagen bei Eingriffen in DB-Struktur oder Migrationen.

Passt eine dieser Rollen nicht zum Projekt, ist eine **projektspezifische Rolle die bessere Wahl** – etwa ein Experte für die eingesetzte Kassen-, Shop- oder ERP-Schnittstelle, für ein bestimmtes Framework oder für einen wiederkehrenden Datenimport. Solche Rollen aus dem Projekt ableiten und benennen, statt eine der Beispielrollen zu verbiegen.

Diese Rollen kannst du entweder ad-hoc über das Agent/Task-Tool ansprechen oder als feste Subagents unter `~/.claude/agents/` bzw. `.claude/agents/` definieren (mit `use proactively` in der `description`).

