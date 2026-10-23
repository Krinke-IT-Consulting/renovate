# Renovate-Konfiguration (Preset, CE-Konfig, Validierung)

Status: umgesetzt bis einschließlich OpenSpec-Task 4 und Probelauf (Task 1.4). Offen sind die
Verifikation am Test-Repo (Tasks 5.x, erst nach dem Compose-Stack). Quelle der Anforderungen:
`openspec/changes/renovate-konfiguration/` (`design.md`, `specs/renovate-preset/spec.md`,
`specs/renovate-engine-config/spec.md`).

Dieses Dokument beschreibt, was die Dateien im Repo tatsächlich enthalten. Wenn eine Datei und
dieser Text voneinander abweichen, gilt die Datei.

## 1. Zweck und Einbindung

Das Repo enthält das gemeinsame Renovate-Preset für die GitHub-Repos von Hiwamashi und
Krinke-IT-Consulting sowie die globale Konfiguration der selbst gehosteten Renovate-CE-Instanz.

Ein Repo bindet das Preset mit genau dieser Zeile ein:

```json
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": ["github>Krinke-IT-Consulting/renovate"]
}
```

Die Datei heißt `renovate.json` im Root des Ziel-Repos. Die Vorlage dafür liegt in
`templates/renovate.json`.

**Wichtig:** Dieses Repo ist öffentlich. Jede Änderung an `default.json` in `main` wirkt sofort
auf alle Repos, die das Preset einbinden. Änderungen am Preset deshalb nur per PR, und der
Validierungs-Check muss grün sein.

Presets können keine Umgebungsvariablen lesen. Secrets gehören daher nie in `default.json`, sondern
in die globale `renovate-ce/config.js`, die nur Umgebungsvariablen liest.

## 2. Regeln des Presets

Quelle: `default.json`. Das Preset baut auf `config:recommended` und `helpers:pinGitHubActionDigests`
auf. `:semanticPrefixFixDepsChoreOthers` ist per `ignorePresets` abgewählt.

| Thema | Einstellung in `default.json` | Wirkung |
|---|---|---|
| Zeitplan | `schedule: ["* * * * 0,6"]`, `timezone: "Europe/Berlin"` | Normale Updates entstehen nur an Samstagen und Sonntagen, ganztägig. Gilt nicht für Sicherheitsupdates. |
| Automerge-Zeitplan | nicht gesetzt | Renovate-Standard `at any time`. Ein am Wochenende erstellter PR darf auch montags gemergt werden. Offene Branches werden auch unter der Woche nachgezogen (`updateNotScheduled` Standard `true`); nur neue Branches warten auf das Wochenende. |
| Patch-Gruppe | Regel mit `matchUpdateTypes: ["patch", "digest", "pin", "pinDigest"]`, `groupName: "Patch- und Wartungsupdates"`, `groupSlug: "patch-und-wartungsupdates"`, `automerge: true` | Ein gemeinsamer PR. Automerge nur, wenn der Build grün ist (siehe Abschnitt 6). |
| devDependency-Minor | Regel mit `matchDepTypes: ["devDependencies"]`, `matchUpdateTypes: ["minor"]`, gleiche Gruppe, `automerge: true` | Minor-Updates von devDependencies wandern in die Patch-Gruppe. |
| Minor-Gruppe | Regel mit `matchUpdateTypes: ["minor"]`, `groupName: "Minor-Updates"`, `groupSlug: "minor-updates"`, `automerge: false` | Laufzeit-Minor-Updates bilden einen eigenen PR und werden nicht automatisch gemergt. |
| Major-Updates | Regel mit `matchUpdateTypes: ["major"]`, `dependencyDashboardApproval: true`, `automerge: false` | Erscheinen zuerst im Dependency Dashboard. Ein PR entsteht erst nach dem Anhaken. Nie automatisch gemergt. |
| Major-Gruppierung | keine eigene `groupName` | Paketfamilien (Monorepos) landen gemeinsam in einem PR, über `group:monorepos` und `group:recommended` aus `config:recommended`. Diese wirken nur bei Major-Updates (siehe Abschnitt 3). |
| Sicherheitsupdates | Block `vulnerabilityAlerts`: `labels: ["dependencies", "renovate", "security"]`, `schedule: ["at any time"]`, `dependencyDashboardApproval: false`, `automerge: false`, `groupName: null`, `prConcurrentLimit: 0` | Sofort, einzeln, mit Label `security`, nie automatisch gemergt. Keine Freigabe nötig. Kein Limit für gleichzeitig offene Sicherheits-PRs; das Stundenlimit umgeht Renovate für Sicherheits-PRs ohnehin. |
| OSV-Alarme | `osvVulnerabilityAlerts: true` | Sicherheitsupdates auch aus der OSV-Datenbank. |
| Labels | `labels: ["dependencies", "renovate"]`; je Update-Typ eine Regel mit `addLabels` | Patch: `update:patch`, Minor: `update:minor`, Major: `update:major`, Digest und Pin: `update:digest`, Paketersatz: `update:replacement`. |
| Commits und Titel | `semanticCommits: "enabled"`, `semanticCommitType: "chore"`, `semanticCommitScope: "deps"` | Form `chore(deps): …`. |
| Limits | `prConcurrentLimit: 5`, `prHourlyLimit: 2` | Höchstens 5 offene Renovate-PRs je Repo, höchstens 2 neue PRs pro Stunde. Sicherheitsupdates sind davon ausgenommen (siehe Zeile Sicherheitsupdates und Abschnitt 8). |
| GitHub Actions | `helpers:pinGitHubActionDigests` | Actions werden auf Commit-Digests gepinnt, die Version steht als Kommentar dahinter. Digest-Updates gehören zur Patch-Gruppe. |
| Automerge-Art | `platformAutomerge: false`, `automergeType: "pr"` | Automerge macht Renovate selbst, nicht GitHub. Gemergt wird als PR, nicht als Branch. |
| npm für Lockfiles | `constraints: { "npm": "^11" }` | Renovate aktualisiert `package-lock.json` mit npm 11, also mit derselben Hauptversion wie der Build-Check. Grund siehe Abschnitt 9. |
| Dashboard | `dependencyDashboard: true` | Renovate legt je Repo ein Dependency-Dashboard-Issue an. |

`ignoreTests` ist nicht gesetzt und bleibt damit auf Renovate-Standard `false`.

## 3. Warum die Reihenfolge der `packageRules` wichtig ist

In Renovate gewinnt bei `packageRules` die **spätere** Regel, wenn sich zwei Regeln auf dasselbe
Paket beziehen. Die Regeln aus `config:recommended` stehen in der Liste vor den eigenen Regeln von
`default.json`. Daraus folgen drei Konsequenzen:

- Die Minor-Regel steht vor der Patch-Regel für devDependencies. Deshalb gewinnt die devDependency-
  Regel mit Automerge.
- Die eigenen Patch- und Minor-Regeln überschreiben die `groupName` aus `group:monorepos` und
  `group:recommended`. Diese Preset-Gruppen wirken deshalb nur noch bei Major-Updates. Das ist
  gewollt: `react`, `react-dom` und `@types/react` springen bei Patch und Minor gemeinsam.
- Verworfen wurde `group:allNonMajor`. Die Gruppe mischt Updates mit und ohne Automerge, und
  Renovate entscheidet Automerge pro Branch.

Beim Ändern von `packageRules` die Reihenfolge prüfen und den Probelauf (Abschnitt 7) wiederholen.

## 4. Aufbau von `renovate-ce/config.js`

Quelle: `renovate-ce/config.js`. Die Datei ist die globale Konfiguration der CE-Instanz. Sie ist
keine Preset-Datei und wird nur in der CE-Instanz gelesen (`/usr/src/app/config.js` im Container,
laut `design.md`).

| Option | Wert | Bedeutung |
|---|---|---|
| `onboarding` | `false` | Onboarding-PRs übernimmt das Dashboard, nicht Renovate. |
| `requireConfig` | `"required"` | Repos ohne eigene Renovate-Konfigurationsdatei werden übersprungen. |
| `binarySource` | `"install"` | Werkzeuge (Node, pnpm, Bun, Python, Go, CocoaPods) werden bei Bedarf installiert. |
| `hostRules` | bedingt | Nur wenn die Umgebungsvariable `SCW_REGISTRY_SECRET_KEY` gesetzt ist, ein Eintrag für `rg.nl-ams.scw.cloud` (`hostType: "docker"`, Benutzer `nologin`, Passwort aus der Umgebungsvariable). Ohne Variable ist die Liste leer. |

Die Region `nl-ams` ist fest eingetragen. Der Namespace `rg.nl-ams.scw.cloud/krinke-dockersolutions` ist öffentlich; Renovate liest ihn ohne Zugangsdaten. Die Regel greift erst für private Namespaces. Eine zweite Region bräuchte eine weitere Regel.

Die Datei setzt keine Werte für `cacheDir` oder `containerbaseDir`. Das klärt der Compose-Change.
`forkProcessing` und das Überspringen archivierter Repos sind Renovate-Standard und stehen nicht
in der Datei.

Die Betriebsparameter (Lizenz, App, Datenbank, Webhook, `MEND_RNV_AUTODISCOVER_FILTER`) kommen als
`MEND_RNV_*`-Umgebungsvariablen. Sie sind hier nicht definiert und gehören zum Compose-Stack-Change.

Der Name `SCW_REGISTRY_SECRET_KEY` steht in `.env.example` mit leerem Wert und Herkunftskommentar
(Mensch, Scaleway-IAM-API-Key mit Registry-Lesezugriff, optional). Der Wert gehört in keine
versionierte Datei.

## 5. Repo-eigene `renovate.json` und Vorlage für Onboarding

**`renovate.json` (Repo-Root):**

```json
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": ["local>Krinke-IT-Consulting/renovate", "customManagers:githubActionsVersions"]
}
```

- `local>` liest das Preset aus diesem Repo selbst. Eine Änderung am Preset greift deshalb schon in
  dem PR, der sie einführt.
- `customManagers:githubActionsVersions` erkennt die Versionsangabe `RENOVATE_VERSION` im Workflow
  `.github/workflows/validate-renovate.yml`. Der Kommentar `# renovate: datasource=npm depName=renovate`
  steht direkt über der Zeile. So hält Renovate die gepinnte Renovate-Version im Workflow aktuell.
- Compose-Images und Dockerfiles erkennt Renovate über die Standard-Manager, sobald die Dateien
  existieren. Dafür gibt es keine eigenen Regeln.

**`templates/renovate.json` (Vorlage für Onboarding-PRs):**

```json
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": ["github>Krinke-IT-Consulting/renovate"]
}
```

Das Dashboard nutzt diese Datei unverändert. Sie enthält nur das Preset.

## 6. Validierung

### CI-Workflow

Quelle: `.github/workflows/validate-renovate.yml`.

- Auslöser: `push` und `pull_request`, jeweils für die Pfade `default.json`, `renovate.json`,
  `templates/**`, `renovate-ce/**` und den Workflow selbst.
- Berechtigungen: `contents: read`. Die Actions sind auf Digests gepinnt.
- Node.js 24 (`actions/setup-node`).
- Schritt 1 prüft die JSON-Dateien:
  `npx --yes --package "renovate@${RENOVATE_VERSION}" renovate-config-validator --strict --no-global default.json renovate.json templates/renovate.json`
- Schritt 2 prüft `renovate-ce/config.js` mit gesetzter Variable `RENOVATE_CONFIG_FILE=renovate-ce/config.js`.
- `RENOVATE_VERSION` steht im Workflow-`env` auf `44.155.2`.

`--no-global` ist nötig, damit die JSON-Dateien nicht als globale Konfiguration geprüft werden.

### Lokale Befehle

Renovate 44 braucht **Node 24**. Mit einer älteren Node-Version schlägt der Lauf fehl.

```bash
npx --yes --package renovate@44.155.2 renovate-config-validator --strict --no-global default.json renovate.json templates/renovate.json
RENOVATE_CONFIG_FILE=renovate-ce/config.js npx --yes --package renovate@44.155.2 renovate-config-validator --strict
```

Die Version `44.155.2` steht im Workflow. Bei einem Versionswechsel beide Stellen gemeinsam
anpassen; der Renovate-Manager übernimmt das im Workflow automatisch.

Negativtest (Task 4.2): Eine Kopie von `default.json` mit der unbekannten Option
`gibtEsNichtOption` lässt den Validator mit Exit-Code 1 abbrechen; die Ausgabe nennt
`"file": "default.json"` und `Invalid configuration option: gibtEsNichtOption`.

## 7. Prüfung: Ergebnis des Probelaufs (Task 1.4)

Lauf: `renovate --platform=local --dry-run=full`, Renovate 44.155.2, Node 24, `default.json` als
Repo-Konfiguration eingebunden. Die Tabelle zeigt, welche Branches und Gruppen der Lauf für die
Beispiel-Updates erzeugt hat.

| Update | Branch / Gruppe | Automerge | Freigabe |
|---|---|---|---|
| Patch (ms, react, react-dom, ts-jest, @types/react) | renovate/patch-und-wartungsupdates | ja | nein |
| devDependency-Minor (prettier, eslint, jest, vitest) | renovate/patch-und-wartungsupdates | ja | nein |
| Laufzeit-Minor (express, lodash, chalk, graphql, @apollo/client, @babel/preset-env) | renovate/minor-updates | nein | nein |
| Major react + react-dom + @types/react | renovate/major-react-monorepo (ein Branch) | nein | ja |
| Major jest + ts-jest | renovate/major-jest-monorepo (ein Branch) | nein | ja |
| Major eslint / @babel/preset-env / vitest | renovate/major-eslint-monorepo, renovate/major-babel-monorepo, renovate/major-vitest-monorepo | nein | ja |
| Major @apollo/client | renovate/major-apollo-graphql-packages (Gruppe aus `group:recommended`) | nein | ja |
| Major express / chalk / graphql | je eigener Branch (z. B. renovate/express-5.x) | nein | ja |
| Sicherheitsupdate (OSV) | eigener Branch renovate/npm-*-vulnerability, Label security, sofort | nein | nein |

Die Sicherheitszeile stammt aus einem zweiten Lauf mit aktivem OSV (im Zuordnungslauf war OSV
aus). Die Logs lagen im Scratchpad der Sitzung und sind nicht Teil des Repos; der Lauf lässt sich
mit den Befehlen aus Abschnitt 6 und einem Beispiel-`package.json` wiederholen.

## 8. Offen bis CE läuft (Tasks 5.x)

Diese Punkte sind **nicht** verifiziert und hängen am Test-Repo, nachdem der Compose-Stack mit CE
läuft:

- **Automerge ohne Checks (5.1):** Ein Patch-PR in einem Repo ohne Status-Checks darf nicht gemergt
  werden. Die Erwartung ist, dass der kombinierte Status dann „pending" bleibt. Das ist nicht
  bestätigt.
- **Limits bei Sicherheits-PRs (5.2, geprüft am 2026-10-23):** Renovate 44.164.1 (in CE 15.8.0)
  behandelt die beiden Limits unterschiedlich (`dist/workers/global/limits.js`, `handleConcurrentLimits`):
  - `prHourlyLimit` gilt für Sicherheits-PRs nicht. Beleg am echten Repo: In `Hiwamashi/lector` entstanden
    am 2026-10-21 (Mittwoch) drei Sicherheits-PRs (#2 bis #4) innerhalb von 30 Sekunden, trotz Limit 2 und
    Wochenend-Zeitplan.
  - `prConcurrentLimit` gilt weiter, Sicherheits-PRs haben nur ein eigenes Kontingent
    (`VulnerabilityConcurrentPRs`). Ohne Eingriff wären also höchstens 5 Sicherheits-PRs gleichzeitig offen.
  Deshalb setzt der Block `vulnerabilityAlerts` `prConcurrentLimit: 0` (kein Limit). `prHourlyLimit: 0`
  ist überflüssig und fehlt bewusst.
- **Major-Freigabe am echten Repo (5.3):** Major-Updates erscheinen nur im Dependency Dashboard und
  erhalten erst nach dem Anhaken einen PR.

Ohne diese Bestätigung ist das Preset für Automerge nicht freigegeben.

## 9. Bewusste Entscheidungen

- **Gruppierung 1a (zwei Gruppen):** Nicht-Major-Updates bilden genau zwei Gruppen, Patch-Gruppe mit
  Automerge und Minor-Gruppe ohne. Das Risiko eines Minor-Updates einer devDependency, das den Build
  bricht (etwa TypeScript oder ESLint), ist bewusst akzeptiert. Automerge greift nur bei grünem Build.
- **Zeitplan 2a (nur Wochenende):** Normale Updates entstehen samstags und sonntags. Unter der Woche
  erscheint nichts Neues, außer bei Sicherheitsupdates. Ein dringendes Nicht-Sicherheitsupdate lässt
  sich über das Dependency Dashboard von Hand anstoßen.
- **Major-Paketfamilien gemeinsam:** Monorepo-Familien wie `react`, `react-dom` und `@types/react`
  landen im selben Major-PR (über `group:monorepos`/`group:recommended`).
- **Kein GitHub-Auto-Merge:** `platformAutomerge: false`. GitHubs natives Auto-Merge prüft nur Checks,
  die per Branch-Protection verpflichtend sind. In Repos ohne solche Regeln könnte es sofort mergen.
  Renovates eigenes Automerge merged nur bei grünem kombinierten Status. Der Nachteil: Ein grüner PR
  wird erst beim nächsten Renovate-Lauf gemergt, nicht sofort.
- **`prPriority` entfällt:** Die Option ist im Block `vulnerabilityAlerts` nicht zulässig. Es gibt
  keinen `packageRules`-Selektor für Sicherheitsupdates. Sicherheits-PRs laufen deshalb ohne eigene
  Priorität, aber sofort.
- **npm-Version für Lockfiles festgelegt (`constraints.npm: "^11"`):** Renovate CE bringt npm 12 mit
  (`binarySource: "install"`, Stand Oktober 2026: 12.2.1). npm 12 sperrt Downloads vom Typ „remote“
  standardmäßig und bricht beim Aktualisieren der `package-lock.json` mit `EALLOWREMOTE` ab, sobald die
  Lockfile das optionale Paket `@tailwindcss/oxide-wasm32-wasi` enthält (Tailwind 4). Folge: Renovate meldet
  „Artifact update problem“, die Lockfile bleibt alt, `npm ci` im Build-Check scheitert. Der Build-Check
  installiert mit der npm-Version, die zu Node 24 gehört (npm 11). Das Preset hält Renovate deshalb auf
  derselben Hauptversion. Aufheben, sobald der Build-Check auf npm 12 umstellt und der Fehler dort nicht
  mehr auftritt (zusammen mit der offenen Frage zu `allowScripts`, Abschnitt 11 in `build-check.md`).
- **Verworfen: `automergeType: "branch"`.** Dann fehlten die PRs im Dashboard und in der Historie.
- **Verworfen: Registry-Regel im Preset.** Dort wäre nur ein verschlüsseltes Secret möglich, dafür
  bräuchte CE einen privaten Schlüssel. Deshalb liegt die Regel in `renovate-ce/config.js`.

## Offene Punkte (Übersicht)

- `MEND_RNV_*`-Variablen, Volumes und Cache-Pfade folgen mit dem Compose-Stack-Change.
- Tasks 5.1 bis 5.3 (Verifikation am Test-Repo) sind offen, bis CE läuft.
