# Spec Delta

## Purpose

Abgleich des Dashboards mit der Code-Plattform (GitHub) und mit Renovate CE. Er hält Repos, PRs,
Jobs und Probleme in der eigenen Datenbank aktuell, plattformneutral und schonend für Rate-Limits.

## ADDED Requirements

### Requirement: Plattformzugriff über eine neutrale Schnittstelle
Alle Zugriffe auf die Code-Plattform MUST über eine plattformneutrale Schnittstelle laufen. Im MVP
gibt es nur die GitHub-Implementierung. Typen und Datenmodell MUST NOT GitHub-spezifische Begriffe
enthalten, die eine spätere GitLab-Implementierung nicht erfüllen kann. Die Anmeldung an GitHub
MUST über die GitHub App der Plattform laufen. App-ID, Private Key und Installation-Tokens MUST NOT
geloggt oder in Fehlermeldungen ausgegeben werden.

#### Scenario: Neue Installation
- **WHEN** die GitHub App in einem weiteren Owner installiert wird
- **THEN** legt der nächste Abgleich dafür eine PlatformConnection an und liest dessen Repos

### Requirement: Abgleich mit der Plattform
Der Abgleich MUST etwa alle fünf Minuten für jede Installation lesen:
- alle Repos mit Default-Branch und Archiv-Status
- ob `renovate.json` (oder eine andere von Renovate erkannte Konfigurationsdatei) im
  Default-Branch liegt
- ob die Build-Check-Aufrufdatei im Default-Branch liegt und den zentralen Workflow aufruft
- alle offenen Renovate-PRs mit Update-Typ, Paketen, CI-Status und Automerge
- den Link zum Dependency-Dashboard-Issue

Er MUST bedingte Anfragen nutzen, damit unveränderte Daten kein Rate-Limit verbrauchen. Archivierte
Repos MUST als archiviert geführt werden und in keine Zählung offener Arbeit eingehen. PRs, die
nicht mehr offen sind, MUST mit ihrem Endzustand gespeichert werden.

#### Scenario: Unveränderte Repos
- **WHEN** sich seit dem letzten Abgleich nichts geändert hat
- **THEN** antwortet GitHub mit „nicht geändert“, und der Abgleich verbraucht dafür kein Kontingent

#### Scenario: PR gemergt
- **WHEN** ein offener Renovate-PR auf GitHub gemergt wird
- **THEN** führt das Dashboard ihn nach dem nächsten Abgleich als gemergt mit Zeitpunkt

### Requirement: Update-Typ und Status ableiten
Der Update-Typ eines Renovate-PRs MUST aus seinen Labels folgen: `security` vor `major`, `minor`,
`patch`, `digest`, `lockfile`, sonst `other`. Der CI-Status MUST aus Checks und Commit-Status des
letzten Commits folgen: `failure`, wenn einer fehlschlägt, `pending`, wenn einer läuft, `success`,
wenn alle bestanden sind, `none` ohne Checks.

Für jedes Repo gilt:
- **Onboarding-Status:**
  - `onboarded`, wenn eine Renovate-Konfiguration im Default-Branch liegt
  - `pr_open`, wenn ein offener Onboarding-PR des Dashboards existiert
  - `disabled`, wenn Renovate CE das Repo als deaktiviert meldet
  - sonst `none`
- **Build-Check-Status:**
  - `active`, wenn die Aufrufdatei im Default-Branch liegt
  - `pr_open`, wenn ein offener Rollout-PR existiert
  - `own_ci`, wenn der Betreiber das Repo als „eigene CI“ markiert hat
  - sonst `missing`

#### Scenario: Sicherheitsupdate als Major
- **WHEN** ein PR die Labels `security` und `major` trägt
- **THEN** führt das Dashboard ihn als Sicherheitsupdate

#### Scenario: Repo ohne Checks
- **WHEN** der letzte Commit eines Renovate-PRs weder Checks noch Commit-Status hat
- **THEN** ist sein CI-Status `none`

### Requirement: Abgleich mit Renovate CE
Der Abgleich MUST etwa jede Minute über die interne API von Renovate CE lesen:
- die laufenden und wartenden Jobs
- für jedes Repo die Job-Historie mit Grund, Status, Start- und Endzeit
- den Repo-Status

Jobs MUST mit ihrer CE-Job-ID eindeutig gespeichert werden. Der Grund MUST auf `schedule`,
`webhook` oder `manual` abgebildet werden. Für beendete Jobs mit Fehler MUST ein gekürzter
Log-Auszug gespeichert werden, der nur Warnungen und Fehler enthält. Die API MUST mit dem
Server-Secret über das interne Netz angesprochen werden.

#### Scenario: Job abgeschlossen
- **WHEN** ein Job von Renovate CE fehlschlägt
- **THEN** zeigt das Dashboard ihn nach spätestens zwei Minuten als fehlgeschlagen, mit Dauer und
  Log-Auszug

#### Scenario: Geplanter Lauf
- **WHEN** Renovate CE einen Job mit dem Grund `schedule-all` ausführt
- **THEN** führt das Dashboard ihn mit dem Auslöser `schedule`

### Requirement: Probleme ableiten
Nach jedem Abgleich MUST das Dashboard die offenen Probleme je Repo neu bewerten:

| Art | Bedingung |
|---|---|
| `config_error` | Renovate CE meldet das Repo als fehlgeschlagen, oder der letzte Job endete mit einem Konfigurationsfehler |
| `lockfile_failure` | Der letzte Job meldet Fehler beim Aktualisieren von Lockfiles |
| `job_failed` | Der letzte Job ist fehlgeschlagen und es liegt kein spezifischeres Problem vor |
| `stale_pr` | Ein Renovate-PR ist länger als 14 Tage offen, ein Sicherheitsupdate länger als 7 Tage |
| `ci_red` | Ein offener Renovate-PR hat den CI-Status `failure` |
| `missing_build_check` | Das Repo ist onboardet, und der Build-Check-Status ist `missing` |

Ein Problem MUST beim ersten Auftreten mit Zeitpunkt angelegt und bei jedem weiteren Abgleich
bestätigt werden. Trifft die Bedingung nicht mehr zu, MUST es mit Zeitpunkt als behoben markiert
werden, statt gelöscht zu werden. Archivierte Repos MUST NOT Probleme haben.

#### Scenario: Roter Build behoben
- **WHEN** ein Renovate-PR mit roter CI nach einem neuen Commit grün wird
- **THEN** ist das Problem `ci_red` nach dem nächsten Abgleich als behoben markiert

#### Scenario: Repo mit eigener CI
- **WHEN** ein onboardetes Repo als „eigene CI“ markiert ist
- **THEN** entsteht kein Problem `missing_build_check`

### Requirement: Genau ein Abgleich gleichzeitig
Es MUST zu jeder Zeit höchstens ein Abgleich je Quelle laufen, auch wenn mehrere Instanzen des
Dashboards laufen. Ein Abgleich, der länger dauert als sein Intervall, MUST NOT einen zweiten
parallel auslösen. Ein Fehler beim Abgleich eines Repos MUST NOT den Abgleich der übrigen Repos
abbrechen.

#### Scenario: Langsamer Abgleich
- **WHEN** ein GitHub-Abgleich länger als fünf Minuten dauert
- **THEN** startet der nächste erst nach seinem Ende

#### Scenario: Ein Repo nicht lesbar
- **WHEN** ein einzelnes Repo beim Abgleich einen Fehler liefert
- **THEN** werden die übrigen Repos trotzdem abgeglichen, und der Stempel nennt den Teilfehler
