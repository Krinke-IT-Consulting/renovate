# renovate-preset Specification

## Purpose
Legt fest, nach welchen Regeln Renovate in jedem Repo arbeitet, das das gemeinsame Preset
`github>Krinke-IT-Consulting/renovate` einbindet: wann Updates entstehen, wie sie gebündelt,
beschriftet und gemergt werden und wie Sicherheitsupdates Vorrang erhalten.

## Requirements

### Requirement: Einbindung über ein einziges Preset
Das Preset MUST unter `github>Krinke-IT-Consulting/renovate` abrufbar sein und alle Regeln dieser
Spec enthalten, sodass ein Repo mit der minimalen Konfiguration
`{"extends": ["github>Krinke-IT-Consulting/renovate"]}` vollständig konfiguriert ist. Das Preset
MUST auf `config:recommended` aufbauen und je Repo ein Dependency Dashboard aktivieren.

#### Scenario: Minimal konfiguriertes Repo
- **WHEN** ein Repo nur `{"extends": ["github>Krinke-IT-Consulting/renovate"]}` als
  `renovate.json` enthält
- **THEN** gelten für dieses Repo Zeitplan, Gruppierung, Automerge-, Sicherheits- und
  Label-Regeln dieses Presets, und Renovate legt ein Dependency-Dashboard-Issue an

#### Scenario: Preset ist gültig
- **WHEN** `default.json` mit `renovate-config-validator --strict` geprüft wird
- **THEN** meldet der Validator weder Fehler noch Warnungen

### Requirement: Zeitplan für normale Updates
Neue Branches und PRs für normale Updates (alles außer Sicherheitsupdates) MUST ausschließlich am
Wochenende angelegt werden, Samstag und Sonntag ganztägig, Zeitzone `Europe/Berlin`. Bereits offene
Branches dürfen auch unter der Woche aktualisiert und, wenn sie die Automerge-Bedingungen erfüllen,
gemergt werden.

#### Scenario: Update unter der Woche gefunden
- **WHEN** Renovate an einem Mittwoch eine neue Minor-Version einer Abhängigkeit findet
- **THEN** entsteht kein neuer PR und kein neuer Branch, bis das Wochenende beginnt

#### Scenario: Update am Wochenende
- **WHEN** Renovate an einem Samstag läuft und eine neue Patch-Version findet
- **THEN** erstellt oder aktualisiert Renovate den passenden PR

### Requirement: Gruppierung in Patch- und Minor-Gruppe
Je Repo MUST Renovate nicht-majore Updates in genau zwei Gruppen bündeln:
- **Patch-Gruppe:** alle Patch-Updates, alle Digest-Updates sowie alle Nicht-Major-Updates von
  devDependencies
- **Minor-Gruppe:** alle übrigen Minor-Updates

Major-Updates MUST NOT in die Patch- oder Minor-Gruppe fallen. Sie MUST je Abhängigkeit einen
eigenen PR erhalten; gehören mehrere Abhängigkeiten zu derselben Paketfamilie (Monorepo, etwa
`react` und `react-dom`), MUST deren Major-Updates gemeinsam in einem PR erscheinen.

#### Scenario: Gemischte Updates in einem Repo
- **WHEN** ein Repo gleichzeitig zwei Patch-Updates, ein Minor-Update einer Laufzeit-Abhängigkeit,
  ein Minor-Update einer devDependency und ein Major-Update hat
- **THEN** entstehen genau drei PRs: die Patch-Gruppe (zwei Patch-Updates und das
  devDependency-Minor-Update), die Minor-Gruppe (das Laufzeit-Minor-Update) und ein eigener PR für
  das Major-Update, sobald dieses freigegeben ist

#### Scenario: Major-Update einer Paketfamilie
- **WHEN** für `react` und `react-dom` gleichzeitig eine neue Major-Version erscheint
- **THEN** erscheinen beide als ein gemeinsames Update im Dependency Dashboard und nach der
  Freigabe in genau einem PR

### Requirement: Automerge nur für die Patch-Gruppe bei grünem Build
Nur PRs der Patch-Gruppe MUST automatisch gemergt werden, und nur, wenn alle Status-Checks des
PRs erfolgreich sind. PRs der Minor-Gruppe, Major-Updates und Sicherheitsupdates MUST NOT
automatisch gemergt werden. Hat ein PR keinen einzigen Status-Check, MUST NOT automatisch gemergt
werden.

#### Scenario: Patch-Gruppe mit grünem Build
- **WHEN** alle Status-Checks eines Patch-Gruppen-PRs erfolgreich abgeschlossen sind
- **THEN** merged Renovate den PR ohne menschliches Zutun

#### Scenario: Patch-Gruppe mit rotem Build
- **WHEN** mindestens ein Status-Check eines Patch-Gruppen-PRs fehlschlägt
- **THEN** bleibt der PR offen

#### Scenario: Repo ohne Status-Checks
- **WHEN** ein Patch-Gruppen-PR in einem Repo ohne Build-Check und ohne andere CI geöffnet wird
- **THEN** bleibt der PR offen und wird nicht automatisch gemergt

#### Scenario: Minor-Gruppe mit grünem Build
- **WHEN** alle Status-Checks eines Minor-Gruppen-PRs erfolgreich sind
- **THEN** bleibt der PR offen, bis ein Mensch ihn merged

### Requirement: Freigabe von Major-Updates
Major-Updates MUST erst nach ausdrücklicher Freigabe im Dependency Dashboard des Repos als Branch
und PR angelegt werden.

#### Scenario: Neue Major-Version verfügbar
- **WHEN** Renovate eine neue Major-Version einer Abhängigkeit findet
- **THEN** erscheint sie im Dependency Dashboard als freizugebendes Update, ohne dass ein PR
  entsteht

#### Scenario: Major-Update freigegeben
- **WHEN** der Betreiber das Major-Update im Dependency Dashboard anhakt
- **THEN** legt Renovate beim nächsten Lauf einen eigenen PR dafür an

### Requirement: Sicherheitsupdates mit Vorrang
Updates, die eine bekannte Sicherheitslücke schließen (aus GitHub-/Dependabot-Alerts oder aus der
OSV-Datenbank), MUST unabhängig vom Zeitplan sofort erstellt werden, MUST das Label `security`
tragen, MUST einen eigenen PR erhalten (nicht Teil der Patch- oder Minor-Gruppe), MUST NOT eine
Freigabe im Dependency Dashboard voraussetzen und MUST NOT automatisch gemergt werden.

#### Scenario: Sicherheitslücke unter der Woche
- **WHEN** an einem Dienstag eine Schwachstelle für eine im Repo genutzte Version bekannt wird und
  eine behobene Version existiert
- **THEN** erstellt Renovate beim nächsten Lauf einen eigenen PR mit dem Label `security`

#### Scenario: Sicherheitsupdate ist ein Major-Sprung
- **WHEN** die Schwachstelle nur durch ein Major-Update behoben wird
- **THEN** entsteht der PR trotzdem sofort, ohne Freigabe im Dependency Dashboard

### Requirement: Labels und Commit-Konvention
Jeder Renovate-PR MUST die Labels `dependencies` und `renovate` sowie ein Label für den
Update-Typ tragen (`update:major`, `update:minor`, `update:patch`, `update:digest` oder
`update:replacement`).
Commit-Nachrichten und PR-Titel MUST der Conventional-Commits-Form `chore(deps): …` folgen.

#### Scenario: Patch-Gruppen-PR
- **WHEN** Renovate einen Patch-Gruppen-PR anlegt
- **THEN** trägt er die Labels `dependencies`, `renovate` und `update:patch`, und sein Titel
  beginnt mit `chore(deps):`

### Requirement: GitHub Actions auf Digests gepinnt
Verweise auf GitHub Actions in Workflow-Dateien MUST auf Commit-Digests gepinnt werden, mit der
Versionsangabe als Kommentar. Digest-Updates dieser Actions gehören zur Patch-Gruppe.

#### Scenario: Workflow mit Tag-Referenz
- **WHEN** ein Repo `uses: actions/checkout@v4` enthält
- **THEN** schlägt Renovate vor, die Referenz durch den Digest mit Kommentar `# v4` zu ersetzen

### Requirement: Begrenzung der PR-Menge
Je Repo MUST die Zahl gleichzeitig offener Renovate-PRs und die Zahl neu erstellter PRs pro
Stunde begrenzt sein. Sicherheitsupdates MUST von diesen Grenzen nicht zurückgehalten werden.

#### Scenario: Grenze erreicht
- **WHEN** in einem Repo bereits die Höchstzahl an Renovate-PRs offen ist und ein weiteres
  normales Update ansteht
- **THEN** wird kein weiterer PR erstellt; das Update erscheint im Dependency Dashboard als
  zurückgehalten

#### Scenario: Grenze erreicht, Sicherheitsupdate fällig
- **WHEN** die Höchstzahl erreicht ist und ein Sicherheitsupdate ansteht
- **THEN** wird der Sicherheits-PR trotzdem erstellt
