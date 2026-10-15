# Proposal

## Why

Renovate CE läuft, hat aber keine Oberfläche. Der Stand der rund 25 Repos lässt sich nur aus den
Dependency-Dashboard-Issues und den PRs der einzelnen Repos zusammensuchen. Außerdem muss jedes Repo
von Hand onboardet werden. Unter `renovate.krinke-it.cloud` steht noch ein Platzhalter. Das
Dashboard, die „Krinke-IT - Update Zentrale“, schließt diese Lücke: eine Stelle für den Zustand
aller Repos, mit Onboarding und Läufen auf Knopfdruck (PRD 3.1).

## What Changes

Ein Change für das gesamte Dashboard (Antwort 1c). Es wird früh deployt (Antwort 3a): Sobald das
Grundgerüst steht, ersetzt es nach Freigabe den Platzhalter.

- **Anwendung `dashboard/`:**
  - Next.js (App Router, TypeScript), Tailwind CSS, shadcn/ui, TanStack Table
  - Env-Schema `src/env.ts` mit zod
  - Dockerfile mit gepinntem Node-Basisimage
  - Healthcheck
- **Datenmodell:** das gesamte Modell aus PRD 4.3 in der Datenbank `dashboard`, mit Drizzle und
  versionierten Migrationen, die beim Containerstart laufen (Antwort 2a):
  - Tenant, PlatformConnection, Repository, PullRequest
  - RenovateJob, Problem, RolloutAction, AuditLog
- **Abgleich (Hintergrund-Worker im Dashboard-Prozess, mit Sperre in Postgres):**
  - **Plattform:** über das Interface `PlatformAdapter` mit der Implementierung `GitHubAdapter`.
    Es liest Installationen, Repos, Renovate-PRs mit CI-Status, das Dependency-Dashboard-Issue und
    die Build-Check-Aufrufdatei. Bedingte Requests mit ETags.
  - **Renovate CE:** über die interne API. Repo-Status, Job-Historie je Repo, Warteschlange und
    Log-Auszüge.
  - **Probleme:** Daraus leitet der Worker sie ab:
    - Konfigurationsfehler und fehlgeschlagene Läufe
    - Lockfile-Fehler
    - hängende PRs und rote CI
    - fehlender Build-Check
- **Ansichten**, alle deutsch, nur heller Modus, responsive:
  - Übersicht als „Lagebericht“ nach dem bestätigten Entwurf (`feature-documentation/uebersicht-entwurf.md`)
  - Repos und Repo-Detail
  - Pull Requests über alle Repos
  - Jobs mit Log-Auszug
  - Probleme
- **Aktionen**, jede mit Bestätigungsdialog und Eintrag im AuditLog:
  - Renovate-Lauf für ein Repo oder alle Repos anstoßen
  - Onboarding-PR anlegen (`renovate.json` und Build-Check-Aufruf)
  - Build-Check-Aufruf nachträglich ausrollen
  - Schalter für automatisches Onboarding je Owner
  - Repo als „eigene CI“ markieren (Repos mit vollständiger CI brauchen keinen Build-Check,
    Antwort 4a aus `build-check`)
- **Stack:**
  - Der Dienst `renovate-placeholder` wird durch `renovate-dashboard` ersetzt. Router, Authelia-Middleware
    und Domain bleiben.
  - Renovate CE bekommt zusätzlich die Reporting-API.
  - Das Dashboard nutzt dieselbe GitHub App und dasselbe API-Secret wie CE. Hinzu kommt ein neues,
    selbst erzeugtes Secret, das Anfragen über Traefik von direkten Zugriffen im geteilten Netz
    unterscheidet.
- **Gestaltung:** Für die Seiten außer der Übersicht vorher `/impeccable shape`. Vor Abschluss
  `/impeccable audit`, danach `DESIGN.md` mit `/impeccable document`.
- **Doku:**
  - Feature-Doku unter `feature-documentation/dashboard/`
  - `betrieb-coolify.md`, `secrets-register.md`, `.env.example` und `PROGRESS.md` nachziehen

Nicht Teil dieses Changes (PRD 3.2):
- Mandanten-Sicht und GitLab
- Benachrichtigungen
- Backups
- Prometheus
- Paket-Suche über alle Repos

## Capabilities

### New Capabilities

- `dashboard-app`: Betrieb der Anwendung. Dazu gehören:
  - Env-Schema, Datenbank und Migrationen
  - Vertrauen in den Login-Header
  - Healthcheck und Abgleich-Stempel
  - Mandanten-Vorbereitung
- `dashboard-sync`: Abgleich mit Plattform und Renovate CE. Dazu gehören:
  - `PlatformAdapter`, Intervalle, Sperre, ETags
  - Erkennung von Update-Typ, Onboarding- und Build-Check-Status
  - Ableitung der Probleme
- `dashboard-views`: Lagebericht und die Ansichten Repos, Repo-Detail, Pull Requests, Jobs und
  Probleme, mit ihren Zuständen
- `dashboard-actions`: Läufe anstoßen, Onboarding- und Build-Check-PRs, automatisches Onboarding,
  Bestätigung und AuditLog

### Modified Capabilities

- `platform-deployment`:
  - Der geschützte Dienst ist nun das Dashboard statt eines Platzhalters.
  - Die Datenbank `dashboard` erhält ihre Tabellen per Migration.
  - Das Dashboard nutzt die interne CE-API.
- `access-protection`: Die Identität wird an das Dashboard weitergegeben. Das Dashboard bedient nur
  Anfragen, die über Traefik und Authelia kommen.

## Impact

- **Neu:**
  - `dashboard/`: App, Migrationen, Tests, Dockerfile
  - `feature-documentation/dashboard/`
  - `DESIGN.md`
- **Geändert:**
  - `deploy/docker-compose.yaml`: Dashboard-Dienst statt Platzhalter, Reporting-API an CE
  - `.env.example`
  - `.github/workflows/build-check-self.yml`: Postgres für die Dashboard-Tests
  - `betrieb-coolify.md`, `secrets-register.md`, `PROGRESS.md`
- **Entfernt:** `deploy/placeholder/`
- **Neuer Konfigurationswert:** `DASHBOARD_PROXY_SECRET`, selbst erzeugt. Er kommt in
  `.env.example`, `.env.production`, Coolify und das Secrets-Register. Die übrigen Werte gibt es
  schon:
  - `DASHBOARD_DB_PASSWORD`
  - `MEND_RNV_API_SERVER_SECRET`
  - `MEND_RNV_GITHUB_APP_ID`
  - `MEND_RNV_GITHUB_APP_KEY`
- **GitHub App:** Für den Rollout der Aufruf-Datei braucht sie Schreibrecht auf Workflows. Für den
  CI-Status braucht sie Leserecht auf Checks und Commit-Status. Fehlende Rechte trägt der Betreiber
  von Hand nach.
- **Externe Schritte, nur nach Freigabe:**
  - Deployments in Coolify
  - Onboarding-PRs in fremden Repos
- **Ressourcen:** Das Dashboard bekommt eine Speichergrenze von 512 MB. Der Server hat 7,7 GB RAM
  ohne Swap, davon sind 3 GB für CE reserviert.
- **Renovate und Build-Check:** Beide erfassen `dashboard/` ohne weitere Konfiguration. Patch-Updates
  der Dashboard-Abhängigkeiten werden nur bei grünem Build-Check automatisch gemergt.
