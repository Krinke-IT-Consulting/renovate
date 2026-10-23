# Spec Delta

## Purpose

Legt das Betriebsverhalten der selbst gehosteten Renovate-CE-Instanz fest: welche Repos sie
verarbeitet, wie sie mit Onboarding, Werkzeugen, privaten Registries und Secrets umgeht und wie
die Konfiguration dieses Repos selbst aktuell und gültig bleibt.

## ADDED Requirements

### Requirement: Nur Repos mit eigener Renovate-Konfiguration verarbeiten
Die CE-Instanz MUST nur Repos verarbeiten, in denen die GitHub App installiert ist und die eine
Renovate-Konfigurationsdatei enthalten. Sie MUST NOT selbst Onboarding-PRs erstellen; das
Onboarding übernimmt das Dashboard.

#### Scenario: Repo ohne renovate.json
- **WHEN** die App in einem Repo installiert ist, das keine Renovate-Konfiguration enthält
- **THEN** überspringt Renovate das Repo, ohne einen PR, Branch oder ein Issue anzulegen

#### Scenario: Repo mit renovate.json
- **WHEN** ein Repo eine `renovate.json` mit dem Preset enthält
- **THEN** verarbeitet Renovate das Repo beim nächsten geplanten oder ausgelösten Lauf

### Requirement: Archivierte Repos und Forks ausschließen
Die CE-Instanz MUST archivierte Repos und Forks nicht verarbeiten.

#### Scenario: Archiviertes Repo
- **WHEN** ein Repo mit installierter App auf GitHub archiviert ist
- **THEN** legt Renovate dort keine Branches, PRs oder Issues an

### Requirement: Werkzeuge bei Bedarf bereitstellen
Die CE-Instanz MUST die für Lockfile-Updates nötigen Werkzeuge (Node, pnpm, Bun, Python, Go,
CocoaPods) in der vom Repo verlangten Version bei Bedarf bereitstellen und in einem persistenten
Cache-Verzeichnis zwischenspeichern.

#### Scenario: Repo mit pnpm und .nvmrc
- **WHEN** Renovate ein Update in einem Repo mit `pnpm-lock.yaml` und `.nvmrc` erstellt
- **THEN** aktualisiert es die Lockfile mit der in `.nvmrc` und `packageManager` angegebenen
  Node- und pnpm-Version

### Requirement: Keine Secrets in versionierten Konfigurationsdateien
Versionierte Konfigurationsdateien (Preset, globale Konfiguration, Vorlagen) MUST NOT Secrets
enthalten. Die globale Konfiguration MUST Secrets ausschließlich aus Umgebungsvariablen lesen
und MUST NOT deren Werte protokollieren oder in Fehlermeldungen ausgeben.

#### Scenario: Prüfung des Repos
- **WHEN** die versionierten Konfigurationsdateien nach Tokens, Schlüsseln oder Passwörtern
  durchsucht werden
- **THEN** finden sich nur Namen von Umgebungsvariablen, keine Werte

### Requirement: Private Scaleway-Registry optional
Ist die Umgebungsvariable `SCW_REGISTRY_SECRET_KEY` gesetzt, MUST die CE-Instanz sich gegenüber
der Scaleway Container Registry mit dem Benutzer `nologin` und diesem Schlüssel anmelden. Ist
sie nicht gesetzt, MUST die Instanz ohne Registry-Zugangsdaten normal starten und arbeiten.

#### Scenario: Variable nicht gesetzt
- **WHEN** die CE-Instanz ohne `SCW_REGISTRY_SECRET_KEY` startet
- **THEN** startet sie fehlerfrei, und Images aus öffentlichen Registries werden aktualisiert,
  einschließlich des öffentlichen Namespaces `rg.nl-ams.scw.cloud/krinke-dockersolutions`

#### Scenario: Variable gesetzt
- **WHEN** die Variable gesetzt ist und ein Repo ein Image aus `rg.nl-ams.scw.cloud` nutzt
- **THEN** kann Renovate die verfügbaren Tags dieses Images abfragen

### Requirement: Selbstaktualisierung dieses Repos
Dieses Repo MUST selbst mit dem eigenen Preset konfiguriert sein, sodass Renovate die
Image-Versionen des eigenen Compose-Stacks, Base-Images in Dockerfiles, die
Dashboard-Abhängigkeiten und die eigenen GitHub Actions aktuell hält.

#### Scenario: Neue Version des CE-Images
- **WHEN** eine neue Version von `ghcr.io/mend/renovate-ce` erscheint und die Compose-Datei eine
  ältere gepinnte Version nutzt
- **THEN** erstellt Renovate in diesem Repo einen PR nach den Regeln des Presets

### Requirement: Vorlage für den Onboarding-PR
Das Repo MUST eine Vorlage `templates/renovate.json` bereitstellen, die ausschließlich das Preset
einbindet. Das Dashboard nutzt sie unverändert für Onboarding-PRs.

#### Scenario: Inhalt der Vorlage
- **WHEN** die Vorlage gelesen wird
- **THEN** enthält sie genau `{"$schema": …, "extends": ["github>Krinke-IT-Consulting/renovate"]}`
  und ist laut `renovate-config-validator` gültig

### Requirement: Automatische Validierung der Konfiguration
Jeder Push und jeder Pull Request in diesem Repo, der eine Renovate-Konfigurationsdatei ändert,
MUST eine Validierung aller Renovate-Konfigurationsdateien des Repos auslösen. Eine ungültige
Datei MUST den Check fehlschlagen lassen.

#### Scenario: Fehler im Preset
- **WHEN** ein PR eine unbekannte Option in `default.json` einführt
- **THEN** schlägt der Validierungs-Check fehl und nennt die betroffene Datei
