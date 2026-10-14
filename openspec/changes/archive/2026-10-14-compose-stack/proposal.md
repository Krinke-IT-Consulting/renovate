# Proposal

## Why

Das Preset und die globale Konfiguration stehen (Change `renovate-konfiguration`). Noch läuft aber
kein Renovate. Damit Renovate CE die Repos verarbeiten kann und das spätere Dashboard einen
geschützten Platz hat, braucht es den Betriebs-Stack in Coolify. Dafür nötig sind:

- Renovate CE mit erreichbarem Webhook
- Postgres
- Authelia als Login vor allem, was nicht Webhook ist

Erst mit laufendem CE lassen sich die offenen Prüfungen aus `renovate-konfiguration` (Gruppe 5)
an einem echten Repo erledigen.

## What Changes

- **`deploy/docker-compose.yaml`**: ein Docker-Compose-Stack für Coolify auf dem Server `gentle-goose`.
  Er hat vier Dienste:
  - `renovate-ce`: eigenes kleines Image auf Basis von `ghcr.io/mend/renovate-ce` mit
    eingebauter `config.js`
  - `postgres`: Postgres 17 mit den Datenbanken `renovate_ce` und `dashboard`, je mit eigener Rolle
  - `renovate-authelia`: eigenes kleines Image auf Basis von `authelia/authelia` mit eingebauter
    Konfiguration ohne Secrets
  - `renovate-placeholder`: `traefik/whoami` hinter Authelia, bis das Dashboard ihn ersetzt
- **Routing**:
  - `renovate.krinke-it.cloud/webhook` → `renovate-ce`, ohne Login
  - `renovate.krinke-it.cloud` → Authelia-Login (2FA) → `renovate-placeholder`
  - `renovate-auth.krinke-it.cloud` → Authelia
  - Die Job-API von CE ist nur im internen Netz erreichbar.
- **Authelia**:
  - einziger Nutzer ist der Betreiber, mit Passwort und TOTP
  - Für alles, was nicht ausdrücklich erlaubt ist, gilt `deny`.
  - Speicher in SQLite auf einem Volume
  - Codes zur 2FA-Einrichtung als Datei im Container
  - Die Nutzerdatei legt ein Skript einmalig auf dem Volume an, nie im Repo.
- **Konfigurationswerte**:
  - alle Namen in `.env.example`, Werte in `.env.production` und in Coolify
  - selbst erzeugte Werte zusätzlich in `feature-documentation/secrets-register.md`
- **Anleitung für die Schritte von Hand**: GitHub App anlegen und installieren, DNS-Einträge,
  Coolify-Ressource, Authelia-Nutzer, erstes Deploy. Das Deploy erfolgt nur nach ausdrücklicher
  Freigabe.
- Dokumentation in `feature-documentation/betrieb-coolify.md`, Eintrag in `PROGRESS.md`.

Nicht Teil dieses Changes:
- das Dashboard selbst
- der Build-Check
- Backups (Nice-to-have laut PRD; alle Daten lassen sich aus GitHub und CE neu aufbauen)

## Capabilities

### New Capabilities

- `platform-deployment`: Betrieb des Stacks. Dazu gehören:
  - die Dienste und ihre Erreichbarkeit
  - die Webhook-Ausnahme und die interne Job-API
  - die Datenbanken
  - die Herkunft und Ablage aller Konfigurationswerte
  - die Selbstaktualisierung der Images
- `access-protection`: Login vor der Oberfläche. Dazu gehören:
  - der einzige Nutzer
  - 2FA
  - die Standardregel `deny`
  - die Weitergabe der Identität an den geschützten Dienst
  - die Abgrenzung zum Webhook

### Modified Capabilities

(keine)

## Impact

- **Neue Dateien:**
  - `deploy/docker-compose.yaml`
  - `renovate-ce/Dockerfile`
  - `deploy/authelia/Dockerfile`
  - `deploy/authelia/configuration.yml`
  - `deploy/postgres/Dockerfile`
  - `deploy/postgres/init/01-databases.sh`
  - `deploy/scripts/setup-authelia-user.sh`
  - `feature-documentation/betrieb-coolify.md`
  - `feature-documentation/secrets-register.md`
- **Neue Konfigurationswerte:**
  - von Menschen: `MEND_RNV_GITHUB_APP_ID`, `MEND_RNV_GITHUB_APP_KEY`, den Lizenzschlüssel gibt
    es schon
  - selbst erzeugt: Webhook-Secret, API-Secret von CE, Datenbank-Passwörter, drei
    Authelia-Secrets
- **Externe Schritte:**
  - DNS für zwei Hostnamen auf `gentle-goose` (2.28.133.29)
  - eine GitHub App in `Hiwamashi` und `Krinke-IT-Consulting`
  - eine neue Coolify-Ressource
- **Risiko für bestehende Dienste:** Der Server `gentle-goose` trägt bereits vaultsync mit eigenem
  Authelia. Beide Stacks bleiben getrennt, mit eigenen Netzen, Volumes und Hostnamen.
