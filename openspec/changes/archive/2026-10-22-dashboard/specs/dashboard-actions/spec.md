# Spec Delta

## Purpose

Aktionen aus dem Dashboard heraus: Renovate-Läufe anstoßen und Repos per PR onboarden. Jede Aktion
ist bestätigt, nachvollziehbar protokolliert und hinterlässt einen Link.

## ADDED Requirements

### Requirement: Bestätigung, Protokoll und Rückmeldung
Jede Aktion MUST vor der Ausführung einen Bestätigungsdialog zeigen, der ihre Wirkung nennt. Jede
ausgeführte Aktion MUST im AuditLog mit Nutzer aus `Remote-User`, Aktion, Ziel und Zeitpunkt
stehen. Danach MUST eine Meldung erscheinen, mit Link zum PR bzw. Job oder mit dem Fehler.
Aktionen MUST nur über Formularanfragen derselben Herkunft ausgelöst werden können.

#### Scenario: Abgebrochene Bestätigung
- **WHEN** der Betreiber im Bestätigungsdialog „Abbrechen“ wählt
- **THEN** passiert nichts, und es entsteht kein AuditLog-Eintrag

### Requirement: Renovate-Lauf anstoßen
Der Betreiber MUST einen Lauf für ein einzelnes Repo und für alle onboardeten, nicht archivierten
Repos anstoßen können. Das Dashboard reiht dafür je Repo einen Job über die interne API von
Renovate CE ein. Ist für ein Repo schon ein Job wartend oder laufend, MUST kein zweiter entstehen.

#### Scenario: Lauf für ein Repo
- **WHEN** der Betreiber für smoking-tracker „Lauf starten“ bestätigt
- **THEN** reiht Renovate CE einen Job ein, und die Meldung verweist auf die Job-Ansicht des Repos

#### Scenario: Lauf für alle Repos
- **WHEN** der Betreiber „Alle Repos laufen lassen“ bestätigt
- **THEN** wird für jedes onboardete, nicht archivierte Repo genau ein Job eingereiht, und die
  Meldung nennt die Anzahl

### Requirement: Onboarding-PR
Für ein nicht onboardetes Repo MUST das Dashboard genau einen Onboarding-PR anlegen können. Er
enthält die `renovate.json` und die Build-Check-Aufrufdatei aus den Vorlagen unter `templates/`
dieses Repos, Stand Default-Branch. Existiert schon ein offener Onboarding-PR oder eine
Renovate-Konfiguration, MUST kein zweiter entstehen. Der PR-Text MUST erklären, was der PR bewirkt
und welche Eingaben des Build-Checks das Repo eventuell braucht. Jede Ausführung MUST als
RolloutAction mit Status und PR-Link gespeichert werden.

#### Scenario: Onboarding per Klick
- **WHEN** der Betreiber für ein nicht onboardetes Repo „Onboarding-PR anlegen“ bestätigt
- **THEN** entsteht ein PR mit beiden Dateien, das Repo hat den Status `pr_open`, und die Meldung
  verlinkt den PR

#### Scenario: Wiederholter Klick
- **WHEN** für dasselbe Repo bereits ein offener Onboarding-PR existiert
- **THEN** entsteht kein zweiter PR, und die Meldung verlinkt den vorhandenen

#### Scenario: Fehlende Rechte
- **WHEN** die GitHub App im Repo keine Schreibrechte auf Workflows hat
- **THEN** schlägt die Aktion mit einer verständlichen Meldung fehl, die RolloutAction trägt den
  Fehler, und im Repo bleibt kein halbfertiger Branch zurück

### Requirement: Build-Check nachträglich ausrollen
Für ein onboardetes Repo mit Build-Check-Status `missing` MUST das Dashboard einen PR anlegen
können, der nur die Build-Check-Aufrufdatei hinzufügt. Für diesen PR gelten dieselben Regeln wie
für den Onboarding-PR. Der Betreiber MUST ein Repo stattdessen als „eigene CI“ markieren und diese
Markierung wieder aufheben können.

#### Scenario: Rollout
- **WHEN** der Betreiber für ein onboardetes Repo ohne Build-Check den Rollout bestätigt
- **THEN** entsteht ein PR mit der Aufrufdatei, und der Build-Check-Status ist `pr_open`

### Requirement: Automatisches Onboarding
Je Owner MUST ein Schalter festlegen, ob neu entdeckte Repos automatisch einen Onboarding-PR
erhalten. Der Schalter MUST standardmäßig aus sein. Ist er an, MUST der Abgleich für jedes neu
entdeckte, nicht archivierte Repo ohne Renovate-Konfiguration genau einmal einen Onboarding-PR
anlegen, mit `auto` als Auslöser im AuditLog. Repos, die vor dem Einschalten bekannt waren, MUST
NOT automatisch einen PR erhalten.

#### Scenario: Neues Repo bei eingeschaltetem Schalter
- **WHEN** der Schalter für `Hiwamashi` an ist und dort ein neues Repo in die Installation kommt
- **THEN** erhält es beim nächsten Abgleich einen Onboarding-PR

#### Scenario: Geschlossener Onboarding-PR
- **WHEN** der Betreiber einen automatisch angelegten Onboarding-PR ungemergt schließt
- **THEN** legt das Dashboard für dieses Repo keinen neuen automatisch an
