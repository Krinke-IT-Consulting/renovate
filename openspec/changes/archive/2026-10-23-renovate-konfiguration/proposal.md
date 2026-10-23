# Proposal

## Why

Rund 25 Repos aus `Hiwamashi` und `Krinke-IT-Consulting` haben bisher weder Renovate- noch
Dependabot-Konfiguration; Abhängigkeiten und Sicherheitslücken bleiben liegen. Bevor Renovate CE
deployt und Repos onboardet werden, müssen die Regeln feststehen, nach denen Renovate arbeitet: das
gemeinsame Preset für alle Repos und die globale Betriebskonfiguration der CE-Instanz. Beides
lässt sich ohne Lizenzschlüssel und GitHub App vorbereiten und prüfen.

## What Changes

- **Shared Preset `default.json`** im Repo-Root, eingebunden per
  `"extends": ["github>Krinke-IT-Consulting/renovate"]`:
  - Basis `config:recommended`, Dependency Dashboard, Zeitzone `Europe/Berlin`
  - Zeitplan: normale Updates nur am Wochenende (Samstag und Sonntag)
  - zwei Gruppen je Repo: **Patch-Gruppe** (Patch-Updates, Digests, Nicht-Major-Updates von
    devDependencies) mit Automerge bei grünem Build, **Minor-Gruppe** ohne Automerge; Major-Updates
    einzeln und nie automatisch gemergt
  - Sicherheitsupdates (`vulnerabilityAlerts`, `osvVulnerabilityAlerts`) ohne Zeitplan, Label
    `security`, nie gruppiert mit normalen Updates
  - Labels `dependencies`, `renovate` und Update-Typ; Conventional Commits (`chore(deps): …`)
  - Major-Updates erst nach Freigabe im Dependency Dashboard (passt zum Schritt „Major-Updates
    zur Freigabe" im Entwurf der Übersicht)
  - Pinning von GitHub Actions auf Digests, Limits für gleichzeitige und stündliche PRs
- **Globale CE-Konfiguration `renovate-ce/config.js`** (Self-Hosted-Optionen): eigenes Onboarding
  aus (`onboarding: false`, `requireConfig: "required"`), archivierte Repos ausgeschlossen,
  `binarySource: "install"` mit Cache-Verzeichnis, keine Secrets in der Datei. Dort liegt auch die
  `hostRules`-Vorlage für die Scaleway Container Registry: Sie greift nur, wenn die
  Umgebungsvariable `SCW_REGISTRY_SECRET_KEY` gesetzt ist. Im öffentlichen Preset wäre sie
  falsch aufgehoben, weil ein Preset keine Secrets lesen kann.
- **`renovate.json` für dieses Repo**: nutzt das eigene Preset, hält Compose-Images, Dockerfiles,
  Dashboard-Abhängigkeiten und Actions aktuell (Selbstaktualisierung).
- **Vorlage `templates/renovate.json`** für den späteren Onboarding-PR des Dashboards.
- **Validierungs-Workflow** `.github/workflows/validate-renovate.yml`: prüft `default.json`,
  `renovate.json` und `templates/renovate.json` bei jedem Push und PR mit
  `renovate-config-validator`.
- Dokumentation in `feature-documentation/renovate-konfiguration.md`, Eintrag in `PROGRESS.md`.

Nicht Teil dieses Changes: Build-Check-Workflow und Aufruf-Vorlage, Compose-Stack, Dashboard.

## Capabilities

### New Capabilities

- `renovate-preset`: Regeln, die für jedes onboardete Repo gelten — Zeitplan, Gruppierung,
  Automerge, Major-Freigabe, Sicherheitsupdates, Labels, Commits, Limits.
- `renovate-engine-config`: Betriebsverhalten der CE-Instanz — welche Repos verarbeitet werden,
  Onboarding-Verhalten, Tool-Bereitstellung, private Registry, Umgang mit Secrets,
  Selbstaktualisierung und Validierung der Konfiguration.

### Modified Capabilities

(keine — es gibt noch keine Specs)

## Impact

- Neue Dateien: `default.json`, `renovate.json`, `templates/renovate.json`,
  `renovate-ce/config.js`, `.github/workflows/validate-renovate.yml`,
  `feature-documentation/renovate-konfiguration.md`.
- Das Repo ist öffentlich: Das Preset wirkt sofort auf jedes Repo, das es einbindet. Änderungen
  an `default.json` sind damit Verhaltensänderungen für alle Repos.
- Folge-Changes bauen darauf auf: Build-Check (Automerge setzt grüne Checks voraus),
  Compose-Stack (bindet `config.js` ein, liefert Secrets per Umgebungsvariablen), Dashboard
  (nutzt `templates/renovate.json` für Onboarding-PRs).
- Ein neuer, optionaler Konfigurationswert `SCW_REGISTRY_SECRET_KEY` (Herkunft: Mensch). Er kommt
  in `.env.example`; die Durchreichung in die Compose-Datei folgt im Change für den Compose-Stack.
