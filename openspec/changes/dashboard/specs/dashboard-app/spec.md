# Spec Delta

## Purpose

Betrieb der Anwendung „Krinke-IT - Update Zentrale“: Konfiguration, eigene Datenbank,
Vertrauensgrenze zum Login und Gesundheitszustand. Fachliche Ansichten, Abgleich und Aktionen bauen
darauf auf.

## ADDED Requirements

### Requirement: Konfiguration nur über ein Schema
Das Dashboard MUST alle Konfigurationswerte beim Start gegen ein Schema prüfen. Fehlt ein
Pflichtwert oder ist er ungültig, MUST der Start abbrechen. Die Meldung MUST den Namen der
Variablen nennen und MUST NOT ihren Wert enthalten. Der Build der Anwendung MUST ohne Laufzeit-Secrets
und ohne Datenbank gelingen.

#### Scenario: Fehlender Private Key
- **WHEN** das Dashboard ohne `MEND_RNV_GITHUB_APP_KEY` startet
- **THEN** bricht es mit einer Meldung ab, die `MEND_RNV_GITHUB_APP_KEY` nennt, und gibt keinen
  Wert aus

#### Scenario: Build ohne Secrets
- **WHEN** das Image nur mit Build-Variablen gebaut wird, ohne Secrets und ohne erreichbare
  Datenbank
- **THEN** gelingt der Build

### Requirement: Eigene Datenbank mit versionierten Migrationen
Das Dashboard MUST seine Daten ausschließlich in der Datenbank `dashboard` halten. Das Schema MUST
das Datenmodell aus PRD 4.3 abbilden: Tenant, PlatformConnection, Repository, PullRequest,
RenovateJob, Problem, RolloutAction und AuditLog. Es MUST über versionierte Migrationen entstehen,
die beim Start vor dem Bedienen von Anfragen laufen. Laufen zwei Starts gleichzeitig, MUST jede
Migration genau einmal angewendet werden. Die Datenbank `renovate_ce` MUST NOT direkt gelesen
werden.

#### Scenario: Erster Start mit leerer Datenbank
- **WHEN** das Dashboard zum ersten Mal gegen die leere Datenbank `dashboard` startet
- **THEN** legt es alle Tabellen an und bedient danach Anfragen

#### Scenario: Neustart ohne neue Migration
- **WHEN** das Dashboard neu startet und keine neue Migration vorliegt
- **THEN** bleiben Schema und Daten unverändert

### Requirement: Mandantenfähig vorbereitet
Jeder Datensatz mit Repo-Bezug MUST über PlatformConnection einem Tenant zugeordnet sein. Im MVP
MUST es genau einen Tenant geben, der beim ersten Start angelegt wird. Jede Abfrage von Repo-Daten
MUST nach Tenant eingrenzen.

#### Scenario: Erster Start
- **WHEN** das Dashboard zum ersten Mal startet
- **THEN** existiert genau ein Tenant „Krinke IT“

### Requirement: Nur Anfragen über den Login
Das Dashboard MUST jede Anfrage abweisen, die nicht über Traefik mit vorgeschalteter Authelia
kommt. Erkennbar ist das an einem geheimen Kopfwert, den nur der Traefik-Router setzt. Ausgenommen
ist allein der Healthcheck, der keine Daten preisgibt. Den angemeldeten Nutzer MUST das Dashboard
ausschließlich aus `Remote-User` ableiten. Fehlt der Header, MUST es die Anfrage abweisen.

#### Scenario: Direkter Aufruf im geteilten Netz
- **WHEN** ein anderer Container im Netz `coolify` das Dashboard direkt aufruft und
  `Remote-User: admin` mitschickt
- **THEN** antwortet das Dashboard mit 403 und zeigt keine Daten

#### Scenario: Angemeldeter Aufruf
- **WHEN** der angemeldete Betreiber `https://renovate.krinke-it.cloud/` aufruft
- **THEN** zeigt das Dashboard die Übersicht und im Kopf seinen Kontonamen

### Requirement: Gesundheitszustand
Das Dashboard MUST einen Healthcheck bereitstellen. Er meldet nur dann „gesund“, wenn die Datenbank
erreichbar ist und die Migrationen angewendet sind. Der Zustand der Fremdsysteme GitHub und
Renovate CE MUST NOT in den Healthcheck eingehen; ihn zeigt der Abgleich-Stempel.

#### Scenario: GitHub nicht erreichbar
- **WHEN** die GitHub-API nicht antwortet, die Datenbank aber erreichbar ist
- **THEN** meldet der Healthcheck „gesund“, und der Abgleich-Stempel zeigt den Fehler

### Requirement: Abgleich-Stempel
Jede Seite MUST anzeigen, wann die Daten aus GitHub und aus Renovate CE zuletzt erfolgreich
abgeglichen wurden. Schlug der letzte Versuch fehl, MUST der Stempel den Fehler mit Uhrzeit nennen,
und die zuletzt abgeglichenen Daten MUST sichtbar bleiben. Zeiten MUST relativ angezeigt werden,
absolut beim Überfahren, in der Zeitzone Europe/Berlin.

#### Scenario: Renovate CE nicht erreichbar
- **WHEN** der Abgleich mit Renovate CE seit zehn Minuten fehlschlägt
- **THEN** zeigt der Stempel „Renovate CE: Abgleich fehlgeschlagen“ mit Uhrzeit, und die Jobs von
  vorher bleiben sichtbar
