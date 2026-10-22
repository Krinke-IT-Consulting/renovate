# Fortschritt

Stand: 2026-10-22

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
- Dashboard Phase 8 „Abschluss“, Task 8.1 (`/impeccable audit`): Audit 15/20, Befunde behoben, PR #21 gemergt — Doku: `feature-documentation/dashboard/bausteine.md` (Abschnitt „Audit-Korrekturen“)
- Dashboard Phase 7 „Aktionen“ (Tasks 7.1 bis 7.6, PR #17 und Fix #18, deployt am 2026-10-21): Bestätigungsdialog, Server Actions und AuditLog; Läufe für ein Repo und alle; Onboarding- und Build-Check-PRs über die Git-Data-API mit Idempotenz und Aufräumen; Markierung „eigene CI“; automatisches Onboarding je Owner. Abnahme 7.6: Lauf für `Krinke-IT-Consulting/renovate` aus dem Dashboard gestartet, in AuditLog und Job-Liste sichtbar. Dabei behoben: laufende Jobs der CE-Historie galten als fehlgeschlagen. Task 7.7: erster echter Onboarding-PR `Hiwamashi/lector#1` am 2026-10-21 aus dem Dashboard angelegt und gemergt; der Build-Check lief (Docker und Compose grün, Python rot durch einen eigenen Testfehler in lector) — Doku: `feature-documentation/dashboard/aktionen.md`, `rollout.md`
- OpenSpec-Change `dashboard` archiviert am 2026-10-22 (`openspec/changes/archive/2026-10-22-dashboard/`; neue Specs `dashboard-app`, `dashboard-sync`, `dashboard-views`, `dashboard-actions`, geändert `platform-deployment`, `access-protection`)
- Dashboard Phase 8 „Abschluss“ (Tasks 8.2 bis 8.4): `DESIGN.md` (PR #22, vom Betreiber gesichtet), Feature-Doku `feature-documentation/dashboard/README.md`, `betrieb.md`, `datenmodell.md`, `abgleich.md` (PR #23), Abschluss-Review mit Sicherheitsblick, Befunde behoben (PR #24); Spec `dashboard-app`: Tenant-Eingrenzung kommt mit der Mandanten-Sicht

## In Arbeit

- Change `renovate-konfiguration`: offen 5.1 (kein Automerge ohne Checks, braucht ein Repo ohne CI) und 5.2 (Limits bei Sicherheits-PRs, braucht einen echten Sicherheitsfall)
- Change `dashboard-pr-merge` (Mergen im Dashboard): Tasks 1.1 bis 4.4 umgesetzt (Task 1.1 auf Entscheidung des Betreibers entfallen). Einzel- und Sammel-Merge mit Live-Prüfung, Merge-Methoden, AuditLog, Oberfläche in Liste, Repo-Detail und Lagebericht. Review-Befunde korrigiert (Commit `8d52d74`). Offen: Review und Deployment (5.2) — Doku: `feature-documentation/dashboard/merge.md`

## Ausstehend

- GitHub App für weitere Repos installieren (über das Dashboard-Onboarding oder von Hand), Build-Check-Aufruf in weitere Repos ausrollen
- npm 12: Freigabeliste für Install-Skripte (`allowScripts`) in den Node-Repos, offene Frage im Design von `build-check`
- Graphify einrichten, sobald es Code gibt
