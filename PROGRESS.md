# Fortschritt

Stand: 2026-10-14

## Umgesetzt

- Anforderungen: `PRD.md`, Kostenschätzung `COST-ESTIMATE.md`
- Projektregeln: `CLAUDE.md` (Gateway-Label, Geheimnisse, Dokumentation, Graphify, OpenSpec, Impeccable, Subagents), `.claude/settings.json` mit Label-Hook
- OpenSpec initialisiert (`openspec/`, Kontext in `openspec/config.yaml`)
- Projekt-Agents unter `.claude/agents/`: renovate-config-expert, github-app-integration, coolify-deploy-expert, drizzle-migrations
- Produktbeschreibung `PRODUCT.md` (Impeccable)
- Entwurf der Übersicht bestätigt: `feature-documentation/uebersicht-entwurf.md`
- Renovate-Konfiguration (OpenSpec-Change `renovate-konfiguration`, Gruppen 1–4 und 6): Shared Preset `default.json`, `renovate-ce/config.js`, `renovate.json`, `templates/renovate.json`, Validierungs-Workflow — Doku: `feature-documentation/renovate-konfiguration.md`
- Betriebs-Stack (Change `compose-stack`, alle Tasks): Renovate CE, Postgres, Authelia (2FA) und Platzhalter laufen auf Coolify (`gentle-goose`), `renovate.krinke-it.cloud` hinter Login, Webhook unter `/webhook`; GitHub App „Krinke IT Renovate“ installiert für `Krinke-IT-Consulting/renovate` — Doku: `feature-documentation/betrieb-coolify.md`, `feature-documentation/secrets-register.md`

## In Arbeit

- Change `renovate-konfiguration`: offen 5.1 (kein Automerge ohne Checks, braucht ein Repo ohne CI) und 5.2 (Limits bei Sicherheits-PRs, braucht einen echten Sicherheitsfall)

## Ausstehend

- GitHub App für weitere Repos installieren (über das Dashboard-Onboarding oder von Hand)
- OpenSpec-Changes: Build-Check-Workflow, Dashboard (Datenmodell, Sync, Ansichten, Onboarding)
- Graphify einrichten, sobald es Code gibt
- `DESIGN.md` nach dem Bau der ersten Oberfläche
