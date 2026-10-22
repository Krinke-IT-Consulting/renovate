# Spec Delta

## ADDED Requirements

### Requirement: Mergen in den Ansichten anbieten
Für einen offenen PR mit grüner CI MUST das Dashboard das Mergen dort anbieten, wo der PR erscheint:
- in der PR-Liste
- in der PR-Liste des Repo-Details
- als Hauptaktion des Lagebericht-Schritts bei Sicherheitsupdates und Major-Updates

Ist die CI nicht grün, MUST an dieser Stelle der Link zum PR auf der Plattform stehen und kein
Merge-Knopf. Die Seite Pull Requests MUST den Sammel-Merge mit der Zahl der erfassten PRs anbieten,
sofern mindestens ein PR dafür in Frage kommt. Auf Mobil MUST jede Merge-Aktion erreichbar sein.

#### Scenario: Grünes Sicherheitsupdate im Lagebericht
- **WHEN** ein Sicherheitsupdate mit grüner CI offen ist
- **THEN** ist die Hauptaktion des Schritts „Mergen“ mit Bestätigung, nicht der Link zur Plattform

#### Scenario: Rote CI
- **WHEN** ein PR rote CI hat
- **THEN** zeigt die PR-Liste keinen Merge-Knopf für ihn, sondern den Link zum PR

#### Scenario: Nichts für den Sammel-Merge
- **WHEN** kein offener grüner Patch- oder Minor-PR existiert
- **THEN** zeigt die Seite Pull Requests keinen Knopf für den Sammel-Merge
