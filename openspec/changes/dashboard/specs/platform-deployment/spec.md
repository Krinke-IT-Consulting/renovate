# Spec Delta

## MODIFIED Requirements

### Requirement: Ein Stack mit allen Diensten
Die Plattform MUST als ein einziger Stack betrieben werden. Er enthält Renovate CE, Postgres,
Authelia und das Dashboard als geschützten Oberflächen-Dienst. Alle Dienste MUST nach einem
Neustart des Servers ohne Eingriff wieder starten, und jeder Dienst MUST einen Gesundheitszustand
melden.

#### Scenario: Neustart des Servers
- **WHEN** der Server neu startet
- **THEN** laufen alle vier Dienste danach wieder und melden sich als gesund

### Requirement: Getrennte Datenbanken
Postgres MUST die Datenbanken `renovate_ce` und `dashboard` bereitstellen, jede mit eigener Rolle
und eigenem Passwort. Die Rolle einer Datenbank MUST NOT auf die andere Datenbank zugreifen
können. Das Dashboard MUST seine Tabellen in `dashboard` selbst per Migration anlegen.

#### Scenario: Erster Start
- **WHEN** der Stack zum ersten Mal mit leerem Datenbank-Volume startet
- **THEN** existieren beide Datenbanken mit ihren Rollen, Renovate CE legt seine Tabellen in
  `renovate_ce` an und das Dashboard seine in `dashboard`

#### Scenario: Zugriff über Kreuz
- **WHEN** sich die Rolle für `dashboard` mit der Datenbank `renovate_ce` verbinden will
- **THEN** wird die Verbindung abgelehnt

## ADDED Requirements

### Requirement: Dashboard nutzt die interne API von Renovate CE
Das Dashboard MUST Renovate CE ausschließlich über deren API im internen Netz des Stacks
ansprechen, authentifiziert mit dem Server-Secret. Renovate CE MUST dafür die Job-, System- und
Reporting-API bereitstellen. Das Dashboard MUST NOT Pfade dieser API nach außen durchreichen.

#### Scenario: Job-Historie lesen
- **WHEN** das Dashboard die Job-Historie eines Repos abfragt
- **THEN** antwortet Renovate CE über das interne Netz, ohne dass ein Router oder Port nach außen
  dafür existiert

#### Scenario: Aufruf ohne Secret
- **WHEN** ein Dienst im Stack die API von Renovate CE ohne Server-Secret aufruft
- **THEN** weist Renovate CE die Anfrage ab
