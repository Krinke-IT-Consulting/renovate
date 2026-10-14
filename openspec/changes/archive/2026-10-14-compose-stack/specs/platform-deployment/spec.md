# Spec Delta

## Purpose

Legt fest, wie die Renovate-Plattform betrieben wird: welche Dienste laufen, wie sie von außen
und intern erreichbar sind, woher ihre Konfigurationswerte kommen und wie der Stack aktuell bleibt.

## ADDED Requirements

### Requirement: Ein Stack mit allen Diensten
Die Plattform MUST als ein einziger Stack betrieben werden. Er enthält Renovate CE, Postgres,
Authelia und den geschützten Oberflächen-Dienst. Bis zum Dashboard ist dieser Dienst ein
Platzhalter. Alle Dienste MUST nach einem Neustart des Servers ohne Eingriff wieder starten, und
jeder Dienst MUST einen Gesundheitszustand melden.

#### Scenario: Neustart des Servers
- **WHEN** der Server neu startet
- **THEN** laufen alle vier Dienste danach wieder und melden sich als gesund

### Requirement: Webhook öffentlich, aber geprüft
Der Pfad `https://renovate.krinke-it.cloud/webhook` MUST ohne Login direkt Renovate CE erreichen.
Renovate CE MUST nur Webhooks verarbeiten, die mit dem Webhook-Secret der GitHub App signiert
sind.

#### Scenario: Echter Webhook von GitHub
- **WHEN** GitHub nach einem Push einen signierten Webhook an `/webhook` sendet
- **THEN** nimmt Renovate CE ihn an, ohne dass ein Login verlangt wird

#### Scenario: Gefälschter Webhook
- **WHEN** jemand eine Anfrage ohne gültige Signatur an `/webhook` sendet
- **THEN** wird sie abgewiesen und löst keinen Lauf aus

### Requirement: Interne Dienste nicht öffentlich
Die Job-API von Renovate CE und Postgres MUST NOT von außerhalb des Stacks erreichbar sein, weder
über einen Hostnamen noch über einen veröffentlichten Port. Von außen MUST nur `/webhook` von
Renovate CE erreichbar sein.

#### Scenario: Zugriff auf die Job-API von außen
- **WHEN** jemand von außen einen API-Pfad von Renovate CE aufruft
  (etwa `https://renovate.krinke-it.cloud/api/...`)
- **THEN** erreicht die Anfrage Renovate CE nicht; sie endet am Login bzw. am geschützten Dienst

#### Scenario: Postgres-Port
- **WHEN** jemand von außen Port 5432 des Servers anspricht
- **THEN** antwortet kein Postgres dieses Stacks

### Requirement: Getrennte Datenbanken
Postgres MUST die Datenbanken `renovate_ce` und `dashboard` bereitstellen, jede mit eigener Rolle
und eigenem Passwort. Die Rolle einer Datenbank MUST NOT auf die andere Datenbank zugreifen
können.

#### Scenario: Erster Start
- **WHEN** der Stack zum ersten Mal mit leerem Datenbank-Volume startet
- **THEN** existieren beide Datenbanken mit ihren Rollen, und Renovate CE legt seine Tabellen in
  `renovate_ce` an

#### Scenario: Zugriff über Kreuz
- **WHEN** sich die Rolle für `dashboard` mit der Datenbank `renovate_ce` verbinden will
- **THEN** wird die Verbindung abgelehnt

### Requirement: Renovate CE verarbeitet die Repos beider Owner
Renovate CE MUST sich als GitHub App anmelden. Es MUST alle Repos verarbeiten, in denen die App
installiert ist, sofern sie zu `Hiwamashi` oder `Krinke-IT-Consulting` gehören. Dabei MUST die
versionierte globale Konfiguration aus `renovate-ce/config.js` gelten. Der Cache für Werkzeuge
und Repos MUST einen Neustart überdauern.

#### Scenario: App-Installation in einem Repo
- **WHEN** die App in einem Repo mit `renovate.json` installiert wird
- **THEN** verarbeitet Renovate CE das Repo spätestens beim nächsten geplanten Lauf und legt das
  Dependency Dashboard an

#### Scenario: Neustart mit warmem Cache
- **WHEN** Renovate CE neu startet
- **THEN** sind zuvor installierte Werkzeugversionen weiterhin vorhanden

### Requirement: Herkunft aller Konfigurationswerte
Jeder Konfigurationswert des Stacks MUST in `.env.example` mit Namen, leerem Wert und
Herkunftskommentar stehen. Sein Wert MUST in `.env.production` stehen und in Coolify hinterlegt
sein. Selbst erzeugte Werte MUST zusätzlich im Secrets-Register beschrieben sein, mit Name,
Zweck und Neuerzeugung, aber ohne Wert. Kein Wert MUST in einer versionierten Datei, einem Image
oder einer Protokollausgabe erscheinen.

#### Scenario: Neu aufsetzen
- **WHEN** jemand den Stack anhand von `.env.example` und Secrets-Register neu aufsetzt
- **THEN** weiß er für jeden Namen, woher der Wert kommt und ob er zwingend ist

#### Scenario: Fehlender Pflichtwert
- **WHEN** ein Pflichtwert wie der Lizenzschlüssel fehlt
- **THEN** startet der betroffene Dienst nicht, und die Meldung nennt höchstens den Namen der
  Variable, nie einen Wert

### Requirement: Images gepinnt und von Renovate gepflegt
Alle Basis-Images des Stacks MUST auf eine konkrete Version gepinnt sein. Renovate MUST sie über
die repo-eigene Konfiguration aktuell halten.

#### Scenario: Neue Authelia-Version
- **WHEN** eine neue Version von `authelia/authelia` erscheint
- **THEN** erstellt Renovate in diesem Repo einen PR, der die Version im Dockerfile anhebt

### Requirement: Kein Deploy ohne Freigabe
Ein Deploy, Neustart oder Stopp des Stacks durch einen KI-Agenten MUST NOT ohne ausdrückliche
Freigabe des Betreibers erfolgen.

#### Scenario: Agent ist mit der Vorbereitung fertig
- **WHEN** ein Agent alle Dateien und Variablen vorbereitet hat
- **THEN** fragt er nach der Freigabe, bevor er ein Deploy auslöst
