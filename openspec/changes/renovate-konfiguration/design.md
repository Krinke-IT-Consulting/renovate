# Design

## Context

Siehe proposal.md (Why). Das Repo enthält bisher nur Planung (PRD, Regeln, OpenSpec); es gibt
keinen Code, keinen Compose-Stack und keine GitHub App. Folgende Randbedingungen bestimmen den
Entwurf:

- Das Repo ist öffentlich, und Presets können keine Umgebungsvariablen lesen. Alles, was ein
  Secret braucht, gehört deshalb in die globale `config.js`.
- Renovate CE liest die globale Konfiguration aus `/usr/src/app/config.js` im Container. Die
  Betriebsparameter (Lizenz, App, Datenbank, Webhook, `MEND_RNV_AUTODISCOVER_FILTER`) kommen
  als `MEND_RNV_*`-Umgebungsvariablen und gehören zum Change für den Compose-Stack.
- Ob ein Repo wirklich automatisch mergt, hängt vom Build-Check aus einem späteren Change ab.
  Diese Konfiguration muss bis dahin sicher sein.

## Goals / Non-Goals

**Goals:**
- Das Preset ist vollständig und validiert; ein Repo braucht nur die Zeile `extends`.
- Kein Automerge ohne grüne Checks, auch nicht in Repos ohne CI.
- `config.js` funktioniert ohne optionale Secrets.

**Non-Goals:**
- `MEND_RNV_*`-Variablen, Volumes, Container-Pfade (Change Compose-Stack)
- Build-Check-Workflow und Aufruf-Vorlage (Change Build-Check)
- `ignoreDeps` für einzelne Repos mit `latest`-Images; das regelt jedes Repo in seiner eigenen
  `renovate.json`.

## Decisions

### 1. Gruppierung über zwei `packageRules` mit `groupName`
- **Patch-Gruppe** `"Patch- und Wartungsupdates"`:
  - `matchUpdateTypes: ["patch", "digest", "pin", "pinDigest"]`
  - zusätzlich eine Regel `matchDepTypes: ["devDependencies"]` + `matchUpdateTypes: ["minor"]`
    mit derselben Gruppe
  - `automerge: true`
- **Minor-Gruppe** `"Minor-Updates"`: `matchUpdateTypes: ["minor"]`, `automerge: false`
- Die Reihenfolge der Regeln ist entscheidend: Die devDependency-Regel steht hinter der
  Minor-Regel, damit sie gewinnt, denn in Renovate gewinnt bei `packageRules` die spätere Regel.
- Aus `config:recommended` ist nur `:semanticPrefixFixDepsChoreOthers` abgewählt
  (`ignorePresets`), sonst bekämen Laufzeit-Abhängigkeiten `fix(deps)`-Commits.
- `group:monorepos` und `group:recommended` bleiben aktiv, wirken aber nur noch bei
  Major-Updates: Die eigenen Patch- und Minor-Regeln stehen im Repo hinter den Preset-Regeln und
  überschreiben deren `groupName`. So springen Paketfamilien wie `react`, `react-dom` und
  `@types/react` gemeinsam (Entscheidung des Betreibers nach dem ersten Probelauf).
- **Verworfen:** `group:allNonMajor`. Diese Gruppe mischt Updates mit und ohne Automerge, und
  Renovate entscheidet Automerge pro Branch.

### 2. Automerge durch Renovate selbst, nicht durch GitHub
- `platformAutomerge: false` und `automergeType: "pr"`.
- GitHubs natives Auto-Merge prüft nur Checks, die per Branch-Protection verpflichtend sind. In
  Repos ohne solche Regeln könnte es sofort mergen.
- Renovates eigenes Automerge mergt nur, wenn der kombinierte Status grün ist. Gibt es keinen
  Check, ist der Status „pending", und es wird nicht gemergt. Genau das verlangt die Spec. Das
  Verhalten wird in Task 5 an einem Test-Repo bestätigt.
- `ignoreTests` bleibt `false`.
- **Verworfen:** `automergeType: "branch"`, also stilles Mergen ohne PR. Dann fehlten die PRs im
  Dashboard und in der Historie.

### 3. Major-Freigabe über `dependencyDashboardApproval`
- Eine Regel `matchUpdateTypes: ["major"]` mit `dependencyDashboardApproval: true`.
- Der Haken im Dashboard-Issue löst dank CE-Webhook sofort einen Lauf aus.
- Das passt zum Schritt „Freigeben" im Entwurf der Übersicht.

### 4. Zeitplan
- `schedule: ["* * * * 0,6"]` mit `timezone: "Europe/Berlin"`, also Samstag und Sonntag
  ganztägig.
- `automergeSchedule` bleibt bei „jederzeit": Ein am Wochenende erstellter Patch-PR darf mergen,
  sobald der Build grün ist, auch am Montag.
- `updateNotScheduled` bleibt beim Standard `true`: Offene Branches werden auch unter der Woche
  nachgezogen. Mit `false` stünde jedes Branch-Update samt Automerge bis zum nächsten Wochenende
  still. Die Spec ist entsprechend formuliert (nur neue Branches warten auf das Wochenende).

### 5. Sicherheitsupdates
Der Block `vulnerabilityAlerts` wird gesetzt:

| Option | Wert |
|---|---|
| `labels` | `["dependencies", "renovate", "security"]` |
| `schedule` | `["at any time"]` |
| `dependencyDashboardApproval` | `false` |
| `automerge` | `false` |
| `groupName` | `null` |

Dazu kommt `osvVulnerabilityAlerts: true`. `prPriority` ist im Block `vulnerabilityAlerts` nicht
zulässig, und es gibt keinen `packageRules`-Selektor für Sicherheitsupdates; eine eigene
Priorität entfällt daher.

Dass Sicherheits-PRs `prConcurrentLimit` und `prHourlyLimit` umgehen, ist laut Renovate-Doku
Standardverhalten. Task 5 prüft das. Falls nicht, setzt der Block selbst
`prConcurrentLimit: 0` und `prHourlyLimit: 0`.

### 6. Limits
- `prConcurrentLimit: 5` und `prHourlyLimit: 2`.
- Durch die Gruppierung entstehen je Repo normalerweise höchstens zwei Gruppen-PRs plus
  freigegebene Majors.
- Zwei PRs pro Stunde verteilen die Last über ein 48-Stunden-Fenster am Wochenende.

### 7. Labels und Commits
- `labels: ["dependencies", "renovate"]`, dazu je Update-Typ eine `packageRules` mit
  `addLabels: ["update:<typ>"]`.
- `semanticCommits: "enabled"`, `semanticCommitType: "chore"`, `semanticCommitScope: "deps"`.
- Dazu `helpers:pinGitHubActionDigests`.

### 8. Globale `config.js`

```js
module.exports = {
  onboarding: false,
  requireConfig: "required",
  binarySource: "install",
  // forkProcessing "disabled" und Überspringen archivierter Repos sind Renovate-Standard
  hostRules: process.env.SCW_REGISTRY_SECRET_KEY
    ? [{ matchHost: "rg.nl-ams.scw.cloud", hostType: "docker",
         username: "nologin", password: process.env.SCW_REGISTRY_SECRET_KEY }]
    : [],
};
```

- Ein Cache-Verzeichnis (`cacheDir` / `containerbaseDir`) wird nur gesetzt, wenn der
  Standardpfad des CE-Images nicht auf ein Volume passt. Das klärt der Compose-Change; hier
  bleibt es beim Standard.
- Region: fest `nl-ams`. Der Namespace `krinke-dockersolutions` ist öffentlich und braucht keine
  Zugangsdaten; die Regel greift erst, wenn private Namespaces dazukommen.
- **Verworfen:** die Registry-Regel ins Preset legen. Dort ginge das nur mit verschlüsseltem
  Secret (`encrypted`), wofür CE einen privaten Schlüssel bräuchte. Das ist unnötig kompliziert.

### 9. Repo-eigene `renovate.json`
- Inhalt: `{"extends": ["local>Krinke-IT-Consulting/renovate"]}`.
- `local>` liest das Preset aus diesem Repo selbst. So greift eine Änderung am Preset bereits
  im PR, der sie einführt.
- Compose-Images (`deploy/docker-compose.yaml`) und Dockerfiles erkennt Renovate über die
  Standard-Manager, sobald die Dateien existieren. Dafür sind keine Zusatzregeln nötig.

### 10. Validierung in CI
- Workflow `validate-renovate.yml`, ausgelöst bei Push und PR auf `default.json`,
  `renovate.json`, `templates/**` und `renovate-ce/**`.
- Er ruft `npx --yes --package renovate@<gepinnte Version> renovate-config-validator --strict --no-global`
  für die JSON-Dateien auf (ohne `--no-global` würden sie als globale Konfiguration geprüft) und für `renovate-ce/config.js` mit gesetztem
  `RENOVATE_CONFIG_FILE`.
- Die Renovate-Version im Workflow hält Renovate selbst aktuell: Kommentar
  `# renovate: datasource=npm depName=renovate` plus `customManagers:githubActionsVersions` in
  der repo-eigenen `renovate.json`.
- Actions sind auf Digests gepinnt, `permissions: contents: read`.

## Risks / Trade-offs

- **[Risiko] Das Preset ist öffentlich und wirkt sofort auf alle onboardeten Repos.** Ein Fehler
  in `main` trifft jedes Repo.
  - Gegenmaßnahme: der Validierungs-Check als Pflicht vor dem Merge.
  - Änderungen am Preset nur per PR.
- **[Risiko] Unter der Woche entstehen keine normalen Updates.** Ein dringend gewünschtes
  Nicht-Sicherheitsupdate wartet bis zum Wochenende.
  - Gegenmaßnahme: Über das Dependency Dashboard lässt es sich jederzeit von Hand anstoßen.
- **[Risiko] Ein Minor-Update einer devDependency kann den Build brechen, etwa TypeScript oder
  ESLint.**
  - Gegenmaßnahme: Automerge greift nur bei grünem Build. Dieses Risiko ist bewusst gewählt
    (Antwort 1a).
- **[Risiko] `renovate-config-validator` prüft `config.js` womöglich nicht so streng wie JSON.**
  - Gegenmaßnahme: Task 5 prüft das Verhalten.
  - Notfalls wird `config.js` nur syntaktisch per `node --check` geprüft, und die Optionen
    werden im Test-Repo bestätigt.
- **[Trade-off] Automerge durch Renovate statt durch GitHub.** Ein grüner PR wird erst beim
  nächsten Renovate-Lauf gemergt, nicht sofort. Bei CE mit Webhooks und stündlichem Scheduler
  ist das vertretbar.

- **[Grenze] `matchDepTypes: ["devDependencies"]` erfasst nur npm-artige Manager.** Dev-Pakete
  in Python (`dev`-Gruppen), Composer (`require-dev`) oder Cargo landen in der Minor-Gruppe ohne
  Automerge. Bewusst so belassen; erweitern, falls sich das als lästig erweist.
- **[Risiko] Path-Filter des Validierungs-Workflows.** Wird `Validate Renovate config` später als
  Pflicht-Check in der Branch-Protection eingetragen, blockiert er PRs, die keine
  Konfigurationsdatei ändern (der Check bleibt „Expected").
  - Gegenmaßnahme: beim Einrichten der Pflicht-Checks (Build-Check-Change) den Path-Filter
    entfernen oder den Check nicht als Pflicht führen.

## Migration Plan

Noch kein Repo nutzt das Preset, eine Migration entfällt. Rollout:

1. Merge in `main` des öffentlichen Repos.
2. Erstes Test-Repo onboarden, sobald CE läuft (Compose-Change).
3. Danach alle weiteren Repos über das Dashboard.

Rückweg: den Commit am Preset zurücknehmen; Renovate übernimmt beim nächsten Lauf den alten
Stand.

## Open Questions

