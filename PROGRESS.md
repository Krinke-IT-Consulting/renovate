# Fortschritt

Stand: 2026-10-21

## Umgesetzt

- Anforderungen: `PRD.md`, Kostenschätzung `COST-ESTIMATE.md`
- Projektregeln: `CLAUDE.md` (Gateway-Label, Geheimnisse, Dokumentation, Graphify, OpenSpec, Impeccable, Subagents), `.claude/settings.json` mit Label-Hook
- OpenSpec initialisiert (`openspec/`, Kontext in `openspec/config.yaml`)
- Projekt-Agents unter `.claude/agents/`: renovate-config-expert, github-app-integration, coolify-deploy-expert, drizzle-migrations
- Produktbeschreibung `PRODUCT.md` (Impeccable)
- Entwurf der Übersicht bestätigt: `feature-documentation/uebersicht-entwurf.md`
- Renovate-Konfiguration (OpenSpec-Change `renovate-konfiguration`, Gruppen 1–4 und 6): Shared Preset `default.json`, `renovate-ce/config.js`, `renovate.json`, `templates/renovate.json`, Validierungs-Workflow — Doku: `feature-documentation/renovate-konfiguration.md`
- Betriebs-Stack (Change `compose-stack`, archiviert; Specs `platform-deployment` und `access-protection`): Renovate CE, Postgres, Authelia (2FA) und Platzhalter laufen auf Coolify (`gentle-goose`), `renovate.krinke-it.cloud` hinter Login, Webhook unter `/webhook`; GitHub App „Krinke IT Renovate“ installiert für `Krinke-IT-Consulting/renovate` — Doku: `feature-documentation/betrieb-coolify.md`, `feature-documentation/secrets-register.md`

- Build-Check (Change `build-check`, archiviert; Spec `build-check`): Reusable Workflow `.github/workflows/build-check.yml`, Aufruf-Vorlage `templates/build-check-caller.yml`, Selbsttest mit 11 Beispielen; Release `v1.1.0` (`v1` zeigt darauf) mit Erkennung des Docker-Build-Kontexts; Pilot `Hiwamashi/smoking-tracker` grün — Doku: `feature-documentation/build-check.md`
- Dashboard Phase 6 „Ansichten“ (Tasks 6.1 bis 6.7, PR #15, deployt am 2026-10-20 und vom Betreiber gesichtet): Seiten `/` (Lagebericht), `/repos`, `/repos/[owner]/[name]`, `/pull-requests`, `/jobs`, `/probleme`; Fixtures und Playwright-Smoke — Doku: `feature-documentation/dashboard/ansichten.md`, `lagebericht.md`, `bausteine.md`, `tests-und-fixtures.md`

## In Arbeit

- Dashboard Phase 7 „Aktionen“, Teil Oberfläche (Branch `feat/dashboard-aktionen`; Tasks 7.1, 7.2, 7.4 nur Markierung „eigene CI“, 7.5 nur Schalter): Bestätigungsdialog, Server Actions, AuditLog, Läufe anstoßen, Knöpfe in Repo-Detail, Lagebericht und Jobs — Doku: `feature-documentation/dashboard/aktionen.md`. Die Rollout-Logik (7.3, Rollout-Teil von 7.4, Wirkung von 7.5) kommt aus einem parallelen Strang; `dashboard/src/rollout/service.ts` ist inzwischen die echte Logik (`rollout.md`). Review-Befunde A1 bis A5 und G1 bis G8 behoben: Rollout-Meldung bleibt sichtbar (`resultKey`), Auto-Onboarding je Connection mit `failed`-Spur, Audit-Aktionen `….failed`, eine `GitHubAdapter`-Instanz je Prozess, Live-Dateiprüfung, Cleanup und Fehlertexte im Adapter, E2E-Erfolgspfad über Plattform-Ersatz.

- Change `renovate-konfiguration`: offen 5.1 (kein Automerge ohne Checks, braucht ein Repo ohne CI) und 5.2 (Limits bei Sicherheits-PRs, braucht einen echten Sicherheitsfall)

## Ausstehend

- GitHub App für weitere Repos installieren (über das Dashboard-Onboarding oder von Hand), Build-Check-Aufruf in weitere Repos ausrollen
- npm 12: Freigabeliste für Install-Skripte (`allowScripts`) in den Node-Repos, offene Frage im Design von `build-check`
- Dashboard Phase 7 („Aktionen“), Rest: Onboarding-PR und Build-Check-Rollout (Logik gegen die GitHub-API), Auto-Onboarding im Abgleich, Prüfung 7.6, erster echter PR 7.7
- OpenSpec-Changes: Dashboard (Datenmodell, Sync, Onboarding)
- Graphify einrichten, sobald es Code gibt
- `DESIGN.md` nach dem Bau der ersten Oberfläche
