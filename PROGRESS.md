# Fortschritt

Stand: 2026-10-13

## Umgesetzt

- Anforderungen: `PRD.md`, Kostenschätzung `COST-ESTIMATE.md`
- Projektregeln: `CLAUDE.md` (Gateway-Label, Geheimnisse, Dokumentation, Graphify, OpenSpec, Impeccable, Subagents), `.claude/settings.json` mit Label-Hook
- OpenSpec initialisiert (`openspec/`, Kontext in `openspec/config.yaml`)
- Projekt-Agents unter `.claude/agents/`: renovate-config-expert, github-app-integration, coolify-deploy-expert, drizzle-migrations
- Produktbeschreibung `PRODUCT.md` (Impeccable)
- Entwurf der Übersicht bestätigt: `feature-documentation/uebersicht-entwurf.md`
- Renovate-Konfiguration (OpenSpec-Change `renovate-konfiguration`, Gruppen 1–4 und 6): Shared Preset `default.json`, `renovate-ce/config.js`, `renovate.json`, `templates/renovate.json`, Validierungs-Workflow — Doku: `feature-documentation/renovate-konfiguration.md`

## In Arbeit

- Change `compose-stack`: Dateien und lokaler Test fertig (Gruppen 1–4: `deploy/compose.yml`, Dockerfiles, Authelia-Konfiguration, Postgres-Init, Einrichtungsskript, Secrets erzeugt) — Doku `feature-documentation/betrieb-coolify.md`, `feature-documentation/secrets-register.md`. Offen: Gruppe 5 (DNS, Push, Coolify-Ressource, Deploy nach Freigabe, Authelia-Nutzer, GitHub App)
- Change `renovate-konfiguration`: Gruppe 5 (Verifikation am Test-Repo) wartet auf den laufenden Compose-Stack; Change danach archivieren

## Ausstehend

- GitHub App anlegen und installieren (Anleitung in `feature-documentation/betrieb-coolify.md`)
- OpenSpec-Changes: Build-Check-Workflow, Dashboard (Datenmodell, Sync, Ansichten, Onboarding)
- Graphify einrichten, sobald es Code gibt
- `DESIGN.md` nach dem Bau der ersten Oberfläche
